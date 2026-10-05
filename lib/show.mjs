// Moteur de show : calcul des états par lampe, lecture des étapes, et répartiteur de commandes Matter à débit limité.
import { EventEmitter } from "node:events";
import {
    colorValue,
    hexToHueSat,
    hexToXy,
    kelvinToHex,
    kelvinToMireds,
    kelvinToXy,
    percentToLevel,
    xyToMatter,
} from "./color.mjs";

const isKelvin = c => typeof c === "string" && /^\d{4,5}K$/i.test(c);
const kelvinOf = c => parseInt(c, 10);

/** Couleur d'affichage (aperçu) pour une valeur de couleur de show. */
export function displayColor(color, kind = "color") {
    if (kind === "dim" || kind === "onoff") return "#ffd6a0"; // ampoule blanche fixe
    if (isKelvin(color)) return kelvinToHex(kelvinOf(color));
    if (kind === "white") return "#ffe4c4"; // lampe blanche : la couleur est ignorée
    return /^#[0-9a-f]{6}$/i.test(color ?? "") ? color : "#ffffff";
}

/**
 * Calcule l'état voulu de chaque lampe pour une étape.
 * Retourne { [lampId]: { on, color, brightness } } — une lampe absente = inchangée.
 */
export function resolveStep(step, lamps) {
    const out = {};
    const mode = step?.mode ?? "all";
    if (mode === "all") {
        const a = step.all ?? {};
        for (const l of lamps) out[l.id] = normalize(a);
    } else if (mode === "palette") {
        const p = step.palette ?? {};
        const colors = (p.colors ?? []).filter(Boolean);
        if (colors.length) {
            const shift = Number(p.shift) || 0;
            lamps.forEach((l, i) => {
                const n = colors.length;
                const c = colors[(((i + shift) % n) + n) % n];
                out[l.id] = c === "off" ? { on: false } : normalize({ on: true, color: c, brightness: p.brightness });
            });
        }
    } else if (mode === "custom") {
        for (const l of lamps) {
            const s = step.lamps?.[l.id];
            if (s) out[l.id] = normalize(s);
        }
    }
    return out;
}

/**
 * État normalisé d'une lampe. (L'option « shade » des shows auto n'a plus d'effet ici : le répartiteur
 * baisse déjà la luminosité d'une couleur foncée, d'après sa valeur.)
 */
export function normalizeState(s) {
    if (!s || s.on === false || s.color === "off") return { on: false };
    const brightness = Math.max(0, Math.min(100, Number(s.brightness ?? 100)));
    if (brightness === 0) return { on: false };
    return { on: true, color: s.color ?? "2700K", brightness };
}
const normalize = normalizeState;

/** Un show « musical » (show.tempo.bpm) compte ses durées en temps ; sinon en secondes. */
export const secondsPerUnit = show => (show?.tempo?.bpm ? 60 / Number(show.tempo.bpm) : 1);

// ---------------------------------------------------------------------------------------------
// Lecteur
// ---------------------------------------------------------------------------------------------

export class Player extends EventEmitter {
    #timer = null;
    #run = 0;
    status = { playing: false, showId: null, step: -1, stepStartedAt: 0, stepDuration: 0, loop: false };

    /** apply(targets, fadeSeconds) est fourni par le serveur ; getLamps() renvoie les lampes actives, dans l'ordre. */
    constructor({ apply, getLamps }) {
        super();
        this.apply = apply;
        this.getLamps = getLamps;
    }

