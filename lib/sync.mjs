// Synchronisation des lumières sur la musique jouée par l'app Musique (Apple Music).
//
// Principe : une horloge de temps musicaux (tempo + calage) suit la position du morceau.
// À CHAQUE TEMPS, un groupe de lampes change (autant que le pont peut en passer) :
//  - si l'étape du show a changé, le groupe prend les nouvelles couleurs → les couleurs se propagent en vague ;
//  - sinon, le groupe fait un « accent » de luminosité (fort sur le 1er temps de la mesure).
// Les couleurs viennent du show choisi, ou d'un show automatique (pochette / genre / Noël / Halloween).
import { EventEmitter } from "node:events";
import { fitTaps, lookupKnown, norm, normalizeBpm, trackKey } from "./tempo.mjs";
import { resolveStep } from "./show.mjs";
import { enrichPalette, genrePalette, makeAutoShow, musicStyle, STYLE_LABEL } from "./autoshow.mjs";

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

    /**
     * music : AppleMusic ; songs : SongInfo ; loadShows() -> [shows complets] ; apply(targets, fadeSec) ; getLamps()
     * calib : { [trackKey]: {bpm, phase, source} } (persisté via saveCalib)
     */
    constructor({ music, songs, loadShows, apply, getLamps, settings, calib, saveCalib }) {
        super();
        Object.assign(this, { music, songs, loadShows, apply, getLamps, settings, calib, saveCalib });
        music.on("state", () => this.#emit());
    }

    // ------------------------------------------------------------------ commandes

    setEnabled(on) {
        if (this.enabled && !on && this.#active) this.emit("player", { playing: false, sync: true, showId: null, step: -1 });
        this.enabled = !!on;
        this.#active = false;
        clearInterval(this.#timer);
        this.#timer = this.enabled ? setInterval(() => this.#tick(), 25) : null;
        this.refresh();
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
    recompute() {
        this.refresh();
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
        if (info.analysisBpm) return { bpm: normalizeBpm(info.analysisBpm), source: "mesuré sur l'extrait" };
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

    #build(st) {
        const key = trackKey(st.track);
        const info = this.songs.get(key) ?? {};
        const genre = st.track?.genre || info.appleGenre || "";
        const shows = this.loadShows().filter(s => s.steps?.length);
        let picked = null;
        if (this.choice !== "auto") {
            const s = shows.find(x => x.id === this.choice);
            if (s) picked = { show: s, why: "choisi à la main" };
        } else {
            picked = this.#matchShow(st, shows);
        }
        const tempo = this.#resolveTempo(st, picked?.show?.tempo?.bpm);
        const style = musicStyle(tempo.bpm, genre);
        let show = picked?.show ?? null;
        let why = picked?.why ?? "";
        let palette = null;
        if (!show) {
            const source = info.palette?.length ? "pochette" : "genre";
            palette = source === "pochette" ? enrichPalette(info.palette, genre) : genrePalette(genre);
            show = makeAutoShow({ palette, style, bpm: tempo.bpm, title: st.track?.name, source });
            why = source === "pochette" ? "couleurs de la pochette" : `couleurs du genre ${genre || "musical"}`;
        }
        return { key, ck: `${key}|${this.choice}|${this.#version}`, show, why, tempo, style, genre, palette, info };
    }

    // ------------------------------------------------------------------ boucle

    #tick() {
        const st = this.music.state;
        if (!st.playing || !st.track) {
            if (this.#active) {
                this.#active = false;
                this.emit("player", { playing: false, sync: true, showId: this.#ctx?.show?.id ?? null, step: -1 });
            }
            return;
        }
        const ck = `${trackKey(st.track)}|${this.choice}|${this.#version}`;
        if (!this.#ctx || this.#ctx.ck !== ck) {
            const newTrack = this.#ctx?.key !== trackKey(st.track);
            this.#ctx = this.#build(st);
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
        if (k === this.#beat) return;
        if (this.#beat !== null && (k < this.#beat || k > this.#beat + 8)) this.#applied.clear(); // saut dans le morceau
        this.#beat = k;
        this.#active = true;
        this.#onBeat(k, beatSec);
    }

    #onBeat(k, beatSec) {
        const ctx = this.#ctx;
        const show = ctx.show;
        const lamps = this.getLamps();
        const N = lamps.length;
        if (!N) return;
        const realN = lamps.filter(l => !l.virtual).length;
        const rate = Math.max(1, Number(this.settings.rate) || 10);
        // nombre de lampes qu'on peut changer par temps sans saturer le pont (≈ 1,15 commande par lampe)
        const G = realN ? Math.max(1, Math.min(N, Math.floor((rate * beatSec * 0.9) / 1.15))) : N;
        const cycle = Math.ceil(N / G);
        this.#lastGroup = G;

        // étapes en temps entiers, allongées si la vague n'a pas le temps de passer sur toutes les lampes
        const units = show.tempo?.bpm ? 1 : 60 / beatSec / 60;
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
        if (token !== this.#stepToken) {
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

        const targets = resolveStep(step, lamps);
        const group = [];
        for (let i = 0; i < G; i++) group.push(lamps[(this.#ptr + i) % N]);
        this.#ptr = (this.#ptr + G) % N;

        // intensité des accents : réglage, sinon style de la musique, modulée par l'énergie entendue au micro
        const setting = this.settings.rhythmIntensity ?? "auto";
        let depth = setting in INTENSITY ? INTENSITY[setting] : STYLE_DEPTH[ctx.style] ?? 0.5;
        if (Date.now() - this.#energy.at < 4000) depth = Math.min(0.9, depth * (0.55 + 0.9 * this.#energy.level));
        const downbeat = ((k % 4) + 4) % 4 === 0;
        const accentThisBeat = ctx.style !== "calme" || k % 2 === 0;

        const colorTargets = {};
        const accentTargets = {};
        for (const lamp of group) {
            const t = targets[lamp.id];
            if (!t) continue; // lampe « inchangée » dans ce show
            if (this.#applied.get(lamp.id) !== token) {
                colorTargets[lamp.id] = t;
                this.#applied.set(lamp.id, token);
                this.#high.set(lamp.id, true);
            } else if (t.on && depth > 0 && accentThisBeat) {
                const high = downbeat ? true : !this.#high.get(lamp.id);
                this.#high.set(lamp.id, high);
                accentTargets[lamp.id] = high ? t : { ...t, brightness: Math.max(4, Math.round(t.brightness * (1 - depth))) };
            }
        }
        const colorFade = Math.min(2, Math.max(0, Number(step.fade) || 0) * units * stretch) * beatSec;
        if (Object.keys(colorTargets).length) this.apply(colorTargets, Math.min(colorFade, beatSec * 0.9));
        if (Object.keys(accentTargets).length) this.apply(accentTargets, Math.min(0.15, beatSec * 0.3));
    }

    // ------------------------------------------------------------------ état pour l'interface

    status() {
        const st = this.music.state;
        const ctx = st.track ? (this.#ctx?.key === trackKey(st.track) && this.enabled ? this.#ctx : this.#build(st)) : null;
        const info = ctx?.info ?? {};
        return {
            enabled: this.enabled,
            choice: this.choice,
            trackKey: ctx?.key ?? null,
            showId: ctx?.show?.id ?? null,
            showName: ctx?.show?.name ?? null,
            auto: !!ctx?.show?.auto,
            palette: ctx?.palette ?? null,
            reason: ctx?.why ?? "",
            tempo: ctx?.tempo ?? null,
            style: ctx?.style ?? null,
            styleLabel: ctx?.style ? STYLE_LABEL[ctx.style] : null,
            intensity: this.settings.rhythmIntensity ?? "auto",
            lampsPerBeat: this.#lastGroup || null,
            realLamps: this.getLamps().filter(l => !l.virtual).length,
            calibrated: !!ctx?.tempo?.calibrated,
            hasCover: !!info.coverFile,
            hasPreview: !!info.previewFile,
            needs: ctx
                ? { tempo: !!info.previewFile && !info.analysisBpm && !lookupKnown(st.track), palette: !!info.coverFile && !info.palette }
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
