// Synchronisation des lumières sur la musique jouée sur le Mac (Apple Music, Spotify, Deezer…) ou sur un appareil Spotify.
//
// Principe : une horloge de temps musicaux (tempo + calage) suit la position du morceau.
// À CHAQUE TEMPS, un groupe de lampes change (autant que le pont peut en passer) :
//  - si l'étape du show a changé, le groupe prend les nouvelles couleurs → les couleurs se propagent en vague ;
//  - sinon, le groupe fait un « accent » de luminosité (fort sur le 1er temps de la mesure).
// Les couleurs viennent du show choisi, ou d'un show automatique (pochette / genre / Noël / Halloween).
import { EventEmitter } from "node:events";
import { fitTaps, lookupKnown, norm, normalizeBpm, trackKey } from "./tempo.mjs";
import { resolveStep } from "./show.mjs";
import { makeAutoShow, STYLE_LABEL } from "./autoshow.mjs";
import { buildPalette, detectGenre, feltTempo, musicEnergy, musicStyle, nameOf, nuanceLabel, rhythmFor } from "./genre.mjs";
import { arrangeColors, isHex, isKelvin } from "./palette.mjs";
import { roomTargets } from "./rooms.mjs";

// les quatre modes automatiques (valeur du choix -> mode de palette)
export const AUTO_CHOICES = { auto: "complet", "auto-sobre": "sobre", "auto-pochette": "pochette", "auto-nuances": "nuances" };

export const MY_COLORS = "mes-couleurs"; // choix « Mes couleurs » (jusqu'à 6 couleurs choisies)
export const DEFAULT_MY_COLORS = ["#ff2d6f", "#ffb000", "#00c8ff"];
const OTHER_ROOMS = { blanc: { on: true, color: "2700K", brightness: 35 }, eteint: { on: false } };

const INTENSITY = { doux: 0.3, moyen: 0.5, fort: 0.8, aucun: 0 };
const STYLE_DEPTH = { calme: 0.3, groove: 0.5, energique: 0.75 };

export class MusicSync extends EventEmitter {
    enabled = false;
    choice = "auto"; // "auto" ou id d'un show
    #timer = null;
    #ctx = null; // contexte du morceau : show, tempo, style…
    #version = 0;
    #beat = null; // dernier temps traité
    #stepToken = "";
    #ptr = 0; // prochaine lampe de la vague
    #applied = new Map(); // lampe -> étape déjà appliquée
    #high = new Map(); // lampe -> accent haut/bas
    #active = false;
    #energy = { level: 0.5, at: 0 };
    #lastGroup = 0;
    #slotPtr = 0; // cohérence : prochain groupe de pièces
    #slotWait = 0; // temps restants pour une grande pièce
    #inactiveKey = ""; // pièces sans musique déjà mises en blanc / éteintes

    /**
     * music : AppleMusic ; songs : SongInfo ; loadShows() -> [shows complets] ; apply(targets, fadeSec) ; getLamps()
     * calib : { [trackKey]: {bpm, phase, source} } (persisté via saveCalib)
     */
    #busPtr = new Map(); // passerelle -> prochaine lampe de sa vague
    #busSeen = new Map(); // passerelle -> lampes passées depuis le début de l'étape
    #statusCache = null; // contexte calculé pour l'interface (synchro coupée, ou boucle pas encore à jour)

    /**
     * dispatcher (facultatif) : débit restant de chaque passerelle et coût réel de chaque changement ; sans lui, les lampes
     * changent par groupes fixes (capacity).
     */
    constructor({ music, songs, loadShows, apply, getLamps, settings, calib, saveCalib, rooms = null, getSpeakers = () => [], capacity = null, dispatcher = null }) {
        super();
        Object.assign(this, { music, songs, loadShows, apply, getLamps, settings, calib, saveCalib, rooms, getSpeakers, capacity, dispatcher });
        music.on("state", () => {
            this.#emit();
            if (this.music.state.playing) this.#wake();
        });
    }

    // ------------------------------------------------------------------ commandes

