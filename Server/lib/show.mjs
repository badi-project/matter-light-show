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
        let due = Date.now(); // heure prévue de l'étape : les retards des minuteries ne s'additionnent pas
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
            due = Math.max(due + duration * 1000, Date.now() + 20);
            this.#timer = setTimeout(() => go(i + 1), due - Date.now());
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

// erreurs de transport (lampe qui ne répond pas) : inutile de réessayer la même commande sans fondu
const TRANSPORT_ERROR = /abort|timeout|timed out|no response|closed|unreachable|injoignable|PeerUnresponsive/i;
const MAX_IN_FLIGHT = 4; // commandes sans réponse par passerelle au plus (un pont saturé n'est pas noyé davantage)
const isTransportError = e => !!(e?.unreachable || e?.transport) || TRANSPORT_ERROR.test(String(e?.message));

export class Dispatcher extends EventEmitter {
    #sent = new Map(); // lampId -> { on, level, colorKey } réellement envoyés (confirmés par la lampe)
    #flight = new Map(); // lampId -> effet de la commande en vol (pas encore confirmée)
    #targets = new Map(); // lampId -> dernier état voulu { lamp, state, fade }
    #queue = new Map(); // lampId -> [commandes en attente]
    #offTimers = new Map();
    #rr = []; // ordre round-robin
    #timer = null;
    #timerAt = Infinity; // heure prévue du prochain tour
    #lastErrorLog = 0;
    #errorLogAt = new Map(); // lampe -> dernier message d'erreur (1 par minute au plus)
    #nextAt = new Map(); // passerelle (« bus ») -> prochain envoi permis
    #pendingShown = 0;
    #pendingTimer = null;
    #stats = new Map(); // lampId -> { ok, fail, lastError, at } : commandes acceptées / refusées (diagnostic)
    #busFlight = new Map(); // passerelle -> commandes envoyées sans réponse encore
    #lastServed = new Map(); // lampe -> dernier envoi (la lampe servie le moins récemment passe d'abord)
    #midSeq = new Set(); // lampes dont la série de commandes (luminosité + couleur) est commencée

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
    rateOf(bus) {
        return Math.max(1, Number(this.busRate?.(bus)) || this.rate);
    }

    /** Combien de lampes peuvent changer pendant « seconds » sans saturer leurs passerelles (≈ 1,15 commande par lampe). */
    capacity(lamps, seconds) {
        const byBus = new Map();
        let virtual = 0;
        for (const l of lamps) {
            if (l.virtual) {
                virtual++; // lampe de démo : rien n'est envoyé, elle ne coûte rien
                continue;
            }
            const bus = l.bus ?? "defaut";
            byBus.set(bus, (byBus.get(bus) ?? 0) + 1);
        }
        let total = virtual;
        for (const [bus, n] of byBus) total += Math.min(n, Math.floor((this.rateOf(bus) * seconds * 0.9) / 1.15));
        return Math.max(1, Math.min(lamps.length, total));
    }

    /** Commandes que la passerelle peut encore passer pendant « seconds » (ce qui attend déjà déduit). */
    budget(bus, seconds) {
        let waiting = 0;
        for (const [id, q] of this.#queue) if (q.length && this.#busOf(id) === bus) waiting += q.length;
        return this.rateOf(bus) * seconds * 0.9 - waiting;
    }

    /** Nombre de commandes qu'enverrait cet état pour cette lampe (0 si elle y est déjà). */
    costOf(lamp, state, fade = 0) {
        return this.#build(lamp, state, fade, true).length;
    }

    setRate(rate) {
        this.rate = Math.max(1, Math.min(50, Number(rate) || 10));
    }

    #count(id, err) {
        const s = this.#stats.get(id) ?? { ok: 0, fail: 0, lastError: null, at: 0 };
        if (err) {
            s.fail++;
            s.lastError = String(err.message ?? err).slice(0, 160);
        } else s.ok++;
        s.at = Date.now();
        this.#stats.set(id, s);
    }

