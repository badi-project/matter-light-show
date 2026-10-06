// Musique : sources (Apple Music, Spotify, autres apps, Sonos, compte Spotify), infos des morceaux, synchro des lumières,
// enceintes qui jouent (pour « seulement les pièces où la musique passe ») et fichiers des shows.
import { existsSync, readdirSync, unlinkSync, watch } from "node:fs";
import { join } from "node:path";
import { MacAudio } from "../audio.mjs";
import { MacWatch } from "../macwatch.mjs";
import { AppleMusic, SimulatedMusic } from "../music.mjs";
import { SongInfo } from "../online.mjs";
import { Sonos } from "../sonos.mjs";
import { MusicHub, NowPlaying, SpotifyApp, SpotifyWeb } from "../sources.mjs";
import { MusicSync } from "../sync.mjs";
import { trackKey } from "../tempo.mjs";
import { readJson, writeJson } from "../util.mjs";

export function setupMusic(ctx) {
    const { paths, settings, log, state } = ctx;

    // ---------------------------------------------------------------- shows (fichiers JSON lisibles et modifiables à la main)
    // Gardés en mémoire (relus si un fichier change, même modifié à la main, ou au bout de 30 s) : la synchro et la page
    // les consultent souvent.
    const safeId = id => String(id ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
    const showPath = id => join(paths.shows, `${safeId(id)}.json`);
    let cache = null; // { at, all: [shows complets], list: [résumés] }
    const invalidate = () => (cache = null);
    try {
        watch(paths.shows, invalidate).on("error", () => {});
    } catch {}
    const read = () => {
        if (cache && Date.now() - cache.at < 30000) return cache;
        const all = readdirSync(paths.shows)
            .filter(f => f.endsWith(".json"))
            .map(f => {
                const s = readJson(join(paths.shows, f), null);
                return s && { ...s, id: f.slice(0, -5) };
            })
            .filter(Boolean);
        const list = all.map(s => ({ id: s.id, name: s.name ?? `${s.id}.json`, steps: s.steps?.length ?? 0 })).sort((a, b) => a.name.localeCompare(b.name));
        return (cache = { at: Date.now(), all, list });
    };
    ctx.shows = {
        safeId,
        path: showPath,
        list: () => read().list,
        load: id => {
            const file = showPath(id);
            if (!existsSync(file)) return null;
            return { ...readJson(file, {}), id: safeId(id) };
        },
        save: (id, show) => {
            writeJson(showPath(id), show);
            invalidate();
        },
        remove: id => {
            const file = showPath(id);
            if (existsSync(file)) unlinkSync(file);
            invalidate();
        },
        all: () => read().all,
    };

    // ---------------------------------------------------------------- sources de musique
    // Apple Music, Spotify (app), autres apps du Mac (« En cours de lecture »), Sonos, Spotify sur tous les appareils (compte)
    const spotifyWeb = (ctx.spotifyWeb = new SpotifyWeb({ load: () => readJson(paths.spotify, null), save: d => writeJson(paths.spotify, d), redirectUri: `http://127.0.0.1:${ctx.port}/api/spotify/callback` }));
    const macAudio = (ctx.macAudio = new MacAudio()); // sorties du Mac : Bluetooth, USB, HDMI, haut-parleurs…
    const sonos = (ctx.sonos = new Sonos({ hosts: (process.env.SONOS_HOSTS ?? "").split(",").filter(Boolean) }));
    const music = (ctx.music = new MusicHub({
        sources: { apple: process.env.MUSIC_SIM ? new SimulatedMusic() : new AppleMusic(), spotify: new SpotifyApp(), autre: new NowPlaying(), sonos, "spotify-web": spotifyWeb },
        choice: settings.musicSource ?? "auto",
    }));
    const songs = (ctx.songs = new SongInfo(paths.data, { fixtures: process.env.SONG_FIXTURES }));
    const sync = (ctx.sync = new MusicSync({
        music,
        songs,
        loadShows: () => ctx.shows.all(),
        apply: ctx.applyTargets,
        getLamps: ctx.activeLamps,
        settings,
        calib: readJson(paths.tempos, {}),
        saveCalib: c => writeJson(paths.tempos, c),
        rooms: ctx.rooms,
        getSpeakers: () => state.activeSpeakers,
        capacity: (lamps, seconds) => ctx.dispatcher.capacity(lamps, seconds),
        dispatcher: ctx.dispatcher,
    }));

    // ---------------------------------------------------------------- enceintes en cours de lecture
    /** Noms d'enceintes vus (proposés pour relier les pièces aux enceintes). */
    ctx.addSpeakerNames = list => {
        const names = new Set([...state.speakerNames, ...list.filter(Boolean)]);
        if (names.size !== state.speakerNames.length) state.speakerNames = [...names];
    };
    // Relu seulement quand c'est utile : pendant la lecture (toutes les 15 s, et à chaque changement de morceau ou de
    // source), et seulement ce qui compte pour la source suivie (la liste AirPlay pour Apple Music, la sortie du Mac pour
    // les autres apps). names = true : relit aussi toutes les sorties (noms proposés pour relier les pièces).
    const isComputer = d => /computer|ordinateur/i.test(d.kind ?? "");
    let speakersBusy = null;
    ctx.refreshSpeakers = ({ names = false } = {}) => (speakersBusy ??= readSpeakers(names === true).finally(() => (speakersBusy = null)));
    async function readSpeakers(names) {
        if (!music.available) return;
        try {
            const a = music.active;
            const list = a === "apple" || names ? await music.airplay() : []; // vide si l'app Musique est fermée
            const needMac = names || a === "spotify" || a === "autre" || (a === "apple" && list.some(d => d.selected && isComputer(d)));
            const macOut = needMac ? await macAudio.current(names ? 10000 : 60000).catch(() => null) : null; // sortie du Mac (Bluetooth, USB, TV…)
            const macNames = names ? (await macAudio.outputs().catch(() => [])).map(o => o.name) : macAudio.cachedNames();
            ctx.addSpeakerNames([...list.map(d => d.name), ...macNames, ...sonos.players.map(p => p.room)]);
            // enceintes qui jouent : AirPlay d'Apple Music (+ sortie du Mac si « Ordinateur » est coché), sortie du Mac pour
            // Spotify / Deezer / les autres apps, le groupe Sonos qui joue, ou l'appareil Spotify Connect (compte)
            const sel =
                a === "apple"
                    ? [...list.filter(d => d.selected && !isComputer(d)).map(d => d.name), ...(list.some(d => d.selected && isComputer(d)) && macOut ? [macOut.name] : [])]
                    : a === "spotify-web" && spotifyWeb.device
                      ? [spotifyWeb.device.name]
                      : a === "sonos"
                        ? [...(sonos.rooms ?? [])]
                        : (a === "spotify" || a === "autre") && macOut
                          ? [macOut.name]
                          : [];
            if (sel.join("|") !== state.activeSpeakers.join("|")) {
                state.activeSpeakers = sel;
                sync.refresh();
            }
        } catch {}
    }
    setInterval(() => {
        if (settings.speakerLink && sync.enabled && music.state.playing) ctx.refreshSpeakers();
    }, 15000).unref?.();
    setTimeout(() => ctx.refreshSpeakers({ names: true }), 3000);

    // veille macOS : lecture, pause, morceau suivant, apps ouvertes / fermées, sortie de veille signalés tout de suite
    const macWatch = (ctx.macWatch = new MacWatch());
    let watchAnnounced = false; // relancée chaque heure : annoncée une seule fois (et de nouveau après une panne)
    macWatch.on("proven", () => {
        music.watched = true;
        if (watchAnnounced) return;
        watchAnnounced = true;
        log("info", "Veille macOS active : la musique est suivie dès qu'elle change, sans relectures permanentes.");
    });
    macWatch.on("down", () => (music.watched = false));
    let watchWarned = false;
    macWatch.on("failed", why => {
        if (watchWarned) return;
        watchWarned = true;
        watchAnnounced = false;
        log("warn", `Veille macOS indisponible pour l'instant (${String(why).slice(0, 200)}) : la musique est relue régulièrement, comme avant.`);
    });
    macWatch.on("music", () => music.nudge());
    macWatch.on("nowplaying", () => music.nudge());
    macWatch.on("app", id => /^com\.(apple\.Music|spotify\.client)$/.test(id) && music.nudge());
    macWatch.on("wake", () => {
        music.nudge();
        ctx.netWatch.refresh().catch(() => {}); // le Mac a pu changer de réseau pendant sa veille
    });

    sync.on("player", ctx.onPlayer);
    // Vers la page : seulement quand quelque chose change. La page extrapole la position entre deux envois : elle n'est
    // renvoyée que si elle s'écarte (saut, pause), et au moins toutes les 15 s.
    let sent = { sig: null, at: 0, state: null };
    ctx.pushMusic = (force = false) => {
        if (!ctx.events.watched) return;
        const info = ctx.musicInfo();
        const { position, at, ...rest } = info.state;
        const sig = JSON.stringify([rest, info.sync, info.error, info.lead, info.source, info.available]);
        const p = sent.state;
        const drift = p && p.playing && info.state.playing ? Math.abs(p.position + (info.state.at - p.at) / 1000 - position) : 0;
        if (!force && sig === sent.sig && drift < 0.5 && Date.now() - sent.at < 15000) return;
        sent = { sig, at: Date.now(), state: info.state };
        ctx.broadcast("music", info);
    };
    sync.on("status", () => ctx.pushMusic());
    ctx.musicInfo = () => ({ available: music.available, error: music.error, state: music.state, sync: sync.status(), lead: settings.musicLead, source: music.info() });
    // à chaque nouveau morceau : pochette, extrait et tempo (une fois, puis en cache)
    music.on("state", (st, changed) => {
        if (!changed) return;
        if (settings.speakerLink && sync.enabled) ctx.refreshSpeakers();
        if (!st.track?.name) return;
        songs
            .lookup(trackKey(st.track), st.track)
            .then(() => {
                sync.refresh();
                ctx.pushMusic(true);
            })
            .catch(e => log("warn", `Infos du morceau indisponibles : ${e.message}`));
    });
    ctx.saveSyncSettings = () => {
        settings.syncChoice = sync.choice;
        settings.syncEnabled = sync.enabled;
        ctx.saveSettings();
    };
    ctx.stopSync = () => {
        if (sync.enabled) {
            sync.setEnabled(false);
            ctx.saveSyncSettings();
            log("info", "Synchro musique désactivée (show lancé à la main).");
        }
    };
}
