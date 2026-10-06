// Le logiciel en un seul objet (« ctx ») : réglages, lampes, musique, marche/arrêt… partagé par les routes de l'API.
// Chaque partie est préparée par son module (lamps, music, power) ; l'ordre des étapes de démarrage est dans start().
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { LiveEvents } from "./events.mjs";
import { setupLamps } from "./lamps.mjs";
import { setupMusic } from "./music.mjs";
import { setupPower } from "./power.mjs";
import { readJson, writeJson } from "../util.mjs";
import { versionInfo } from "../version.mjs";

export const STOP_COLOR_DEFAULT = { color: "2700K", brightness: 60 };

export function createContext({ root, port }) {
    const DATA = process.env.SHOW_DATA_DIR || join(root, "data"); // l'app « Show lumière » range ses données dans ~/Library/Application Support
    const paths = {
        root,
        data: DATA,
        shows: process.env.SHOW_SHOWS_DIR || join(root, "shows"),
        public: join(root, "public"),
        settings: join(DATA, "reglages.json"),
        lamps: join(DATA, "lampes.json"),
        rooms: join(DATA, "pieces.json"),
        integ: join(DATA, "systemes.json"), // autres systèmes : WiZ, Home Assistant, Zigbee2MQTT
        tempos: join(DATA, "tempos.json"),
        access: join(DATA, "acces.json"), // clé et code du contrôle depuis le téléphone
        networks: join(DATA, "reseaux.json"), // réseaux connus et appareils rattachés
        spotify: join(DATA, "spotify.json"), // connexion au compte Spotify (facultative)
        former: join(DATA, "anciens-appareils.json"),
    };
    for (const d of [paths.data, paths.shows]) mkdirSync(d, { recursive: true });

    const settings = { rate: 10, demo: false, musicLead: 0.15, rhythmIntensity: "auto", standby: false, stopColor: { ...STOP_COLOR_DEFAULT }, ...readJson(paths.settings, {}) };
    // contrôle depuis le téléphone (même Wi-Fi) : coupé par défaut ; Mac gardé éveillé tant qu'il est activé
    settings.remote = { enabled: false, keepAwake: true, ...(settings.remote ?? {}) };

    const events = new LiveEvents();
    const ctx = {
        port,
        paths,
        settings,
        saveSettings: () => writeJson(paths.settings, settings),
        lampPrefs: readJson(paths.lamps, {}), // id -> { alias, hidden, order }
        saveLampPrefs: () => writeJson(paths.lamps, ctx.lampPrefs),
        events,
        log: (level, msg) => events.log(level, msg),
        broadcast: (event, data) => events.broadcast(event, data),
        /** Réservé au Mac lui-même (pas depuis le téléphone). */
        onlyMac: (local, what = "Cette action") => {
            if (!local) throw Object.assign(new Error(`${what} se fait sur le Mac lui-même.`), { status: 403 });
        },
        // valeurs qui changent (les modules les lisent ici, jamais dans une copie)
        state: { currentNet: null, playerStatus: null, activeSpeakers: [], speakerNames: [], listeningHost: null },
    };

    setupLamps(ctx);
    setupMusic(ctx);
    setupPower(ctx);

    /** État complet pour la page (à la connexion, puis à chaque changement de structure). */
    const app = versionInfo();
    ctx.snapshot = ({ withLogs = false } = {}) => ({
        app: { ...app, build: ctx.pageBuild?.() ?? null },
        matter: { ready: ctx.hub.ready, error: ctx.hub.error, pairing: ctx.hub.pairing },
        nodes: ctx.hub.getNodes(),
        lamps: ctx.allLamps(),
        rooms: ctx.rooms.list(),
        integrations: ctx.integrationsInfo(),
        service: { mode: ctx.serviceMode(), mac: process.platform === "darwin", installed: ctx.serviceInstalled() },
        remote: { enabled: !!settings.remote.enabled, keepAwake: !!settings.remote.keepAwake, phones: events.phones },
        network: ctx.networkInfo(),
        shows: ctx.shows.list(),
        settings,
        player: ctx.state.playerStatus,
        music: ctx.musicInfo(),
        preview: ctx.preview,
        ...(withLogs ? { logs: events.logs.slice(-40) } : {}), // le journal arrive ensuite ligne par ligne (événement « log »)
    });
    let stateTimer = null;
    ctx.pushState = () => {
        if (!events.watched) return;
        clearTimeout(stateTimer);
        stateTimer = setTimeout(() => events.broadcast("state", ctx.snapshot()), 150);
    };
    /** Pièces, enceintes… changées : la synchro recalcule et la page se met à jour. */
    ctx.roomsChanged = () => {
        ctx.sync.refresh();
        ctx.pushState();
    };
    return ctx;
}