    setEnabled(on) {
        if (this.enabled && !on && this.#active) this.emit("player", { playing: false, sync: true, showId: null, step: -1 });
        this.enabled = !!on;
        this.#active = false;
        this.#inactiveKey = "";
        clearTimeout(this.#timer);
        this.#timer = null;
        this.#wake();
        this.refresh();
    }

    // La boucle ne tourne que pendant la lecture : elle se réveille pile à chaque temps (10 fois par seconde au moins,
    // pour suivre un changement de morceau ou une pause) et s'endort quand rien ne joue.
    #wake() {
        if (this.enabled && !this.#timer) this.#timer = setTimeout(() => this.#loop(), 0);
    }
    #loop() {
        this.#timer = null;
        if (!this.enabled) return;
        const next = this.#tick();
        if (next != null) this.#timer = setTimeout(() => this.#loop(), next);
    }

    setChoice(choice) {
        this.choice = choice || "auto";
        this.refresh();
    }

    /** À appeler quand un show, un réglage, une analyse ou un calage change. */
    refresh() {
        this.#version++;
        this.#emit();
    }

    setEnergy(level) {
        this.#energy = { level: Math.max(0, Math.min(1, Number(level) || 0)), at: Date.now() };
    }

    /** Calage venant des tapes (« tap ») ou du micro (« micro »). positions = instants en secondes dans le morceau. */
    tap(taps) {
        const st = this.music.state;
        if (!st.playing || !st.track) throw new Error("Lance d'abord un morceau dans Musique");
        // la personne tape sur ce qu'elle entend : le calage intègre donc aussi le retard AirPlay
        const positions = taps.map(t => this.music.positionAt(t));
        const ref = this.#bestBpm(st).bpm;
        const { bpm, phase } = fitTaps(positions, ref);
        this.#saveCalib(st, { bpm, phase, source: "tap" });
        return { bpm, phase };
    }

    calibrate({ key, bpm, phase, confidence }) {
        const st = this.music.state;
        if (!st.track || key !== trackKey(st.track)) throw new Error("Ce n'est plus le morceau en cours");
        bpm = normalizeBpm(bpm);
        if (!bpm || !(phase >= 0)) throw new Error("Calage invalide");
        const old = this.calib[key];
        const period = 60 / bpm;
        if (old?.source === "micro" && Math.abs(old.bpm - bpm) < 0.6) {
            // lissage (moyenne circulaire) pour éviter les sauts
            const a = (2 * Math.PI * old.phase) / period;
            const b = (2 * Math.PI * phase) / period;
            const x = 0.6 * Math.cos(a) + 0.4 * Math.cos(b);
            const y = 0.6 * Math.sin(a) + 0.4 * Math.sin(b);
            phase = ((((Math.atan2(y, x) / (2 * Math.PI)) * period) % period) + period) % period;
        }
        if (old?.source === "tap" && Date.now() - (old.at ?? 0) < 60_000) return old; // un tap récent reste prioritaire
        return this.#saveCalib(st, { bpm, phase, source: "micro", confidence });
    }

    #saveCalib(st, data) {
        const key = trackKey(st.track);
        this.calib[key] = { ...data, phase: Math.round(data.phase * 1000) / 1000, at: Date.now(), title: st.track.name, artist: st.track.artist };
        this.saveCalib(this.calib);
        this.refresh();
        return this.calib[key];
    }

    resetCalib() {
        const key = trackKey(this.music.state.track);
        delete this.calib[key];
        this.saveCalib(this.calib);
        this.refresh();
    }

    // ------------------------------------------------------------------ choix du show et du tempo

