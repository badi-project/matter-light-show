// Ampoules WiZ (Philips WiZ et marques compatibles) en Wi-Fi, directement sur le réseau local :
// protocole UDP (port 38899), sans compte ni cloud. Découverte par diffusion sur le réseau.
import dgram from "node:dgram";
import { BaseDriver, levelToPct, miredsToKelvin, rgbOf } from "./common.mjs";

const PORT = 38899;

export class WizDriver extends BaseDriver {
    id = "wiz";
    label = "WiZ (Wi-Fi)";
    #sock = null;
    #timer = null;
    #pending = new Map(); // ip -> { resolve, reject, timer }
    #seen = new Map(); // id -> dernière réponse (ms)

    /** ips : adresses ajoutées à la main (si la diffusion ne passe pas) ; broadcast : adresse de diffusion. */
    constructor({ log, ips = [], broadcast = "255.255.255.255", port = PORT }) {
        super({ log });
        this.ips = ips.filter(Boolean);
        this.broadcast = broadcast;
        this.port = port;
    }

    async start() {
        this.setState("recherche…");
        this.#sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
        this.#sock.on("message", (buf, rinfo) => this.#onMessage(buf, rinfo));
        this.#sock.on("error", e => this.setState("erreur", e.message));
        await new Promise((resolve, reject) => {
            this.#sock.once("error", reject);
            this.#sock.bind(0, () => {
                this.#sock.off("error", reject);
                resolve();
            });
        });
        try {
            this.#sock.setBroadcast(true);
        } catch {}
        this.discover();
        this.#timer = setInterval(() => this.discover(), 30000);
        setTimeout(() => {
            if (this.state === "recherche…") this.setState(this.lamps.size ? "connecté" : "aucune ampoule trouvée");
        }, 4000);
    }

    stop() {
        clearInterval(this.#timer);
        try {
            this.#sock?.close();
        } catch {}
        this.#sock = null;
    }

    #send(ip, obj) {
        if (!this.#sock) return;
        const buf = Buffer.from(JSON.stringify(obj));
        this.#sock.send(buf, this.port, ip);
    }

    discover() {
        const msg = { method: "getSystemConfig", params: {} };
        this.#send(this.broadcast, msg);
        for (const ip of this.ips) this.#send(ip, msg);
        // ampoules muettes depuis plus de 2 min : injoignables
        const now = Date.now();
        let changed = false;
        for (const l of this.lamps.values()) {
            const ok = now - (this.#seen.get(l.id) ?? 0) < 120000;
            if (l.reachable !== ok) {
                l.reachable = ok;
                changed = true;
            }
        }
        if (changed) this.emit("changed");
    }

    #onMessage(buf, rinfo) {
        let msg;
        try {
            msg = JSON.parse(buf.toString());
        } catch {
            return;
        }
        const ip = rinfo.address;
        if (msg.method === "getSystemConfig" && msg.result?.mac) {
            const mac = String(msg.result.mac).toLowerCase();
            const id = `wiz:${mac}`;
            const module = String(msg.result.moduleName ?? "");
            const color = /RGB/i.test(module);
            const tw = color || /TW/i.test(module);
            const kind = color ? "color" : tw ? "white" : "dim";
            this.#seen.set(id, Date.now());
            const known = this.lamps.get(id);
            if (!known || known.priv.ip !== ip || !known.reachable) {
                const lamps = [...this.lamps.values()].filter(l => l.id !== id);
                lamps.push({
                    id,
                    name: known?.name ?? `WiZ ${mac.slice(-4).toUpperCase()}`,
                    kind,
                    caps: { level: true, xy: color, hs: false, ct: tw },
                    ctMin: 153, // 6500 K
                    ctMax: 455, // 2200 K
                    reachable: true,
                    source: "wiz",
                    bus: id, // chaque ampoule a sa propre liaison Wi-Fi
                    model: module,
                    priv: { ip, mac },
                });
                this.setLamps(lamps);
            }
            if (this.state !== "connecté") this.setState("connecté");
            return;
        }
        const p = this.#pending.get(ip);
        if (p && msg.method === p.method) {
            clearTimeout(p.timer);
            this.#pending.delete(ip);
            if (msg.error) p.reject(new Error(msg.error.message ?? "refusé"));
            else p.resolve(msg.result);
        }
    }

    #request(ip, method, params) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pending.delete(ip);
                reject(new Error("pas de réponse de l'ampoule"));
            }, 1000);
            this.#pending.set(ip, { method, resolve, reject, timer });
            this.#send(ip, { method, params });
        });
    }

    async exec(id, cmd) {
        const lamp = this.lamps.get(id);
        if (!lamp) throw new Error("Ampoule WiZ inconnue");
        const ip = lamp.priv.ip;
        let params;
        switch (cmd.type) {
            case "on":
                params = { state: true };
                break;
            case "off":
                params = { state: false };
                break;
            case "level":
                params = { dimming: Math.max(10, levelToPct(cmd.level)), ...(cmd.withOnOff ? { state: true } : {}) };
                break;
            case "ct":
                params = { temp: Math.max(2200, Math.min(6500, cmd.kelvin ?? miredsToKelvin(cmd.mireds))) };
                break;
            case "xy":
            case "hs":
                if (cmd.kelvin) params = { temp: Math.max(2200, Math.min(6500, cmd.kelvin)) };
                else {
                    const [r, g, b] = rgbOf(cmd);
                    params = { r, g, b };
                }
                break;
            case "identify":
                for (let i = 0; i < 4; i++) {
                    await this.#request(ip, "setPilot", { state: i % 2 === 1 });
                    await new Promise(r => setTimeout(r, 400));
                }
                return;
            default:
                return;
        }
        try {
            await this.#request(ip, "setPilot", params);
        } catch (e) {
            // WiZ ignore les fondus : inutile de réessayer la même commande sans fondu
            throw Object.assign(e, { transport: true });
        }
    }
}
