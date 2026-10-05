// Outils communs aux pilotes non Matter : conversion des commandes du répartiteur (format Matter)
// vers des valeurs « humaines » (pourcentage, RGB, kelvins, xy).
import { EventEmitter } from "node:events";
import { hexToRgb } from "../color.mjs";

export const levelToPct = level => Math.max(1, Math.min(100, Math.round((Number(level) / 254) * 100)));
export const miredsToKelvin = m => Math.round(1e6 / Math.max(50, Number(m) || 370));
export const kelvinToMireds = k => Math.round(1e6 / Math.max(1000, Number(k) || 2700));
export const xyOf = cmd => [Math.round((cmd.colorX / 65536) * 10000) / 10000, Math.round((cmd.colorY / 65536) * 10000) / 10000];

/** RGB « pleine puissance » d'une commande couleur (la luminosité est envoyée à part). */
export function rgbOf(cmd) {
    if (cmd.hex) {
        const { r, g, b } = hexToRgb(cmd.hex);
        const m = Math.max(r, g, b) || 1;
        return [r, g, b].map(v => Math.round((v / m) * 255));
    }
    if (cmd.type === "hs") return hsvToRgb((cmd.hue / 254) * 360, cmd.saturation / 254);
    if (cmd.colorX != null) return xyToRgb(...xyOf(cmd));
    return [255, 255, 255];
}

function hsvToRgb(h, s) {
    const c = s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = 1 - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r, g, b].map(v => Math.round((v + m) * 255));
}

function xyToRgb(x, y) {
    const Y = 1, X = (Y / Math.max(y, 1e-4)) * x, Z = (Y / Math.max(y, 1e-4)) * (1 - x - y);
    let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
    let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
    let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
    [r, g, b] = [r, g, b].map(v => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055));
    const m = Math.max(r, g, b, 1e-6);
    return [r, g, b].map(v => Math.max(0, Math.round((v / m) * 255)));
}

/** Base des pilotes : liste de lampes, état de connexion, événement « changed ». */
export class BaseDriver extends EventEmitter {
    lamps = new Map();
    state = "arrêté";
    error = null;

    constructor({ log }) {
        super();
        this.log = log ?? (() => {});
    }

    getLamps() {
        return [...this.lamps.values()].map(({ priv, ...l }) => l);
    }
    getLamp(id) {
        return this.lamps.get(id) ?? null;
    }
    hasLamp(id) {
        return this.lamps.has(id);
    }
    setLamps(list) {
        const sig = JSON.stringify(list.map(({ priv, ...l }) => l));
        const before = JSON.stringify(this.getLamps());
        this.lamps = new Map(list.map(l => [l.id, l]));
        if (sig !== before) this.emit("changed");
    }
    setState(state, error = null) {
        const changed = state !== this.state || error !== this.error;
        this.state = state;
        this.error = error;
        if (changed) this.emit("changed");
    }
    status() {
        return { id: this.id, label: this.label, state: this.state, error: this.error, count: this.lamps.size };
    }
    stop() {}
}