    play(show, fromStep = 0) {
        this.stop(false);
        if (!show?.steps?.length) throw new Error("Ce show ne contient aucune étape");
        this.show = show;
        const run = ++this.#run;
        const go = i => {
            if (run !== this.#run) return;
            const cur = this.show; // peut être remplacé en direct pendant la lecture (édition)
            if (i >= cur.steps.length) {
                if (cur.loop) i = 0;
                else return this.stop();
            }
            const speed = Math.max(0.1, Number(cur.speed) || 1);
            const unit = secondsPerUnit(cur); // show musical : durées en temps
            const step = cur.steps[i];
            const fade = (Math.max(0, Number(step.fade) || 0) * unit) / speed;
            const duration = Math.max(0.2, (Number(step.duration) || 1) * unit) / speed;
            this.apply(resolveStep(step, this.getLamps()), fade);
            this.status = { playing: true, showId: cur.id, step: i, stepStartedAt: Date.now(), stepDuration: duration, loop: !!cur.loop };
            this.emit("status", this.status);
            this.#timer = setTimeout(() => go(i + 1), duration * 1000);
        };
        go(Math.max(0, Math.min(fromStep, show.steps.length - 1)));
    }

    /** Remplace le show en cours de lecture (les modifications s'appliquent à l'étape suivante). */
    update(show) {
        if (this.status.playing && this.show?.id === show.id && show.steps?.length) this.show = show;
    }

    /** Applique une seule étape (bouton « Tester »). */
    applyStep(show, index) {
        this.stop(false);
        const step = show?.steps?.[index];
        if (!step) throw new Error("Étape introuvable");
        this.apply(resolveStep(step, this.getLamps()), Math.max(0, Number(step.fade) || 0) * secondsPerUnit(show));
        this.status = { playing: false, showId: show.id, step: index, stepStartedAt: Date.now(), stepDuration: 0, loop: false };
        this.emit("status", this.status);
    }

    stop(emit = true) {
        this.#run++;
        clearTimeout(this.#timer);
        this.#timer = null;
        if (emit) {
            this.status = { ...this.status, playing: false };
            this.emit("status", this.status);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Répartiteur : transforme les états voulus en commandes Matter, sans dépasser le débit du pont.
// ---------------------------------------------------------------------------------------------

export class Dispatcher extends EventEmitter {
    #sent = new Map(); // lampId -> { on, level, colorKey } réellement envoyés
    #queue = new Map(); // lampId -> [commandes en attente]
    #busy = new Set(); // lampes avec une commande en vol
    #offTimers = new Map();
    #rr = []; // ordre round-robin
    #timer = null;
    #lastErrorLog = 0;
    #nextAt = new Map(); // passerelle (« bus ») -> prochain envoi permis

    /**
     * hub : getLampForDispatch(id) -> { name, bus }, exec(id, cmd).
     * Chaque passerelle (pont Hue, Home Assistant, ampoule Wi-Fi…) a son propre débit : busRate(bus) commandes/s.
     */
    constructor({ hub, rate = 10, log, busRate = null }) {
        super();
        this.hub = hub;
        this.rate = rate;
        this.log = log;
        this.busRate = busRate;
    }

    #busOf(id) {
        return this.hub.getLampForDispatch(id)?.bus ?? "defaut";
    }
    #rateOf(bus) {
        return Math.max(1, Number(this.busRate?.(bus)) || this.rate);
    }

    /** Combien de lampes peuvent changer pendant « seconds » sans saturer leurs passerelles (≈ 1,15 commande par lampe). */
    capacity(lamps, seconds) {
        const byBus = new Map();
        for (const l of lamps) {
            if (l.virtual) return lamps.length;
            const bus = l.bus ?? "defaut";
            byBus.set(bus, (byBus.get(bus) ?? 0) + 1);
        }
        let total = 0;
        for (const [bus, n] of byBus) total += Math.min(n, Math.floor((this.#rateOf(bus) * seconds * 0.9) / 1.15));
        return Math.max(1, Math.min(lamps.length, total));
    }

    setRate(rate) {
        this.rate = Math.max(1, Math.min(50, Number(rate) || 10));
    }

    get pending() {
        let n = 0;
        for (const q of this.#queue.values()) n += q.length;
        return n;
    }

    /** Oublie ce qui a été envoyé (ex. après reconnexion) pour tout renvoyer à la prochaine étape. */
    forget(lampId) {
        if (lampId) this.#sent.delete(lampId);
        else this.#sent.clear();
    }

    setTarget(lamp, state, fade) {
        const id = lamp.id;
        clearTimeout(this.#offTimers.get(id));
        this.#offTimers.delete(id);
        const cmds = this.#build(lamp, state, fade);
        this.#queue.set(id, cmds); // remplace ce qui n'a pas encore été envoyé
        if (!this.#rr.includes(id)) this.#rr.push(id);
        this.#kick();
    }

    identify(lamp) {
        const q = this.#queue.get(lamp.id) ?? [];
        q.push({ type: "identify", seconds: 3 });
        this.#queue.set(lamp.id, q);
        if (!this.#rr.includes(lamp.id)) this.#rr.push(lamp.id);
        this.#kick();
    }

    #build(lamp, state, fade) {
        const last = this.#sent.get(lamp.id) ?? {};
        const cmds = [];
        if (!state.on) {
            if (last.on === false) return cmds;
            if (fade >= 0.8 && lamp.caps.level) {
                // fondu vers le noir, puis extinction réelle à la fin du fondu
                cmds.push({ type: "level", level: 1, fade });
                const t = setTimeout(() => {
                    this.#offTimers.delete(lamp.id);
                    const q = this.#queue.get(lamp.id) ?? [];
                    q.push({ type: "off" });
                    this.#queue.set(lamp.id, q);
                    this.#kick();
                }, fade * 1000);
                this.#offTimers.set(lamp.id, t);
            } else {
                cmds.push({ type: "off" });
            }
            return cmds;
        }

        const color = state.color;
        const factor = isKelvin(color) ? 1 : colorValue(color);
        const level = percentToLevel(state.brightness * factor);
        const colorCmd = this.#colorCommand(lamp, color);
        const wasOn = last.on === true;

        const levelCmd = !wasOn || last.level !== level ? { type: "level", level, fade, withOnOff: true } : null;
        const colCmd = colorCmd && last.colorKey !== colorCmd.key ? { ...colorCmd, fade } : null;
        // lampe déjà allumée : la couleur d'abord (c'est ce qui se voit le plus) ; lampe éteinte : l'allumer d'abord
        if (wasOn) cmds.push(...[colCmd, levelCmd].filter(Boolean));
        else cmds.push(...[levelCmd, colCmd].filter(Boolean));
        return cmds;
    }

    #colorCommand(lamp, color) {
        const { caps } = lamp;
        if (isKelvin(color)) {
            const k = kelvinOf(color);
            if (caps.ct) {
                const mireds = kelvinToMireds(k, lamp.ctMin, lamp.ctMax);
                return { type: "ct", mireds, kelvin: k, key: `ct:${mireds}` };
            }
            if (caps.xy) {
                const m = xyToMatter(kelvinToXy(k));
                return { type: "xy", ...m, kelvin: k, key: `xy:${m.colorX}:${m.colorY}` };
            }
            return null;
        }
        if (caps.xy) {
            const m = xyToMatter(hexToXy(color));
            return { type: "xy", ...m, hex: color, key: `xy:${m.colorX}:${m.colorY}` };
        }
        if (caps.hs) {
            const hs = hexToHueSat(color);
            return { type: "hs", ...hs, hex: color, key: `hs:${hs.hue}:${hs.saturation}` };
        }
        return null; // lampe blanche ou simple variateur : seule la luminosité compte
    }

    #kick() {
        if (this.#timer) return;
        this.#timer = setTimeout(() => this.#tick(), 0);
    }

    #tick() {
        this.#timer = null;
        const now = Date.now();
        let soonest = Infinity;
        const used = new Set(); // au plus une commande par passerelle à chaque tour
        const n = this.#rr.length;
        for (let i = 0; i < n; i++) {
            const id = this.#rr.shift();
            const q = this.#queue.get(id);
            if (!q?.length) {
                this.#queue.delete(id);
                continue; // on ne la remet pas dans la rotation
            }
            this.#rr.push(id);
            if (this.#busy.has(id)) continue; // relancé à la fin de l'envoi en cours
            const bus = this.#busOf(id);
            const at = this.#nextAt.get(bus) ?? 0;
            if (at > now || used.has(bus)) {
                soonest = Math.min(soonest, Math.max(at, now + 1));
                continue;
            }
            used.add(bus);
            const next = now + 1000 / this.#rateOf(bus);
            this.#nextAt.set(bus, next);
            soonest = Math.min(soonest, next);
            this.#send(id, q.shift());
        }
        if (this.pending > 0 && soonest < Infinity) this.#timer = setTimeout(() => this.#tick(), Math.max(1, soonest - Date.now()));
        this.emit("pending", this.pending);
    }

    async #send(id, cmd) {
        const lamp = this.hub.getLampForDispatch(id);
        if (!lamp) return;
        this.#busy.add(id);
        try {
            try {
                await this.hub.exec(id, cmd);
            } catch (e) {
                // certains appareils refusent les transitions : on réessaie une fois sans fondu
                if (!(cmd.fade > 0)) throw e;
                await this.hub.exec(id, { ...cmd, fade: 0 });
            }
            const s = this.#sent.get(id) ?? {};
            if (cmd.type === "off") s.on = false;
            else if (cmd.type === "on") s.on = true;
            else if (cmd.type === "level") {
                s.level = cmd.level;
                if (cmd.withOnOff) s.on = true;
            } else if (cmd.key) s.colorKey = cmd.key;
            this.#sent.set(id, s);
        } catch (e) {
            this.#sent.delete(id);
            const now = Date.now();
            if (now - this.#lastErrorLog > 5000) {
                this.#lastErrorLog = now;
                this.log?.("warn", `Commande refusée par « ${lamp.name} » : ${e.message}`);
            }
        } finally {
            this.#busy.delete(id);
            if (this.pending > 0) this.#kick();
        }
    }
}
