// Home Assistant : toutes les lampes qu'il gère (Zigbee via ZHA ou Zigbee2MQTT, Smart Life / Tuya, Z-Wave, Wi-Fi…),
// par son API locale (adresse + jeton d'accès longue durée). Les pièces (« zones ») de Home Assistant sont reprises.
import { BaseDriver, kelvinToMireds, miredsToKelvin, xyOf } from "./common.mjs";

const COLOR_MODES = ["xy", "hs", "rgb", "rgbw", "rgbww"];

export class HomeAssistantDriver extends BaseDriver {
    id = "ha";
    label = "Home Assistant";
    #timer = null;

    constructor({ log, url, token }) {
        super({ log });
        this.url = String(url ?? "").trim().replace(/\/+$/, "");
        if (this.url && !/^https?:\/\//.test(this.url)) this.url = `http://${this.url}`;
        this.token = String(token ?? "").trim();
    }

    async #api(method, path, body, text = false) {
        const r = await fetch(this.url + path, {
            method,
            headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(6000),
        });
        if (r.status === 401 || r.status === 403) throw new Error("jeton refusé par Home Assistant");
        if (!r.ok) throw new Error(`Home Assistant répond ${r.status}`);
        return text ? r.text() : r.json();
    }

    async start() {
        if (!this.url || !this.token) {
            this.setState("à configurer", "adresse et jeton nécessaires");
            return;
        }
        this.setState("connexion…");
        await this.refresh().catch(e => this.setState("erreur", e.message));
        this.#timer = setInterval(() => this.refresh().catch(e => this.setState("erreur", e.message)), 60000);
    }

    stop() {
        clearInterval(this.#timer);
    }

    async refresh() {
        const states = await this.#api("GET", "/api/states");
        const lights = states.filter(s => String(s.entity_id).startsWith("light."));
        // pièces (zones) de Home Assistant
        const areas = {};
        try {
            const txt = await this.#api(
                "POST",
                "/api/template",
                { template: "{% for s in states.light %}{{ s.entity_id }}|{{ area_name(s.entity_id) or '' }}\n{% endfor %}" },
                true,
            );
            for (const line of txt.split("\n")) {
                const [e, a] = line.split("|");
                if (e && a?.trim()) areas[e.trim()] = a.trim();
            }
        } catch {}
        const lamps = lights.map(s => {
            const a = s.attributes ?? {};
            const modes = a.supported_color_modes ?? [];
            const color = modes.some(m => COLOR_MODES.includes(m));
            const ct = modes.includes("color_temp") || (color && !!a.min_color_temp_kelvin);
            const level = modes.some(m => m !== "onoff") || a.brightness != null;
            const id = `ha:${s.entity_id}`;
            return {
                id,
                name: a.friendly_name || s.entity_id,
                kind: color ? "color" : ct ? "white" : level ? "dim" : "onoff",
                caps: { level, xy: color, hs: false, ct },
                ctMin: a.max_color_temp_kelvin ? kelvinToMireds(a.max_color_temp_kelvin) : 153,
                ctMax: a.min_color_temp_kelvin ? kelvinToMireds(a.min_color_temp_kelvin) : 500,
                reachable: s.state !== "unavailable",
                source: "ha",
                bus: "ha",
                matterRoom: areas[s.entity_id] ?? null, // pièce annoncée par le système
                priv: { entity: s.entity_id },
            };
        });
        this.setLamps(lamps);
        this.setState("connecté");
    }

    async exec(id, cmd) {
        const lamp = this.lamps.get(id);
        if (!lamp) throw new Error("Lampe Home Assistant inconnue");
        const entity_id = lamp.priv.entity;
        const t = cmd.fade > 0 ? { transition: Math.round(cmd.fade * 10) / 10 } : {};
        let service = "turn_on";
        let data;
        switch (cmd.type) {
            case "on":
                data = {};
                break;
            case "off":
                service = "turn_off";
                data = { ...t };
                break;
            case "level":
                data = { brightness: Math.max(1, Math.round((cmd.level / 254) * 255)), ...t };
                break;
            case "xy":
                data = cmd.kelvin && lamp.caps.ct ? { color_temp_kelvin: cmd.kelvin, ...t } : { xy_color: xyOf(cmd), ...t };
                break;
            case "hs":
                data = { hs_color: [Math.round((cmd.hue / 254) * 360), Math.round((cmd.saturation / 254) * 100)], ...t };
                break;
            case "ct":
                data = { color_temp_kelvin: cmd.kelvin ?? miredsToKelvin(cmd.mireds), ...t };
                break;
            case "identify":
                data = { flash: "short" };
                break;
            default:
                return;
        }
        await this.#api("POST", `/api/services/light/${service}`, { entity_id, ...data });
    }
}
