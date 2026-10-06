// API : musique (synchro, commandes, playlists, volume), analyses faites dans la page, calage du tempo, compte Spotify,
// « Mes couleurs » diffusées sans musique.
import { randomUUID } from "node:crypto";
import { arrangeColors } from "../palette.mjs";
import { roomTargets } from "../rooms.mjs";
import { resolveStep } from "../show.mjs";
import { clamp } from "../util.mjs";

const HEX = /^#[0-9a-f]{6}$/i;

export default ctx => {
    const { music, sync, songs, spotifyWeb, settings, log, onlyMac } = ctx;
    return {
        "POST /api/music/sync": async ({ body }) => {
            if ("choice" in body) sync.setChoice(body.choice);
            if ("enabled" in body) {
                if (body.enabled) {
                    ctx.player.stop();
                    ctx.leaveStandby({ resume: false });
                }
                sync.setEnabled(body.enabled);
            }
            ctx.saveSyncSettings(); // choix et état gardés au prochain démarrage
            ctx.updateKeepAwake();
            return { ok: true };
        },
        "POST /api/music/command": async ({ body }) => {
            await music.command(body.action, body.arg);
            return { ok: true };
        },
        "GET /api/music/playlists": async () => music.playlists(),
        "GET /api/music/airplay": async () => music.airplay(),
        // volume d'une enceinte AirPlay (name), général de l'app Musique (app: "apple") ou de la source suivie, de 0 à 100
        "POST /api/music/volume": async ({ body }) => {
            const v = Math.round(Number(body.volume));
            if (!(v >= 0 && v <= 100)) throw new Error("Volume invalide");
            if (body.name) await music.setDeviceVolume(String(body.name), v);
            else if (body.app === "apple") await music.sourceOf("apple").setVolume(v);
            else await music.setVolume(v);
            return { ok: true };
        },
        "GET /api/music/volume": async () => ({ volume: await music.getVolume() }),
        "POST /api/music/airplay": async ({ body }) => {
            await music.setAirplay(body.names);
            await ctx.refreshSpeakers();
            return music.airplay();
        },

        // résultats calculés dans la page : tempo et caractère de l'extrait, couleurs de la pochette
        "POST /api/music/analysis": async ({ body }) => {
            const data = {};
            const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? clamp(Number(v), lo, hi) : undefined);
            if (Number(body.bpm) > 0) data.analysisBpm = Math.round(Number(body.bpm) * 10) / 10;
            if (Array.isArray(body.palette) && body.palette.length) data.palette = body.palette.filter(c => HEX.test(c)).slice(0, 5);
            if (body.cover && typeof body.cover === "object") {
                const colors = (Array.isArray(body.cover.colors) ? body.cover.colors : [])
                    .filter(c => HEX.test(c?.hex))
                    .slice(0, 5)
                    .map(c => ({ hex: c.hex, name: String(c.name ?? "").slice(0, 20), share: num(c.share, 0, 1) }));
                data.cover = { colors, colorful: num(body.cover.colorful, 0, 1), light: num(body.cover.light, 0, 1), mono: !!body.cover.mono };
                data.palette = colors.map(c => c.hex);
                data.paletteV = 2;
            }
            if (body.features && typeof body.features === "object") {
                const f = body.features;
                data.features = {
                    energy: num(f.energy, 0, 1),
                    loudness: num(f.loudness, -90, 0),
                    dynamics: num(f.dynamics, 0, 60),
                    brightness: num(f.brightness, 0, 20000),
                    bass: num(f.bass, 0, 1),
                    air: num(f.air, 0, 1),
                    onsetRate: num(f.onsetRate, 0, 30),
                    pulse: num(f.pulse, -1, 1),
                };
                data.featuresV = 2;
            }
            if (!body.key || !Object.keys(data).length) throw new Error("Analyse vide");
            songs.merge(String(body.key), data);
            sync.refresh();
            return { ok: true };
        },
        "POST /api/music/calibrate": async ({ body }) => sync.calibrate(body),
        "POST /api/music/energy": async ({ body }) => {
            sync.setEnergy(body.level);
            return { ok: true };
        },
        "POST /api/music/save-auto": async () => {
            const show = sync.autoShow();
            if (!show) throw new Error("Aucun show automatique en cours");
            const id = `auto-${randomUUID().slice(0, 6)}`;
            const copy = { ...structuredClone(show), id, auto: undefined, name: show.name.replace(/^Auto · /, "Show · "), music: { match: [] } };
            ctx.shows.save(id, copy);
            ctx.pushState();
            return copy;
        },
        "POST /api/music/tap": async ({ body }) => {
            const r = sync.tap((Array.isArray(body.taps) ? body.taps : []).map(Number));
            log("success", `Tempo calé : ${r.bpm} BPM.`);
            return r;
        },
        "DELETE /api/music/calibration": async () => {
            sync.resetCalib();
            return { ok: true };
        },

        // mes couleurs : diffuser tout de suite (sans musique)
        "POST /api/mycolors/apply": async () => {
            const colors = arrangeColors(sync.myColors(), "degrade");
            const step = { mode: "palette", palette: { colors, brightness: 85 } };
            const lamps = ctx.activeLamps();
            const coh = settings.coherence ?? "off";
            const targets = coh !== "off" ? roomTargets(step, ctx.rooms.plan(lamps).groups, coh === "ambiance" ? 1 : 0.7) : resolveStep(step, lamps);
            ctx.player.stop(false);
            ctx.stopSync();
            ctx.applyTargets(targets, 1.5);
            return { ok: true, colors };
        },

        // compte Spotify (facultatif) : réglé sur le Mac
        "PUT /api/spotify": async ({ body, local }) => {
            onlyMac(local, "La connexion à Spotify");
            spotifyWeb.setClientId(body.clientId);
            ctx.pushMusic(true);
            return spotifyWeb.info();
        },
        "POST /api/spotify/disconnect": async ({ local }) => {
            onlyMac(local, "La déconnexion de Spotify");
            spotifyWeb.disconnect();
            log("info", "Compte Spotify déconnecté.");
            ctx.pushMusic(true);
            return spotifyWeb.info();
        },
    };
};