    #bestBpm(st) {
        const key = trackKey(st.track);
        const info = this.songs.get(key) ?? {};
        const known = lookupKnown(st.track);
        if (known) return { bpm: known, source: "base intégrée" };
        // pulsation peu nette sur l'extrait (rubato, orchestre…) : le tempo Deezer est plus sûr
        if (info.features?.pulse < 0.06 && info.deezerBpm) return { bpm: normalizeBpm(info.deezerBpm), source: "base Deezer" };
        if (info.analysisBpm) return { bpm: normalizeBpm(info.analysisBpm), source: info.features?.pulse < 0.06 ? "mesuré sur l'extrait (incertain)" : "mesuré sur l'extrait" };
        if (info.deezerBpm) return { bpm: normalizeBpm(info.deezerBpm), source: "base Deezer" };
        const fromMusic = normalizeBpm(st.track?.bpm);
        if (fromMusic) return { bpm: fromMusic, source: "app Musique" };
        return { bpm: 0, source: "" };
    }

    #resolveTempo(st, fallbackBpm) {
        const key = trackKey(st.track);
        const c = this.calib[key];
        if (c?.bpm) return { bpm: c.bpm, phase: c.phase ?? 0, source: c.source === "micro" ? "calé au micro" : "calé au tap", calibrated: true };
        const best = this.#bestBpm(st);
        if (best.bpm) return { bpm: best.bpm, phase: 0, source: best.source, calibrated: false };
        return { bpm: fallbackBpm || 120, phase: 0, source: "tempo estimé (à caler)", calibrated: false };
    }

    #matchShow(st, shows) {
        const fields = [
            ["playlist", st.playlist],
            ["genre", st.track?.genre],
            ["titre", st.track?.name],
            ["album", st.track?.album],
            ["artiste", st.track?.artist],
        ];
        for (const [label, value] of fields) {
            const v = ` ${norm(value)} `;
            if (!v.trim()) continue;
            for (const s of shows) {
                const kws = (s.music?.match ?? []).map(norm).filter(Boolean);
                if (kws.some(k => v.includes(` ${k} `) || v.includes(` ${k}`))) return { show: s, why: `${label} « ${value} »` };
            }
        }
        return null;
    }

    #build(st, key = trackKey(st.track)) {
        const info = this.songs.get(key) ?? {};
        const features = info.featuresV === 2 ? info.features ?? null : null;
        const shows = this.loadShows().filter(s => s.steps?.length);
        let picked = null;
        const autoMode = AUTO_CHOICES[this.choice] ?? null;
        const mine = this.choice === MY_COLORS;
        if (!autoMode && !mine) {
            const s = shows.find(x => x.id === this.choice);
            if (s) picked = { show: s, why: "choisi à la main" };
        } else if (autoMode === "complet" || autoMode === "sobre") {
            picked = this.#matchShow(st, shows); // Noël, Halloween… (pas en « pochette » ni « nuances » : couleurs de la pochette uniquement)
        }
        const mode = autoMode ?? "complet";
        let tempo = this.#resolveTempo(st, picked?.show?.tempo?.bpm);
        const genre = detectGenre({ track: st.track, playlist: st.playlist, info, features, bpm: tempo.bpm });
        const energy = musicEnergy({ features, info, fam: genre.id, bpm: tempo.bpm });
        if (!tempo.calibrated) {
            const felt = feltTempo({ bpm: tempo.bpm, fam: genre.id, energy: energy.value, measured: energy.measured });
            if (felt !== tempo.bpm) tempo = { ...tempo, bpm: Math.round(felt * 100) / 100, source: `${tempo.source}, joué en demi-tempo`, half: true };
        }
        const style = musicStyle({ bpm: tempo.bpm, fam: genre.id, energy: energy.value, pulse: features?.pulse, measured: energy.measured });
        const rhythm = rhythmFor(genre.id, style);
        let show = picked?.show ?? null;
        let why = picked?.why ?? "";
        let palette = null;
        let accent = null;
        if (!show && mine) {
            // mes couleurs : rangées en dégradé (calme, groove) ou en contraste (énergique)
            const chosen = this.myColors();
            const how = style === "energique" ? "contraste" : "degrade";
            const arranged = arrangeColors(chosen, how);
            palette = arranged.map(c => ({ c, src: "choisie", name: nameOf(c) }));
            accent = style === "energique" && arranged.length > 2 ? arranged[Math.floor(arranged.length / 2)] : null;
            show = makeAutoShow({ palette: arranged, style, bpm: tempo.bpm, title: st.track?.name, source: "choisie", accent, name: `Mes couleurs · ${st.track?.name ?? ""}` });
            why = `tes ${arranged.length} couleurs, rangées en ${how === "contraste" ? "contraste (morceau énergique)" : "dégradé"}`;
        }
        if (!show) {
            // pochette analysée (v2) ; sinon ancienne palette en attendant la nouvelle analyse
            const cover = info.paletteV === 2 ? info.cover : info.palette?.length ? { colors: info.palette } : null;
            const built = buildPalette({ cover, fam: genre.id, style, bpm: tempo.bpm, energy: energy.value, mode });
            palette = built.colors;
            accent = built.accent;
            const hasCover = !!cover?.colors?.length;
            const mono = info.paletteV === 2 && info.cover?.mono;
            const waiting = !cover && !!info.coverFile;
            show = makeAutoShow({ palette: palette.map(p => p.c), style, bpm: tempo.bpm, title: st.track?.name, source: hasCover ? "pochette" : "genre", accent, dim: built.dim });
            const note = mono ? " (pochette en noir et blanc : lumières blanches)" : waiting ? " (lecture de la pochette…)" : "";
            if (mode === "pochette") why = `couleurs de la pochette uniquement${mono || !hasCover ? note || " (pas de pochette : lumières blanches)" : ""}`;
            else if (mode === "nuances") why = hasCover ? `nuances de la pochette : ${nuanceLabel(genre.id, style)} (${genre.label})` : `nuances de blanc${note}`;
            else if (mode === "sobre") why = hasCover ? `pochette + 2 couleurs d'ambiance ${genre.label}` : `2 couleurs d'ambiance ${genre.label}${note}`;
            else why = hasCover ? `pochette + ambiance ${genre.label}` : `ambiance ${genre.label}${note}`;
        }
        return { key, ck: `${key}|${this.choice}|${this.#version}`, show, why, tempo, style, genre, energy, rhythm, palette, accent, info };
    }

    // ------------------------------------------------------------------ boucle

    /** Traite le temps en cours ; renvoie dans combien de ms revenir (null : rien ne joue). */
    #tick() {
        const st = this.music.state;
        if (!st.playing || !st.track) {
            if (this.#active) {
                this.#active = false;
                this.emit("player", { playing: false, sync: true, showId: this.#ctx?.show?.id ?? null, step: -1 });
            }
            return null;
        }
        const key = trackKey(st.track);
        const ck = `${key}|${this.choice}|${this.#version}`;
        if (!this.#ctx || this.#ctx.ck !== ck) {
            const newTrack = this.#ctx?.key !== key;
            this.#ctx = this.#statusCache?.ck === ck ? this.#statusCache : this.#build(st, key); // déjà calculé pour la page : réutilisé
            if (newTrack) {
                this.#applied.clear();
                this.#stepToken = "";
            }
            this.#beat = null;
            this.#emit();
        }
        const { bpm, phase } = this.#ctx.tempo;
        const beatSec = 60 / bpm;
        const lead = Number(this.settings.musicLead ?? 0.15);
        const b = (this.music.positionAt() + lead - phase) / beatSec;
        const k = Math.floor(b);
        const untilNext = Math.min(100, Math.max(2, Math.ceil((k + 1 - b) * beatSec * 1000) + 1));
        if (k === this.#beat) return untilNext;
        // position relue un peu en arrière (moins d'un demi-temps) : ce temps a déjà été joué
        if (this.#beat !== null && k < this.#beat && this.#beat - b < 0.5) return Math.min(100, Math.max(2, Math.ceil((this.#beat + 1 - b) * beatSec * 1000) + 1));
        if (this.#beat !== null && (k < this.#beat || k > this.#beat + 8)) this.#applied.clear(); // saut dans le morceau
        this.#beat = k;
        this.#active = true;
        this.#onBeat(k, beatSec);
        return untilNext;
    }

    /** Couleurs « Mes couleurs » valides (jusqu'à 6). */
    myColors() {
        const list = (this.settings.myColors ?? []).filter(c => isHex(c) || isKelvin(c)).slice(0, 6);
        return list.length ? list : DEFAULT_MY_COLORS;
    }

    /** Plan des pièces (si des pièces sont définies) : pièces actives, lampes des pièces sans musique. */
    #plan(lamps) {
        const coh = this.settings.coherence ?? "off";
        if (!this.rooms || (coh === "off" && !this.settings.speakerLink)) return null;
        return this.rooms.plan(lamps, { activeSpeakers: this.getSpeakers(), speakerLink: !!this.settings.speakerLink });
    }

    /** Pièces où la musique ne passe pas : blanc doux, éteintes ou inchangées (une seule fois, à chaque changement). */
    #handleInactive(inactive) {
        const other = this.settings.otherRooms ?? "blanc";
        const key = `${other}|${inactive.map(l => l.id).sort().join(",")}`;
        if (key === this.#inactiveKey) return;
        const before = new Set(this.#inactiveKey.split("|")[1]?.split(",").filter(Boolean) ?? []);
        this.#inactiveKey = key;
        for (const id of before) if (!inactive.some(l => l.id === id)) this.#applied.delete(id); // pièce redevenue active : nouvelles couleurs
        const state = OTHER_ROOMS[other];
        if (!state || !inactive.length) return;
        const targets = {};
        for (const l of inactive) {
            targets[l.id] = state;
            this.#applied.set(l.id, "inactive");
        }
        this.apply(targets, 2);
    }

    /** Étape du show au temps k (durées en temps entiers, allongées pour que la vague ait le temps de passer). */
    #stepAt(k, beatSec, cycle) {
        const show = this.#ctx.show;
        const units = show.tempo?.bpm ? 1 : 1 / beatSec;
        const base = show.steps.map(s => Math.max(1, Math.round((Number(s.duration) || 1) * units)));
        const sorted = [...base].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        let stretch = 1;
        while (median * stretch < cycle && stretch < 16) stretch *= 2;
        const durs = base.map(d => d * stretch);
        const total = durs.reduce((a, c) => a + c, 0);
        const loop = Math.floor(k / total);
        let rest = ((k % total) + total) % total;
        let idx = 0;
        while (idx < durs.length - 1 && rest >= durs[idx]) rest -= durs[idx++];
        if (loop > 0 && !show.loop) idx = durs.length - 1;
        const step = show.steps[idx];
        const token = `${loop}:${idx}`;
        const changed = token !== this.#stepToken;
        if (changed) {
            this.#stepToken = token;
            this.#ptr = 0;
            this.emit("player", {
                playing: true,
                sync: true,
                showId: show.id,
                step: idx,
                stepStartedAt: Date.now() - rest * beatSec * 1000,
                stepDuration: durs[idx] * beatSec,
                loop: !!show.loop,
            });
        }
        const colorFade = Math.min(2, Math.max(0, Number(step.fade) || 0) * units * stretch) * beatSec;
        return { step, idx, token, changed, colorFade };
    }

    /** État avec l'accent de ce temps (luminosité baissée sur les temps faibles), si l'intensité du rythme le demande. */
    #withAccent(state, depth, level) {
        return state?.on && depth > 0 && level < 0.999 ? { ...state, brightness: Math.max(4, Math.round(state.brightness * level)) } : state;
    }

    /** Profondeur des accents et niveau de ce temps d'après le motif du genre. */
    #accentLevel(k, factor = 1) {
        const ctx = this.#ctx;
        const setting = this.settings.rhythmIntensity ?? "auto";
        let depth = setting in INTENSITY ? INTENSITY[setting] : STYLE_DEPTH[ctx.style] ?? 0.5;
        if (Date.now() - this.#energy.at < 4000) depth = Math.min(0.9, depth * (0.55 + 0.9 * this.#energy.level));
        depth *= factor;
        // motif d'accents du genre : le temps le plus fort reste à pleine luminosité, le plus faible baisse de « depth »
        const beats = ctx.rhythm.beats;
        const a = beats[((k % beats.length) + beats.length) % beats.length];
        const hi = Math.max(...beats), lo = Math.min(...beats);
        return { depth, level: 1 - depth * (hi > lo ? (hi - a) / (hi - lo) : 0) };
    }

    #onBeat(k, beatSec) {
        const ctx = this.#ctx;
        const all = this.getLamps();
        if (!all.length) return;
        const plan = this.#plan(all);
        this.#handleInactive(plan?.inactive ?? []);
        const lamps = plan ? plan.groups.flatMap(g => g.lamps) : all;
        const N = lamps.length;
        if (!N) return;
        const realN = lamps.filter(l => !l.virtual).length;
        const rate = Math.max(1, Number(this.settings.rate) || 10);
        // nombre de lampes qu'on peut changer par temps sans saturer le pont (≈ 1,15 commande par lampe)
        const G = !realN ? N : this.capacity ? this.capacity(lamps, beatSec) : Math.max(1, Math.min(N, Math.floor((rate * beatSec * 0.9) / 1.15)));
        this.#lastGroup = G;
        const coh = this.settings.coherence ?? "off";
        if (plan && coh !== "off") return this.#onBeatRooms(k, beatSec, plan.groups, G, coh);

        const sel = this.#stepAt(k, beatSec, Math.ceil(N / G));
        const targets = resolveStep(sel.step, lamps);
        const { depth, level } = this.#accentLevel(k);
        const colorFade = Math.min(sel.colorFade, beatSec * 0.9);
        const colorTargets = {};
        const accentTargets = {};
        /** Ce que ce temps ferait à la lampe : nouvelle couleur, accent de luminosité, ou rien. */
        const planFor = lamp => {
            const t = targets[lamp.id];
            if (!t) return null; // lampe « inchangée » dans ce show
            // nouvelle couleur : elle arrive déjà avec l'accent de ce temps (sinon, avec beaucoup de lampes ou un morceau
            // énergique, chaque passage est un changement de couleur et l'intensité du rythme ne se verrait jamais)
            if (this.#applied.get(lamp.id) !== sel.token) return { kind: "color", state: this.#withAccent(t, depth, level) };
            if (!t.on || depth <= 0 || this.#high.get(lamp.id) === level) return null; // rien ne changerait
            return { kind: "accent", state: this.#withAccent(t, depth, level) };
        };
        const take = (lamp, p) => {
            if (!p) return;
            if (p.kind === "color") {
                colorTargets[lamp.id] = p.state;
                this.#applied.set(lamp.id, sel.token);
                this.#high.set(lamp.id, depth > 0 ? level : 1);
            } else {
                this.#high.set(lamp.id, level);
                accentTargets[lamp.id] = p.state;
            }
        };
        if (this.dispatcher) this.#waveByBus(lamps, beatSec, sel, planFor, take, colorFade);
        else {
            for (let i = 0; i < G; i++) {
                const lamp = lamps[(this.#ptr + i) % N];
                take(lamp, planFor(lamp));
            }
            this.#ptr = (this.#ptr + G) % N;
        }
        if (Object.keys(colorTargets).length) this.apply(colorTargets, colorFade);
        const feel = ctx.rhythm.feelSpec;
        if (Object.keys(accentTargets).length) this.apply(accentTargets, Math.min(feel.max, beatSec * feel.frac));
    }

    /**
     * Vague passerelle par passerelle : chaque pont (Hue, ampoule Thread, Home Assistant…) avance dans ses propres lampes,
     * à son propre débit. Une lampe n'est prise que si sa passerelle peut envoyer ses commandes pendant ce temps :
     * les lampes changent moins nombreuses mais à l'heure, au lieu de s'empiler en retard dans la file.
     */
    #waveByBus(lamps, beatSec, sel, planFor, take, colorFade) {
        const buses = new Map(); // passerelle -> lampes, dans l'ordre
        for (const l of lamps) {
            const b = l.virtual ? "virtuel" : (l.bus ?? "defaut");
            if (!buses.has(b)) buses.set(b, []);
            buses.get(b).push(l);
        }
        for (const [bus, list] of buses) {
            const n = list.length;
            // nouvelle étape : la vague repart de la 1re lampe… si la précédente a eu le temps de passer partout
            if (sel.changed) {
                if ((this.#busSeen.get(bus) ?? n) >= n) this.#busPtr.set(bus, 0);
                this.#busSeen.set(bus, 0);
            }
            let ptr = (this.#busPtr.get(bus) ?? 0) % n;
            const virtual = bus === "virtuel";
            const rate = virtual ? Infinity : this.dispatcher.rateOf(bus);
            const full = rate * beatSec * 0.9;
            let budget = virtual ? Infinity : this.dispatcher.budget(bus, beatSec);
            const quota = virtual ? n : Math.max(1, Math.min(n, Math.floor(full / 1.15))); // lampes visitées par temps
            let visited = 0;
            while (visited < quota) {
                const lamp = list[ptr];
                const p = planFor(lamp);
                const cost = p && !virtual ? this.dispatcher.costOf(lamp, p.state, p.kind === "color" ? colorFade : 0) : 0;
                // passerelle trop chargée pour cette lampe : elle passera en premier au prochain temps
                // (une passerelle libre prend toujours au moins une lampe, même lente)
                if (cost > budget && !(visited === 0 && budget >= full - 0.01)) break;
                budget -= cost;
                take(lamp, p);
                ptr = (ptr + 1) % n;
                visited++;
            }
            this.#busPtr.set(bus, ptr);
            this.#busSeen.set(bus, (this.#busSeen.get(bus) ?? 0) + visited);
        }
    }

    /**
     * Cohérence par pièce. Chaque pièce a une couleur dominante (nuancée entre ses lampes) et change d'un bloc.
     *  - ambiance : une pièce après l'autre, fondus longs, respiration douce, couleurs qui durent ;
     *  - vague    : à chaque nouvelle étape, la couleur part de la 1ʳᵉ pièce et avance pièce par pièce dans l'ordre choisi ;
     *  - piece    : une pièce entière par temps (ou plusieurs petites), les pièces se répondent sur le rythme.
     */
    #onBeatRooms(k, beatSec, groups, G, coh) {
        const ctx = this.#ctx;
        const weight = g => Math.max(1, Math.ceil(g.lamps.length / G));
        let slots = [];
        if (coh === "vague") slots = groups.map(g => ({ rooms: [g], w: weight(g) }));
        else {
            let cur = null;
            for (const g of groups) {
                if (cur && cur.n + g.lamps.length <= G) {
                    cur.rooms.push(g);
                    cur.n += g.lamps.length;
                } else {
                    cur = { rooms: [g], n: g.lamps.length, w: weight(g) };
                    slots.push(cur);
                }
            }
        }
        const cycle = slots.reduce((a, s) => a + s.w, 0);
        const sel = this.#stepAt(k, beatSec, coh === "ambiance" ? cycle * 2 : cycle);
        if (sel.changed && coh === "vague") {
            this.#slotPtr = 0;
            this.#slotWait = 0;
        }
        if (this.#slotWait > 0) {
            this.#slotWait--; // une grande pièce est encore en train de changer
            return;
        }
        const slot = slots[this.#slotPtr % slots.length];
        this.#slotPtr = (this.#slotPtr + 1) % slots.length;
        this.#slotWait = slot.w - 1;

        const strength = coh === "ambiance" ? 1 : 0.7;
        const targets = roomTargets(sel.step, groups, strength);
        const { depth, level } = this.#accentLevel(k, coh === "ambiance" ? 0.5 : 1);
        const colorTargets = {};
        const accentTargets = {};
        for (const g of slot.rooms) {
            const needsColor = g.lamps.some(l => targets[l.id] && this.#applied.get(l.id) !== sel.token);
            for (const l of g.lamps) {
                const t = targets[l.id];
                if (!t) continue;
                if (needsColor) {
                    colorTargets[l.id] = this.#withAccent(t, depth, level); // la couleur arrive avec l'accent de ce temps
                    this.#applied.set(l.id, sel.token);
                    this.#high.set(l.id, depth > 0 ? level : 1);
                } else if (t.on && depth > 0 && this.#high.get(l.id) !== level) {
                    this.#high.set(l.id, level);
                    accentTargets[l.id] = this.#withAccent(t, depth, level);
                }
            }
        }
        const fade = coh === "ambiance" ? Math.max(sel.colorFade, beatSec * 1.5) : Math.min(sel.colorFade, beatSec * 0.9);
        if (Object.keys(colorTargets).length) this.apply(colorTargets, Math.min(fade, 3));
        const feel = coh === "ambiance" ? { max: 0.8, frac: 0.8 } : ctx.rhythm.feelSpec;
        if (Object.keys(accentTargets).length) this.apply(accentTargets, Math.min(feel.max, beatSec * feel.frac));
    }

    /** Pièces vues par la synchro (pour l'interface). */
    roomsStatus() {
        if (!this.rooms) return null;
        const lamps = this.getLamps();
        const p = this.rooms.plan(lamps, { activeSpeakers: this.getSpeakers(), speakerLink: !!this.settings.speakerLink });
        return {
            coherence: this.settings.coherence ?? "off",
            speakerLink: !!this.settings.speakerLink,
            otherRooms: this.settings.otherRooms ?? "blanc",
            groups: p.groups.map(g => ({ id: g.id, name: g.name, lamps: g.lamps.length })),
            inactive: p.inactive.length,
            linked: p.linked,
            defined: this.rooms.list().length,
        };
    }

    // ------------------------------------------------------------------ état pour l'interface

    status() {
        const st = this.music.state;
        let ctx = null;
        if (st.track) {
            const key = trackKey(st.track);
            const ck = `${key}|${this.choice}|${this.#version}`;
            // contexte de la boucle s'il est à jour ; sinon calculé ici (juste après un calage, une analyse, un réglage…)
            if (this.#ctx?.ck === ck) ctx = this.#ctx;
            else ctx = this.#statusCache?.ck === ck ? this.#statusCache : (this.#statusCache = this.#build(st, key));
        }
        const info = ctx?.info ?? {};
        return {
            enabled: this.enabled,
            choice: this.choice,
            autoMode: AUTO_CHOICES[this.choice] ?? null,
            trackKey: ctx?.key ?? null,
            showId: ctx?.show?.id ?? null,
            showName: ctx?.show?.name ?? null,
            auto: !!ctx?.show?.auto,
            palette: ctx?.palette ?? null,
            accent: ctx?.accent ?? null,
            reason: ctx?.why ?? "",
            tempo: ctx?.tempo ?? null,
            style: ctx?.style ?? null,
            styleLabel: ctx?.style ? STYLE_LABEL[ctx.style] : null,
            genre: ctx?.genre ?? null,
            energy: ctx?.energy ?? null,
            features: info.featuresV === 2 ? info.features ?? null : null,
            rhythm: ctx?.rhythm ? { id: ctx.rhythm.id, label: ctx.rhythm.label, feel: ctx.rhythm.feel } : null,
            cover: info.paletteV === 2 && info.cover ? { names: (info.cover.colors ?? []).map(c => c.name), mono: !!info.cover.mono, light: info.cover.light } : null,
            intensity: this.settings.rhythmIntensity ?? "auto",
            myColors: this.myColors(),
            rooms: this.roomsStatus(),
            lampsPerBeat: this.#lastGroup || null,
            realLamps: this.getLamps().filter(l => !l.virtual).length,
            calibrated: !!ctx?.tempo?.calibrated,
            hasCover: !!info.coverFile,
            hasPreview: !!info.previewFile,
            needs: ctx
                ? {
                      audio: !!info.previewFile && (!info.features || info.featuresV !== 2 || (!info.analysisBpm && !lookupKnown(st.track))),
                      palette: !!info.coverFile && info.paletteV !== 2,
                  }
                : null,
        };
    }

    autoShow() {
        return this.#ctx?.show?.auto ? this.#ctx.show : null;
    }

    #emit() {
        this.emit("status", this.status());
    }
}
