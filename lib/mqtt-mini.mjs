// Client MQTT 3.1.1 minimal (QoS 0), sans dépendance : connexion, abonnement, publication, maintien de la liaison.
// Suffisant pour parler à Zigbee2MQTT via un broker (Mosquitto…).
import { EventEmitter } from "node:events";
import net from "node:net";

function encLen(n) {
    const out = [];
    do {
        let b = n % 128;
        n = Math.floor(n / 128);
        if (n > 0) b |= 0x80;
        out.push(b);
    } while (n > 0);
    return Buffer.from(out);
}
const str = s => {
    const b = Buffer.from(String(s), "utf8");
    const l = Buffer.alloc(2);
    l.writeUInt16BE(b.length);
    return Buffer.concat([l, b]);
};
const packet = (type, body) => Buffer.concat([Buffer.from([type]), encLen(body.length), body]);

export class MiniMqtt extends EventEmitter {
    #sock = null;
    #buf = Buffer.alloc(0);
    #ping = null;
    #retry = null;
    #id = 1;
    #closed = false;
    connected = false;

    constructor({ host, port = 1883, username = "", password = "", clientId = `show-lumiere-${process.pid}`, keepalive = 30 }) {
        super();
        Object.assign(this, { host, port: Number(port) || 1883, username, password, clientId, keepalive });
    }

    connect() {
        this.#closed = false;
        return new Promise((resolve, reject) => {
            let settled = false;
            const done = (err) => {
                if (settled) return;
                settled = true;
                err ? reject(err) : resolve();
            };
            const sock = net.createConnection({ host: this.host, port: this.port });
            this.#sock = sock;
            sock.setTimeout(8000, () => sock.destroy(new Error("délai dépassé")));
            sock.on("connect", () => {
                sock.setTimeout(0);
                let flags = 0x02; // session propre
                const payload = [str(this.clientId)];
                if (this.username) {
                    flags |= 0x80;
                    payload.push(str(this.username));
                    if (this.password) {
                        flags |= 0x40;
                        payload.push(str(this.password));
                    }
                }
                const ka = Buffer.alloc(2);
                ka.writeUInt16BE(this.keepalive);
                sock.write(packet(0x10, Buffer.concat([str("MQTT"), Buffer.from([4, flags]), ka, ...payload])));
            });
            sock.on("data", d => {
                this.#buf = Buffer.concat([this.#buf, d]);
                this.#parse(done);
            });
            sock.on("error", e => {
                done(e);
                this.emit("error", e);
            });
            sock.on("close", () => {
                const was = this.connected;
                this.connected = false;
                clearInterval(this.#ping);
                done(new Error("connexion fermée"));
                if (was) this.emit("offline");
                if (!this.#closed) {
                    clearTimeout(this.#retry);
                    this.#retry = setTimeout(() => this.connect().catch(() => {}), 5000);
                }
            });
        });
    }

    #parse(done) {
        for (;;) {
            if (this.#buf.length < 2) return;
            let mul = 1, len = 0, i = 1, b;
            do {
                if (i >= this.#buf.length) return;
                b = this.#buf[i++];
                len += (b & 0x7f) * mul;
                mul *= 128;
            } while (b & 0x80);
            if (this.#buf.length < i + len) return;
            const type = this.#buf[0] >> 4;
            const flags = this.#buf[0] & 0x0f;
            const body = this.#buf.subarray(i, i + len);
            this.#buf = this.#buf.subarray(i + len);
            if (type === 2) {
                // CONNACK
                const rc = body[1];
                if (rc === 0) {
                    this.connected = true;
                    clearInterval(this.#ping);
                    this.#ping = setInterval(() => this.#sock?.write(Buffer.from([0xc0, 0])), this.keepalive * 800);
                    done();
                    this.emit("connect");
                } else {
                    const why = { 4: "identifiant ou mot de passe refusé", 5: "accès refusé" }[rc] ?? `refus (code ${rc})`;
                    done(new Error(why));
                    this.#sock?.destroy();
                }
            } else if (type === 3) {
                // PUBLISH
                const tl = body.readUInt16BE(0);
                const topic = body.subarray(2, 2 + tl).toString("utf8");
                let off = 2 + tl;
                const qos = (flags >> 1) & 3;
                if (qos > 0) {
                    const pid = body.readUInt16BE(off);
                    off += 2;
                    if (qos === 1) this.#sock?.write(Buffer.from([0x40, 2, pid >> 8, pid & 0xff])); // PUBACK
                }
                this.emit("message", topic, body.subarray(off));
            }
        }
    }

    subscribe(topic) {
        const id = this.#id++ & 0xffff || 1;
        const pid = Buffer.from([id >> 8, id & 0xff]);
        this.#sock?.write(packet(0x82, Buffer.concat([pid, str(topic), Buffer.from([0])])));
    }

    publish(topic, payload) {
        if (!this.connected) throw new Error("broker MQTT non connecté");
        const data = Buffer.isBuffer(payload) ? payload : Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload));
        this.#sock.write(packet(0x30, Buffer.concat([str(topic), data])));
    }

    end() {
        this.#closed = true;
        clearTimeout(this.#retry);
        clearInterval(this.#ping);
        try {
            this.#sock?.write(Buffer.from([0xe0, 0]));
            this.#sock?.end();
        } catch {}
    }
}