    /** Diagnostic : pour chaque lampe, commandes acceptées / refusées et dernier état confirmé par la lampe. */
    report() {
        const lamps = {};
        let ok = 0;
        let fail = 0;
        for (const [id, s] of this.#stats) {
            ok += s.ok;
            fail += s.fail;
            lamps[id] = { ...s, confirmed: this.#sent.get(id) ?? null };
        }
        return { ok, fail, pending: this.pending, rate: this.rate, lamps };
    }

    get pending() {
        let n = 0;
        for (const q of this.#queue.values()) n += q.length;
        return n;
    }

    /** Oublie ce qui a été envoyé (ex. après reconnexion) pour tout renvoyer à la prochaine étape. */
    forget(lampIds) {
        if (typeof lampIds === "string") lampIds = [lampIds];
        if (Array.isArray(lampIds)) for (const id of lampIds) this.#sent.delete(id);
        else this.#sent.clear();
    }

    setTarget(lamp, state, fade) {
        const id = lamp.id;
        clearTimeout(this.#offTimers.get(id));
        this.#offTimers.delete(id);
        this.#targets.set(id, { lamp, state, fade });
        const cmds = this.#build(lamp, state, fade);
        this.#queue.set(id, cmds); // remplace ce qui n'a pas encore été envoyé
        this.#midSeq.delete(id);
        if (cmds.length && !this.#rr.includes(id)) this.#rr.push(id);
        this.#kick();
    }

    identify(lamp) {
        this.#enqueue(lamp.id, { type: "identify", seconds: 3 });
    }

    /** Ajoute une commande à la file d'une lampe (et la remet dans la rotation : sinon elle ne partirait jamais). */
    #enqueue(id, cmd) {
        const q = this.#queue.get(id) ?? [];
        q.push(cmd);
        this.#queue.set(id, q);
        if (!this.#rr.includes(id)) this.#rr.push(id);
        this.#kick();
    }

    /** Commandes nécessaires pour passer de l'état connu (envoyé ou en vol) à l'état voulu. */
    #build(lamp, state, fade, dry = false) {
        const last = { ...(this.#sent.get(lamp.id) ?? {}), ...(this.#flight.get(lamp.id) ?? {}) };
        const cmds = [];
        if (!state.on) {
            if (last.on === false) return cmds;
            if (fade >= 0.8 && lamp.caps.level) {
                // fondu vers le noir, puis extinction réelle à la fin du fondu
                cmds.push({ type: "level", level: 1, fade });
                if (!dry) {
                    const t = setTimeout(() => {
                        this.#offTimers.delete(lamp.id);
                        this.#enqueue(lamp.id, { type: "off" });
                    }, fade * 1000);
                    this.#offTimers.set(lamp.id, t);
                }
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

    /** Prochain tour au plus tôt dans « ms » (un tour prévu plus tard est avancé : une lampe lente ne retarde pas les autres). */
    #kick(ms = 0) {
        const at = Date.now() + ms;
        if (this.#timer && this.#timerAt <= at) return;
        clearTimeout(this.#timer);
        this.#timerAt = at;
        this.#timer = setTimeout(() => this.#tick(), ms);
    }

    #tick() {
        this.#timer = null;
        this.#timerAt = Infinity;
        const now = Date.now();
        let soonest = Infinity;
        // Équité : pour chaque passerelle, on sert la lampe qui attend depuis le plus longtemps (une lampe dont la
        // couleur est à moitié envoyée passe d'abord). Avant, l'ordre ne tournait pas : quand les commandes dépassaient
        // le débit (show aux étapes trop courtes), les premières lampes passaient toujours et certaines jamais.
        const best = new Map(); // passerelle -> lampe à servir
        const key = id => (this.#midSeq.has(id) ? -1 : this.#lastServed.get(id) ?? 0);
        const keep = [];
        for (const id of this.#rr) {
            const q = this.#queue.get(id);
            if (!q?.length) {
                this.#queue.delete(id);
                this.#midSeq.delete(id);
                continue; // on ne la remet pas dans la rotation
            }
            keep.push(id);
            if (this.#flight.has(id)) continue; // relancé à la fin de l'envoi en cours
            const bus = this.#busOf(id);
            const cur = best.get(bus);
            if (cur === undefined || key(id) < key(cur)) best.set(bus, id);
        }
        this.#rr = keep;
        for (const [bus, id] of best) {
            const at = this.#nextAt.get(bus) ?? 0;
            // passerelle qui tarde à répondre : on n'empile pas plus de MAX_IN_FLIGHT commandes chez elle
            if (at > now || (this.#busFlight.get(bus) ?? 0) >= MAX_IN_FLIGHT) {
                soonest = Math.min(soonest, Math.max(at, now + 20));
                continue;
            }
            // créneau suivant compté depuis le créneau prévu (pas depuis ce tour, un peu en retard) : le débit réel reste celui réglé
            const gap = 1000 / this.rateOf(bus);
            const next = (now - at < gap ? at : now) + gap;
            this.#nextAt.set(bus, next);
            soonest = Math.min(soonest, next);
            const q = this.#queue.get(id);
            if (!this.#midSeq.has(id)) this.#lastServed.set(id, now);
            const cmd = q.shift();
            if (q.length) this.#midSeq.add(id);
            else this.#midSeq.delete(id);
            this.#send(id, cmd, bus);
        }
        if (this.pending > 0 && soonest < Infinity) this.#kick(Math.max(1, soonest - Date.now()));
        this.#showPending();
    }

    /** Nombre de commandes en file pour la page : seulement quand il change, 4 fois par seconde au plus. */
    #showPending() {
        if (this.#pendingTimer) return;
        const n = this.pending;
        if (n === this.#pendingShown) return;
        this.#pendingShown = n;
        this.emit("pending", n);
        this.#pendingTimer = setTimeout(() => {
            this.#pendingTimer = null;
            this.#showPending();
        }, 250);
    }

    async #send(id, cmd, bus = this.#busOf(id)) {
        const lamp = this.hub.getLampForDispatch(id);
        if (!lamp) return;
        this.#busFlight.set(bus, (this.#busFlight.get(bus) ?? 0) + 1);
        const effect = cmd.type === "off" ? { on: false } : cmd.type === "on" ? { on: true } : cmd.type === "level" ? { level: cmd.level, ...(cmd.withOnOff ? { on: true } : {}) } : cmd.key ? { colorKey: cmd.key } : {};
        this.#flight.set(id, effect);
        try {
            try {
                await this.hub.exec(id, cmd);
            } catch (e) {
                // certains appareils refusent les transitions : on réessaie une fois sans fondu
                // (pas si la lampe ne répond pas du tout : on attendrait deux fois pour rien)
                if (!(cmd.fade > 0) || isTransportError(e)) throw e;
                await this.hub.exec(id, { ...cmd, fade: 0 });
            }
            this.#sent.set(id, { ...(this.#sent.get(id) ?? {}), ...effect });
            this.#count(id, null);
        } catch (e) {
            this.#count(id, e);
            this.#sent.delete(id);
            this.#flight.delete(id);
            // la file avait été préparée en comptant sur cette commande : on la refait depuis un état inconnu
            const t = this.#targets.get(id);
            if (t && this.#queue.get(id)?.length) this.#queue.set(id, this.#build(t.lamp, t.state, t.fade, true));
            // lampe injoignable : déjà signalée par sa passerelle, inutile de répéter à chaque commande
            const now = Date.now();
            const last = this.#errorLogAt.get(id) ?? 0;
            if (!e.unreachable && now - last > 60000 && now - this.#lastErrorLog > 5000) {
                this.#lastErrorLog = now;
                this.#errorLogAt.set(id, now);
                this.log?.("warn", `Commande refusée par « ${lamp.name} » : ${e.message}`);
            }
        } finally {
            this.#flight.delete(id);
            this.#busFlight.set(bus, Math.max(0, (this.#busFlight.get(bus) ?? 1) - 1));
            if (this.pending > 0) this.#kick();
            else this.#showPending();
        }
    }
}
