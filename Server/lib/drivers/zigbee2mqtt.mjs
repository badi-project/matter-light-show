// Zigbee en direct avec une clé USB Zigbee (Sonoff, SkyConnect, ConBee…) et Zigbee2MQTT :
// les lampes sont lues sur le broker MQTT (« zigbee2mqtt/bridge/devices ») et pilotées par « zigbee2mqtt/<nom>/set ».
// Un groupe Zigbee2MQTT qui contient la lampe sert de pièce proposée.
import { MiniMqtt } from "../mqtt-mini.mjs";
import { BaseDriver, miredsToKelvin, xyOf } from "./common.mjs";

export class Zigbee2MqttDriver extends BaseDriver {
    id = "z2m";
    label = "Zigbee2MQTT";
    #mqtt = null;
    #devices = [];
    #groups = [];
    #avail = new Map(); // nom -> en ligne

    constructor({ log, host, port = 1883, username = "", password = "", base = "zigbee2mqtt" }) {
        super({ log });
        this.cfg = { host: String(host ?? "").trim(), port: Number(port) || 1883, username, password };
        this.base = String(base || "zigbee2mqtt").replace(/\/+$/, "");
    }

    async start() {
        if (!this.cfg.host) {
            this.setState("à configurer", "adresse du broker MQTT nécessaire");
            return;
        }
        this.setState("connexion…");
        this.#mqtt = new MiniMqtt(this.cfg);
        this.#mqtt.on("connect", () => {
            this.#mqtt.subscribe(`${this.base}/bridge/devices`);
            this.#mqtt.subscribe(`${this.base}/bridge/groups`);
            this.#mqtt.subscribe(`${this.base}/+/availability`);
            this.setState(this.lamps.size ? "connecté" : "connecté (en attente de la liste)");
        });
        this.#mqtt.on("offline", () => this.setState("déconnecté", "broker MQTT injoignable (nouvel essai dans 5 s)"));
        this.#mqtt.on("error", e => this.setState("erreur", e.message));
        this.#mqtt.on("message", (topic, payload) => this.#onMessage(topic, payload));
        await this.#mqtt.connect().catch(e => this.setState("erreur", e.message));
    }

    stop() {
        this.#mqtt?.end();
        this.#mqtt = null;
    }

    #onMessage(topic, payload) {
        const text = payload.toString("utf8");
        if (topic === `${this.base}/bridge/devices`) {
            try {
                this.#devices = JSON.parse(text);
            } catch {
                return;
            }
            this.#rebuild();
        } else if (topic === `${this.base}/bridge/groups`) {
            try {
                this.#groups = JSON.parse(text);
            } catch {
                return;
            }
            this.#rebuild();
        } else if (topic.endsWith("/availability")) {
            const name = topic.slice(this.base.length + 1, -"/availability".length);
            let online = text === "online";
            try {
                online = JSON.parse(text).state === "online";
            } catch {}
            this.#avail.set(name, online);
            const l = [...this.lamps.values()].find(x => x.priv.topic === name);
            if (l && l.reachable !== online) {
                l.reachable = online;
                this.emit("changed");
            }
        }
    }

    #rebuild() {
        const roomOf = new Map();
        for (const g of this.#groups ?? []) for (const m of g.members ?? []) {
            const list = roomOf.get(m.ieee_address) ?? [];
            list.push(g.friendly_name);
            roomOf.set(m.ieee_address, list);
        }
        const lamps = [];
        for (const d of this.#devices ?? []) {
            const exposes = d.definition?.exposes ?? [];
            const light = exposes.find(e => e.type === "light" && !e.endpoint) ?? exposes.find(e => e.type === "light");
            if (!light || d.type === "Coordinator") continue;
            const f = new Map((light.features ?? []).map(x => [x.name, x]));
            const color = f.has("color_xy") || f.has("color_hs");
            const ct = f.get("color_temp");
            const kind = color ? "color" : ct ? "white" : f.has("brightness") ? "dim" : "onoff";
            const rooms = roomOf.get(d.ieee_address) ?? [];
            lamps.push({
                id: `z2m:${d.ieee_address}`,
                name: d.friendly_name,
                kind,
                caps: { level: f.has("brightness"), xy: f.has("color_xy"), hs: !f.has("color_xy") && f.has("color_hs"), ct: !!ct },
                ctMin: ct?.value_min ?? 153,
                ctMax: ct?.value_max ?? 500,
                reachable: this.#avail.get(d.friendly_name) ?? true,
                source: "z2m",
                bus: "z2m", // un seul réseau Zigbee
                matterRoom: rooms.length === 1 ? rooms[0] : null,
                priv: { topic: d.friendly_name },
            });
        }
        this.setLamps(lamps);
        this.setState("connecté");
    }

    async exec(id, cmd) {
        const lamp = this.lamps.get(id);
        if (!lamp) throw new Error("Lampe Zigbee inconnue");
        const t = cmd.fade > 0 ? { transition: Math.round(cmd.fade * 10) / 10 } : {};
        let msg;
        switch (cmd.type) {
            case "on":
                msg = { state: "ON" };
                break;
            case "off":
                msg = { state: "OFF", ...t };
                break;
            case "level":
                msg = { brightness: Math.max(1, Math.min(254, cmd.level)), ...(cmd.withOnOff ? { state: "ON" } : {}), ...t };
                break;
            case "xy": {
                const [x, y] = xyOf(cmd);
                msg = cmd.kelvin && lamp.caps.ct ? { color_temp: Math.round(1e6 / cmd.kelvin), ...t } : { color: { x, y }, ...t };
                break;
            }
            case "hs":
                msg = { color: { hue: Math.round((cmd.hue / 254) * 360), saturation: Math.round((cmd.saturation / 254) * 100) }, ...t };
                break;
            case "ct":
                msg = { color_temp: cmd.mireds ?? Math.round(1e6 / (cmd.kelvin ?? miredsToKelvin(370))), ...t };
                break;
            case "identify":
                msg = { effect: "blink" };
                break;
            default:
                return;
        }
        this.#mqtt?.publish(`${this.base}/${lamp.priv.topic}/set`, msg);
    }
}
