// Show de lumière 100 % Matter — serveur local (contrôleur Matter + interface web).
// Lancer :  npm start   puis ouvrir http://localhost:8321
import { Logger } from "@matter/main";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { MatterHub } from "./lib/matter.mjs";
import { DeviceHub } from "./lib/devices.mjs";
import { WizDriver } from "./lib/drivers/wiz.mjs";
import { HomeAssistantDriver } from "./lib/drivers/homeassistant.mjs";
import { Zigbee2MqttDriver } from "./lib/drivers/zigbee2mqtt.mjs";
import { Dispatcher, Player, displayColor, resolveStep } from "./lib/show.mjs";
import { AppleMusic, SimulatedMusic } from "./lib/music.mjs";
import { MusicSync } from "./lib/sync.mjs";
import { Rooms, roomTargets } from "./lib/rooms.mjs";
import { SERVICE_LOG, installService, serviceInstalled, uninstallService } from "./lib/service.mjs";
import { RemoteAccess, isLoopback, loginPage, qrSvg } from "./lib/remote.mjs";
import { arrangeColors, isHex, isKelvin } from "./lib/palette.mjs";
import { SongInfo } from "./lib/online.mjs";
import { trackKey } from "./lib/tempo.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, "data");
const SHOWS = join(ROOT, "shows");
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT) || 8321;
for (const d of [DATA, SHOWS]) mkdirSync(d, { recursive: true });

Logger.level = process.env.MATTER_DEBUG ? "info" : "error";

// ---------------------------------------------------------------- persistance simple (JSON)
const readJson = (file, fallback) => {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
};
const writeJson = (file, data) => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
};
const SETTINGS_FILE = join(DATA, "reglages.json");
const LAMPS_FILE = join(DATA, "lampes.json");
const ROOMS_FILE = join(DATA, "pieces.json");
const INTEG_FILE = join(DATA, "systemes.json"); // autres systèmes : WiZ, Home Assistant, Zigbee2MQTT
const TEMPOS_FILE = join(DATA, "tempos.json");
const ACCESS_FILE = join(DATA, "acces.json"); // clé et code du contrôle depuis le téléphone
const settings = { rate: 10, demo: false, musicLead: 0.15, rhythmIntensity: "auto", standby: false, stopColor: { color: "2700K", brightness: 60 }, ...readJson(SETTINGS_FILE, {}) };
// contrôle depuis le téléphone (même Wi-Fi) : coupé par défaut ; Mac gardé éveillé tant qu'il est activé
settings.remote = { enabled: false, keepAwake: true, ...(settings.remote ?? {}) };
const lampPrefs = readJson(LAMPS_FILE, {}); // id -> { alias, hidden, order }
const rooms = new Rooms(readJson(ROOMS_FILE, {}), d => writeJson(ROOMS_FILE, d)); // pièces : lampes, ordre, enceintes
// autres systèmes domotiques (en plus de Matter)
const INTEG_DEFAULTS = {
    wiz: { enabled: false, ips: [] },
    ha: { enabled: false, url: "", token: "" },
    z2m: { enabled: false, host: "", port: 1883, username: "", password: "", base: "zigbee2mqtt" },
};
const integ = Object.fromEntries(Object.entries(INTEG_DEFAULTS).map(([k, v]) => [k, { ...v, ...(readJson(INTEG_FILE, {})[k] ?? {}) }]));

// ---------------------------------------------------------------- journal
const logs = [];
function log(level, msg) {
    const entry = { t: Date.now(), level, msg };
    logs.push(entry);
    if (logs.length > 150) logs.shift();
    console.log(`${new Date().toLocaleTimeString("fr-FR")}  ${level.toUpperCase().padEnd(7)} ${msg}`);
    broadcast("log", entry);
}

// ---------------------------------------------------------------- lampes (réelles + démo)
const DEMO_LAMPS = Array.from({ length: 6 }, (_, i) => ({
    id: `demo-${i + 1}`,
    nodeId: "demo",
    endpoint: i + 1,
    name: `Démo ${i + 1}`,
    kind: "color",
    caps: { level: true, xy: true, hs: true, ct: true },
    reachable: true,
    virtual: true,
}));

const hub = new MatterHub({ storagePath: join(DATA, "matter"), log });
const devices = new DeviceHub(hub); // Matter + autres systèmes
const SECRET = "••••••";
const DRIVERS = {
    wiz: c => new WizDriver({ log, ips: c.ips, broadcast: process.env.WIZ_BROADCAST || "255.255.255.255", port: Number(process.env.WIZ_PORT) || 38899 }),
    ha: c => new HomeAssistantDriver({ log, url: c.url, token: c.token }),
    z2m: c => new Zigbee2MqttDriver({ log, host: c.host, port: c.port, username: c.username, password: c.password, base: c.base }),
};
function startIntegration(id) {
    devices.removeDriver(id);
    const c = integ[id];
    if (!c?.enabled) return;
    const d = DRIVERS[id](c);
    devices.addDriver(d);
    d.start().catch(e => d.setState("erreur", e.message));
}
function integrationsInfo() {
    const st = Object.fromEntries(devices.statuses().map(x => [x.id, x]));
    return Object.fromEntries(
        Object.entries(integ).map(([id, c]) => [
            id,
            { ...c, token: c.token ? SECRET : "", password: c.password ? SECRET : "", status: st[id] ?? { state: c.enabled ? "démarrage…" : "désactivé", count: 0 } },
        ]),
    );
}

function allLamps() {
    const list = [...devices.getLamps(), ...(settings.demo ? DEMO_LAMPS : [])].map((l, i) => {
        const p = lampPrefs[l.id] ?? {};
        return { ...l, matterName: l.name, name: p.alias || l.name, hidden: !!p.hidden, order: p.order ?? 1000 + i, room: rooms.roomOf(l.id)?.id ?? null };
    });
    return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
const activeLamps = () => allLamps().filter(l => !l.hidden);

// ---------------------------------------------------------------- aperçu + envoi
const preview = {}; // lampId -> { on, color, display, brightness }
// débit par passerelle : pont Matter = réglage « Débit max » ; ampoule WiZ, Home Assistant, réseau Zigbee : valeurs sûres
const busRate = bus => (bus.startsWith("matter:") ? settings.rate : bus.startsWith("wiz:") ? 15 : bus === "ha" ? 15 : bus === "z2m" ? Math.max(settings.rate, 10) : settings.rate);
const dispatcher = new Dispatcher({ hub: devices, rate: settings.rate, log, busRate });

function applyTargets(targets, fade) {
    const byId = new Map(allLamps().map(l => [l.id, l]));
    const changes = {};
    for (const [id, state] of Object.entries(targets)) {
        const lamp = byId.get(id);
        if (!lamp) continue;
        preview[id] = state.on ? { ...state, display: displayColor(state.color, lamp.kind) } : { on: false };
        changes[id] = preview[id];
        if (!lamp.virtual && devices.hasLamp(id)) dispatcher.setTarget(lamp, state, fade);
    }
    broadcast("preview", { changes, fade });
}

const player = new Player({ apply: applyTargets, getLamps: activeLamps });
let playerStatus = player.status; // dernier état de lecture (show manuel ou synchro musique)
const onPlayer = s => {
    playerStatus = s;
    broadcast("player", s);
};
player.on("status", onPlayer);

// ---------------------------------------------------------------- musique (app Musique du Mac)
const music = process.env.MUSIC_SIM ? new SimulatedMusic() : new AppleMusic();
const songs = new SongInfo(DATA, { fixtures: process.env.SONG_FIXTURES });
const sync = new MusicSync({
    music,
    songs,
    loadShows: () => listShows().map(s => loadShow(s.id)).filter(Boolean),
    apply: applyTargets,
    getLamps: activeLamps,
    settings,
    calib: readJson(TEMPOS_FILE, {}),
    saveCalib: c => writeJson(TEMPOS_FILE, c),
    rooms,
    getSpeakers: () => activeSpeakers,
    capacity: (lamps, seconds) => dispatcher.capacity(lamps, seconds),
});

// enceintes AirPlay en cours de lecture (pour « seulement les pièces où la musique passe »)
let activeSpeakers = [];
let speakerNames = [];
async function refreshSpeakers() {
    if (!music.available) return;
    try {
        const list = await music.airplay();
        speakerNames = list.map(d => d.name);
        const sel = list.filter(d => d.selected).map(d => d.name);
        if (sel.join("|") !== activeSpeakers.join("|")) {
            activeSpeakers = sel;
            sync.refresh();
        }
    } catch {}
}
setInterval(() => {
    if (settings.speakerLink && sync.enabled) refreshSpeakers();
}, 15000);
setTimeout(refreshSpeakers, 3000);
sync.on("player", onPlayer);
sync.on("status", () => broadcast("music", musicInfo()));
function musicInfo() {
    return { available: music.available, error: music.error, state: music.state, sync: sync.status(), lead: settings.musicLead };
}
// à chaque nouveau morceau : pochette, extrait et tempo (une fois, puis en cache)
music.on("state", (st, changed) => {
    if (!changed || !st.track?.name) return;
    songs
        .lookup(trackKey(st.track), st.track)
        .then(() => {
            sync.refresh();
            broadcast("music", musicInfo());
        })
        .catch(e => log("warn", `Infos du morceau indisponibles : ${e.message}`));
});
const SERVE_TYPES = { ".jpg": "image/jpeg", ".png": "image/png", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
function saveSyncSettings() {
    settings.syncChoice = sync.choice;
    settings.syncEnabled = sync.enabled;
    writeJson(SETTINGS_FILE, settings);
}
function stopSync() {
    if (sync.enabled) {
        sync.setEnabled(false);
        saveSyncSettings();
        log("info", "Synchro musique désactivée (show lancé à la main).");
    }
}
dispatcher.on("pending", n => broadcast("pending", n));

// ---------------------------------------------------------------- shows
const safeId = id => String(id ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
const showPath = id => join(SHOWS, `${safeId(id)}.json`);
function listShows() {
    return readdirSync(SHOWS)
        .filter(f => f.endsWith(".json"))
        .map(f => {
            const s = readJson(join(SHOWS, f), null);
            return s && { id: f.slice(0, -5), name: s.name ?? f, steps: s.steps?.length ?? 0 };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
}
function loadShow(id) {
    const file = showPath(id);
    if (!existsSync(file)) return null;
    return { ...readJson(file, {}), id: safeId(id) };
}

// ---------------------------------------------------------------- SSE
const clients = new Set();
const phoneCount = () => [...clients].filter(c => c.remote).length;
function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
}
function snapshot() {
    return {
        matter: { ready: hub.ready, error: hub.error, pairing: hub.pairing },
        nodes: hub.getNodes(),
        lamps: allLamps(),
        rooms: rooms.list(),
        integrations: integrationsInfo(),
        service: { mode: serviceMode(), mac: process.platform === "darwin", installed: serviceInstalled() },
        remote: { enabled: !!settings.remote.enabled, keepAwake: !!settings.remote.keepAwake, phones: phoneCount() },
        shows: listShows(),
        settings,
        player: playerStatus,
        music: musicInfo(),
        preview,
        logs: logs.slice(-40),
    };
}
let stateTimer = null;
const pushState = () => {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => broadcast("state", snapshot()), 150);
};
devices.on("changed", () => {
    dispatcher.forget(); // après un changement de structure/connexion, on renverra tout
    pushState();
});

// ---------------------------------------------------------------- HTTP
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };

function send(res, code, data) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
}
async function body(req) {
    let raw = "";
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 2_000_000) throw new Error("Requête trop volumineuse");
    }
    return raw ? JSON.parse(raw) : {};
}

/** Réservé au Mac lui-même (pas depuis le téléphone). */
function onlyMac(local, what = "Cette action") {
    if (!local) throw Object.assign(new Error(`${what} se fait sur le Mac lui-même.`), { status: 403 });
}

const routes = {
    "GET /api/state": () => snapshot(),
    "GET /api/whoami": async ({ local }) => ({ local }),
    // contrôle depuis le téléphone : QR code, code et adresses (affichés seulement sur le Mac)
    "GET /api/remote": async ({ local }) => {
        onlyMac(local, "L'affichage du QR code");
        return remoteInfo();
    },
    "POST /api/remote/reset": async ({ local }) => {
        onlyMac(local, "Le changement de clé");
        remote.reset();
        return remoteInfo();
    },

    "POST /api/pair": async ({ body }) => {
        const code = body.code;
        MatterHub.parseCode(code); // valide avant de lancer
        hub.pair(code)
            .then(() => pushState())
            .catch(e => log("error", `Appairage échoué : ${e.message}. Vérifie que le code est récent (il expire après ~15 min) et que le Mac est sur le même réseau.`));
        return { ok: true };
    },
    "DELETE /api/nodes/:id": async ({ params }) => {
        await hub.removeNode(params.id);
        return { ok: true };
    },

    "PATCH /api/lamps/:id": async ({ params, body }) => {
        const p = (lampPrefs[params.id] ??= {});
        if ("alias" in body) p.alias = String(body.alias ?? "").slice(0, 60);
        if ("hidden" in body) p.hidden = !!body.hidden;
        writeJson(LAMPS_FILE, lampPrefs);
        pushState();
        return { ok: true };
    },
    "POST /api/lamps/order": async ({ body }) => {
        (body.ids ?? []).forEach((id, i) => ((lampPrefs[id] ??= {}).order = i));
        writeJson(LAMPS_FILE, lampPrefs);
        pushState();
        return { ok: true };
    },
    "POST /api/lamps/:id/identify": async ({ params }) => {
        const lamp = allLamps().find(l => l.id === params.id);
        if (!lamp) throw new Error("Lampe inconnue");
        broadcast("identify", { id: lamp.id });
        if (!lamp.virtual) dispatcher.identify(lamp);
        return { ok: true };
    },
    "POST /api/direct": async ({ body }) => {
        // réglage immédiat (hors show) : { ids?: [...], state: {on,color,brightness}, fade }
        player.stop();
        stopSync();
        const ids = body.ids?.length ? body.ids : activeLamps().map(l => l.id);
        const targets = Object.fromEntries(ids.map(id => [id, body.state ?? { on: false }]));
        applyTargets(targets, Number(body.fade) || 0.4);
        return { ok: true };
    },

    "GET /api/shows": () => listShows(),
    "GET /api/shows/:id": ({ params }) => {
        const s = loadShow(params.id);
        if (!s) throw Object.assign(new Error("Show introuvable"), { code: 404 });
        return s;
    },
    "POST /api/shows": async ({ body }) => {
        const id = safeId(body.id) || `show-${randomUUID().slice(0, 8)}`;
        const show = { name: "Nouveau show", loop: true, speed: 1, steps: [], ...body, id };
        writeJson(showPath(id), show);
        pushState();
        return show;
    },
    "PUT /api/shows/:id": async ({ params, body }) => {
        const id = safeId(params.id);
        const show = { ...body, id };
        writeJson(showPath(id), show);
        player.update(show);
        sync.refresh();
        broadcast("shows", listShows());
        return { ok: true };
    },
    "DELETE /api/shows/:id": async ({ params }) => {
        const file = showPath(params.id);
        if (existsSync(file)) unlinkSync(file);
        if (player.status.showId === params.id) player.stop();
        pushState();
        return { ok: true };
    },

    "POST /api/play": async ({ body }) => {
        const show = body.show ?? loadShow(body.id);
        if (!show) throw new Error("Show introuvable");
        stopSync();
        leaveStandby({ resume: false });
        player.play(show, Number(body.from) || 0);
        return { ok: true };
    },
    "POST /api/step": async ({ body }) => {
        const show = body.show ?? loadShow(body.id);
        stopSync();
        player.applyStep(show, Number(body.index) || 0);
        return { ok: true };
    },
    "POST /api/stop": async () => {
        player.stop();
        return { ok: true };
    },

    "POST /api/music/sync": async ({ body }) => {
        if ("choice" in body) sync.setChoice(body.choice);
        if ("enabled" in body) {
            if (body.enabled) {
                player.stop();
                leaveStandby({ resume: false });
            }
            sync.setEnabled(body.enabled);
        }
        saveSyncSettings(); // choix et état gardés au prochain démarrage
        return { ok: true };
    },
    "POST /api/music/command": async ({ body }) => {
        await music.command(body.action, body.arg);
        return { ok: true };
    },
    "GET /api/music/playlists": async () => music.playlists(),
    "GET /api/music/airplay": async () => music.airplay(),
    // volume d'une enceinte AirPlay (name) ou volume général de l'app Musique (sans name), de 0 à 100
    "POST /api/music/volume": async ({ body }) => {
        const v = Math.round(Number(body.volume));
        if (!(v >= 0 && v <= 100)) throw new Error("Volume invalide");
        if (body.name) await music.setDeviceVolume(String(body.name), v);
        else await music.setVolume(v);
        return { ok: true };
    },
    "GET /api/music/volume": async () => ({ volume: await music.getVolume() }),
    "POST /api/music/airplay": async ({ body }) => {
        await music.setAirplay(body.names);
        await refreshSpeakers();
        return music.airplay();
    },

    // ---------- autres systèmes (WiZ, Home Assistant, Zigbee2MQTT)
    "GET /api/integrations": async () => integrationsInfo(),
    "PUT /api/integrations/:id": async ({ params, body }) => {
        const c = integ[params.id];
        if (!c) throw new Error("Système inconnu");
        const keep = (k, v) => (v === SECRET ? c[k] : String(v ?? "").trim());
        if ("enabled" in body) c.enabled = !!body.enabled;
        if (params.id === "wiz" && "ips" in body) c.ips = String(body.ips ?? "").split(/[\s,;]+/).filter(x => /^\d{1,3}(\.\d{1,3}){3}$/.test(x)).slice(0, 50);
        if (params.id === "ha") {
            if ("url" in body) c.url = String(body.url ?? "").trim();
            if ("token" in body) c.token = keep("token", body.token);
        }
        if (params.id === "z2m") {
            if ("host" in body) c.host = String(body.host ?? "").trim();
            if ("port" in body) c.port = Number(body.port) || 1883;
            if ("username" in body) c.username = String(body.username ?? "").trim();
            if ("password" in body) c.password = keep("password", body.password);
            if ("base" in body) c.base = String(body.base ?? "").trim() || "zigbee2mqtt";
        }
        writeJson(INTEG_FILE, integ);
        startIntegration(params.id);
        pushState();
        return integrationsInfo()[params.id];
    },
    "POST /api/integrations/:id/refresh": async ({ params }) => {
        const d = devices.drivers.get(params.id);
        if (!d) throw new Error("Système désactivé");
        if (d.discover) d.discover();
        else if (d.refresh) await d.refresh();
        pushState();
        return { ok: true };
    },

    // ---------- pièces
    "POST /api/rooms": async ({ body }) => {
        const r = rooms.add(body.name, Array.isArray(body.speakers) ? body.speakers : []);
        sync.refresh();
        pushState();
        return r;
    },
    "PATCH /api/rooms/:id": async ({ params, body }) => {
        const r = rooms.update(params.id, body);
        sync.refresh();
        pushState();
        return r;
    },
    "DELETE /api/rooms/:id": async ({ params }) => {
        rooms.remove(params.id);
        sync.refresh();
        pushState();
        return { ok: true };
    },
    "POST /api/rooms/order": async ({ body }) => {
        rooms.order(body.ids ?? []);
        sync.refresh();
        pushState();
        return { ok: true };
    },
    "POST /api/rooms/auto": async () => {
        await refreshSpeakers();
        const r = rooms.autoFill(allLamps(), speakerNames);
        sync.refresh();
        pushState();
        return r;
    },
    "POST /api/lamps/:id/room": async ({ params, body }) => {
        rooms.assign(params.id, body.room || null);
        sync.refresh();
        pushState();
        return { ok: true };
    },

    // ---------- mes couleurs : diffuser tout de suite (sans musique)
    "POST /api/mycolors/apply": async () => {
        const colors = arrangeColors(sync.myColors(), "degrade");
        const step = { mode: "palette", palette: { colors, brightness: 85 } };
        const lamps = activeLamps();
        const coh = settings.coherence ?? "off";
        const targets = coh !== "off" ? roomTargets(step, rooms.plan(lamps).groups, coh === "ambiance" ? 1 : 0.7) : resolveStep(step, lamps);
        player.stop(false);
        stopSync();
        applyTargets(targets, 1.5);
        return { ok: true, colors };
    },
    "POST /api/music/analysis": async ({ body }) => {
        // résultats calculés dans la page : tempo et caractère de l'extrait, couleurs de la pochette
        const data = {};
        const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : undefined);
        if (Number(body.bpm) > 0) data.analysisBpm = Math.round(Number(body.bpm) * 10) / 10;
        if (Array.isArray(body.palette) && body.palette.length) data.palette = body.palette.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 5);
        if (body.cover && typeof body.cover === "object") {
            const colors = (Array.isArray(body.cover.colors) ? body.cover.colors : [])
                .filter(c => /^#[0-9a-f]{6}$/i.test(c?.hex))
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
    // relance du serveur (après une mise à jour) : le service macOS (ou le lanceur) le redémarre aussitôt
    "POST /api/restart": async () => {
        if (process.env.SHOW_LAUNCHER !== "1") throw new Error("Redémarrage automatique indisponible : relance « Show lumière ».");
        log("info", "Redémarrage du logiciel demandé…");
        setTimeout(() => shutdown(75), 400);
        return { ok: true };
    },
    "GET /api/ping": async () => ({ ok: true, service: serviceMode(), standby: !!settings.standby, pid: process.pid, pages: clients.size - phoneCount() }), // pages ouvertes sur le Mac
    // marche / arrêt du show : à l'arrêt, toutes les lampes prennent la même couleur
    "POST /api/power": async ({ body, local }) => {
        const a = body.action;
        if (a === "quit" && !local) throw Object.assign(new Error("Depuis le téléphone, utilise « Arrêter » : « Quitter » fermerait le logiciel et tu ne pourrais plus le relancer à distance."), { status: 403 });
        if (a === "stop") enterStandby();
        else if (a === "start") leaveStandby();
        else if (a === "quit") {
            enterStandby();
            log("info", "Fermeture du logiciel…");
            setTimeout(quitAfterDrain, 300);
        } else throw new Error("Action inconnue");
        return { ok: true, standby: !!settings.standby };
    },
    "POST /api/service/install": async ({ local }) => (onlyMac(local), installServiceNow()),
    "POST /api/service/uninstall": async ({ local }) => (onlyMac(local), uninstallServiceNow()),
    "POST /api/music/energy": async ({ body }) => {
        sync.setEnergy(body.level);
        return { ok: true };
    },
    "POST /api/music/save-auto": async () => {
        const show = sync.autoShow();
        if (!show) throw new Error("Aucun show automatique en cours");
        const id = `auto-${randomUUID().slice(0, 6)}`;
        const copy = { ...structuredClone(show), id, auto: undefined, name: show.name.replace(/^Auto · /, "Show · "), music: { match: [] } };
        writeJson(showPath(id), copy);
        pushState();
        return copy;
    },
    "POST /api/music/tap": async ({ body }) => {
        const r = sync.tap((body.taps ?? []).map(Number));
        log("success", `Tempo calé : ${r.bpm} BPM.`);
        return r;
    },
    "DELETE /api/music/calibration": async () => {
        sync.resetCalib();
        return { ok: true };
    },

    "PATCH /api/settings": async ({ body }) => {
        if ("rate" in body) {
            settings.rate = Math.max(1, Math.min(50, Number(body.rate) || 10));
            dispatcher.setRate(settings.rate);
        }
        if ("demo" in body) settings.demo = !!body.demo;
        if ("musicLead" in body) settings.musicLead = Math.max(-3, Math.min(3, Number(body.musicLead) || 0));
        if ("rhythmIntensity" in body) settings.rhythmIntensity = ["doux", "moyen", "fort", "aucun"].includes(body.rhythmIntensity) ? body.rhythmIntensity : "auto";
        if ("coherence" in body) settings.coherence = ["ambiance", "vague", "piece"].includes(body.coherence) ? body.coherence : "off";
        if ("speakerLink" in body) {
            settings.speakerLink = !!body.speakerLink;
            if (settings.speakerLink) refreshSpeakers();
        }
        if ("stopColor" in body && body.stopColor) {
            const c = String(body.stopColor.color ?? settings.stopColor?.color ?? "2700K");
            settings.stopColor = {
                color: c === "off" || /^#[0-9a-f]{6}$/i.test(c) || /^\d{4,5}K$/i.test(c) ? c : "2700K",
                brightness: Math.max(1, Math.min(100, Number(body.stopColor.brightness ?? settings.stopColor?.brightness ?? 60))),
            };
            if (settings.standby) applyTargets(uniformTargets(), 1);
        }
        if ("otherRooms" in body) settings.otherRooms = ["blanc", "eteint", "inchange"].includes(body.otherRooms) ? body.otherRooms : "blanc";
        if ("myColors" in body && Array.isArray(body.myColors)) {
            settings.myColors = body.myColors.map(c => String(c)).filter(c => isHex(c) || isKelvin(c)).slice(0, 6);
        }
        let remoteChanged = false;
        if (body.remote && typeof body.remote === "object") {
            const was = !!settings.remote.enabled;
            if ("enabled" in body.remote) settings.remote.enabled = !!body.remote.enabled;
            if ("keepAwake" in body.remote) settings.remote.keepAwake = !!body.remote.keepAwake;
            remoteChanged = was !== settings.remote.enabled;
        }
        sync.recompute();
        writeJson(SETTINGS_FILE, settings);
        if (remoteChanged) {
            if (!settings.remote.enabled) for (const c of clients) if (c.remote) c.end(); // les téléphones sont déconnectés
            await applyListen().catch(e => log("error", `Ouverture au réseau impossible : ${e.message}`));
            log("info", settings.remote.enabled ? `📱 Contrôle depuis le téléphone activé : ${remote.links()[0]?.base ?? ""}` : "Contrôle depuis le téléphone désactivé.");
        }
        updateKeepAwake();
        pushState();
        return { ok: true };
    },
};

function match(method, pathname) {
    for (const [key, handler] of Object.entries(routes)) {
        const [m, pattern] = key.split(" ");
        if (m !== method) continue;
        const pp = pattern.split("/");
        const up = pathname.split("/");
        if (pp.length !== up.length) continue;
        const params = {};
        let ok = true;
        for (let i = 0; i < pp.length; i++) {
            if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(up[i]);
            else if (pp[i] !== up[i]) {
                ok = false;
                break;
            }
        }
        if (ok) return { handler, params };
    }
    return null;
}

function html(res, code, page) {
    res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(page);
}
const MANIFEST = JSON.stringify({
    name: "Show lumière",
    short_name: "Lumière",
    display: "standalone",
    background_color: "#0d0f14",
    theme_color: "#0d0f14",
    icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
});

const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    const local = isLoopback(req.socket.remoteAddress);

    // le Mac lui-même : seulement sous ses propres noms (bloque les sites qui se font passer pour « localhost »)
    const hostName = String(req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "");
    if (local && hostName && !remote.knownHosts().has(hostName)) return html(res, 403, "Adresse non reconnue : ouvre http://localhost:" + PORT);
    // pas de commande envoyée par un autre site
    if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
        let same = false;
        try {
            same = new URL(req.headers.origin).host.toLowerCase() === String(req.headers.host ?? "").toLowerCase();
        } catch {}
        if (!same) return send(res, 403, { error: "Requête refusée (envoyée par un autre site)." });
    }

    // icônes et manifeste (écran d'accueil du téléphone) : publics
    if (path === "/manifest.webmanifest") {
        res.writeHead(200, { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" });
        return res.end(MANIFEST);
    }
    const isPublic = /^\/icons\/[\w-]+\.png$/.test(path);

    // téléphone ou autre appareil du réseau : clé (QR code / cookie) ou code à 6 chiffres
    if (!local && !isPublic) {
        if (!settings.remote.enabled) {
            if (path.startsWith("/api/")) return send(res, 403, { error: "Contrôle depuis le téléphone désactivé (Réglages › Téléphone, sur le Mac)." });
            return html(res, 403, loginPage({ enabled: false }));
        }
        if (path === "/api/remote/login" && req.method === "POST") {
            try {
                const r = remote.login((await body(req)).pin, req.socket.remoteAddress);
                res.setHeader("Set-Cookie", remote.cookieHeader());
                log("info", `📱 Nouvel appareil connecté avec le code (${req.socket.remoteAddress.replace(/^::ffff:/, "")}).`);
                return send(res, 200, r);
            } catch (e) {
                return send(res, e.status ?? 400, { error: e.message });
            }
        }
        const auth = remote.check(req, url);
        if (!auth.ok) {
            if (path.startsWith("/api/")) return send(res, 401, { error: "Téléphone pas encore autorisé : scanne le QR code affiché sur le Mac." });
            return html(res, 401, loginPage({ enabled: true }));
        }
        if (auth.setCookie) {
            res.setHeader("Set-Cookie", remote.cookieHeader());
            if (auth.fresh) log("info", `📱 Nouvel appareil connecté (${req.socket.remoteAddress.replace(/^::ffff:/, "")}).`);
        }
    }

    if (path === "/api/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
        res.remote = !local;
        clients.add(res);
        if (res.remote) pushState(); // le Mac voit qu'un téléphone est connecté
        const ping = setInterval(() => res.write(": ping\n\n"), 20000);
        req.on("close", () => {
            clearInterval(ping);
            clients.delete(res);
            if (res.remote) pushState();
        });
        return;
    }

    if (path === "/api/music/cover" || path === "/api/music/preview") {
        const key = url.searchParams.get("key") || trackKey(music.state.track);
        const f = songs.file(key, path.endsWith("cover") ? "cover" : "preview");
        if (!f) {
            res.writeHead(404);
            return res.end();
        }
        res.writeHead(200, { "Content-Type": SERVE_TYPES[extname(f)] ?? "application/octet-stream", "Cache-Control": "max-age=3600" });
        return res.end(readFileSync(f));
    }

    if (path.startsWith("/api/")) {
        const m = match(req.method, path);
        if (!m) return send(res, 404, { error: "Route inconnue" });
        try {
            const data = await m.handler({ params: m.params, body: req.method === "GET" ? {} : await body(req), local });
            return send(res, 200, data);
        } catch (e) {
            return send(res, e.code === 404 ? 404 : e.status ?? 400, { error: e.message });
        }
    }

    // fichiers statiques
    const file = join(PUBLIC, path === "/" ? "index.html" : path.replace(/\.\./g, ""));
    if (!file.startsWith(PUBLIC) || !existsSync(file)) {
        res.writeHead(404);
        return res.end("Introuvable");
    }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(file));
});

let listenBusy = false;
server.on("error", e => listenBusy || console.error("Serveur :", e.message));

// ---------------------------------------------------------------- écoute : Mac seul, ou tout le réseau local (téléphone)
const remote = new RemoteAccess({ read: () => readJson(ACCESS_FILE, null), write: d => writeJson(ACCESS_FILE, d), port: PORT, log });
let listeningHost = null;
const wantedHost = () => process.env.HOST || (settings.remote.enabled ? "::" : "127.0.0.1");
function listenOn(host) {
    return new Promise((resolve, reject) => {
        const onErr = e => {
            server.off("listening", onOk);
            reject(e);
        };
        const onOk = () => {
            server.off("error", onErr);
            resolve();
        };
        server.once("error", onErr);
        server.once("listening", onOk);
        listenBusy = true;
        server.listen(PORT, host);
    }).finally(() => (listenBusy = false));
}
/** (Ré)ouvre le port sur la bonne adresse ; les pages déjà connectées restent connectées. */
async function applyListen() {
    const want = wantedHost();
    if (listeningHost === want) return;
    if (listeningHost !== null) server.close();
    let last;
    for (const h of want === "::" ? ["::", "0.0.0.0"] : [want]) {
        try {
            await listenOn(h);
            listeningHost = want;
            return;
        } catch (e) {
            last = e;
            if (e.code === "EADDRINUSE") break;
        }
    }
    if (want !== "127.0.0.1" && !process.env.HOST) {
        settings.remote.enabled = false; // retour au Mac seul
        writeJson(SETTINGS_FILE, settings);
        await listenOn("127.0.0.1");
        listeningHost = "127.0.0.1";
    }
    throw last;
}
function remoteInfo() {
    return {
        enabled: !!settings.remote.enabled,
        keepAwake: !!settings.remote.keepAwake,
        listening: listeningHost,
        pin: remote.pin,
        phones: phoneCount(),
        links: remote.links().map(l => ({ kind: l.kind, base: l.base, url: l.url, qr: qrSvg(l.url) })),
    };
}

// ---------------------------------------------------------------- marche / arrêt / service en arrière-plan
/** service = lancé par macOS en arrière-plan ; terminal = fenêtre « Lancer le show » ; manuel = node à la main. */
function serviceMode() {
    if (process.env.SHOW_SERVICE === "launchd") return "service";
    return process.env.SHOW_LAUNCHER === "1" ? "terminal" : "manuel";
}
try {
    if (serviceMode() === "service" && statSync(SERVICE_LOG).size > 5e6) writeFileSync(SERVICE_LOG, ""); // journal raisonnable
} catch {}

/** Toutes les lampes du show dans la couleur « d'arrêt » (réglable). */
function uniformTargets() {
    const c = settings.stopColor ?? { color: "2700K", brightness: 60 };
    const state = c.color === "off" ? { on: false } : { on: true, color: c.color, brightness: c.brightness ?? 60 };
    return Object.fromEntries(activeLamps().map(l => [l.id, state]));
}

function enterStandby() {
    if (!settings.standby) settings.syncBeforeStop = sync.enabled;
    player.stop(false);
    if (sync.enabled) sync.setEnabled(false);
    applyTargets(uniformTargets(), 2);
    settings.standby = true;
    writeJson(SETTINGS_FILE, settings);
    const c = settings.stopColor ?? {};
    log("info", `Show arrêté : toutes les lumières ${c.color === "off" ? "éteintes" : `en ${c.color} (${c.brightness} %)`}.`);
    updateKeepAwake();
    pushState();
}

function leaveStandby({ resume = true } = {}) {
    if (!settings.standby) return;
    settings.standby = false;
    if (resume && settings.syncBeforeStop) sync.setEnabled(true);
    saveSyncSettings();
    log("info", "Show redémarré.");
    updateKeepAwake();
    pushState();
}

async function quitAfterDrain() {
    const t0 = Date.now();
    while (dispatcher.pending > 0 && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 600));
    shutdown(0); // code 0 : le service ne se relance pas tout seul
}

// garder le Mac éveillé seulement quand un show tourne (caffeinate s'arrête avec ce processus)
let caffeinate = null;
function updateKeepAwake() {
    if (process.platform !== "darwin") return;
    const want = (!settings.standby && (sync.enabled || !!playerStatus?.playing)) || (settings.remote.enabled && settings.remote.keepAwake);
    if (want && !caffeinate) {
        try {
            caffeinate = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
            caffeinate.on("exit", () => (caffeinate = null));
            caffeinate.on("error", () => (caffeinate = null));
        } catch {}
    } else if (!want && caffeinate) {
        caffeinate.kill();
        caffeinate = null;
    }
}
setInterval(updateKeepAwake, 5000);

/** Installe (ou met à jour) le service macOS : démarre avec le Mac, se relance tout seul, sans fenêtre Terminal. */
function installServiceNow() {
    installService({ delay: 2 }); // le service prend le relais une fois ce processus-ci fermé (port libéré)
    log("info", "Passage en arrière-plan : le logiciel redémarre en service macOS…");
    if (serviceMode() !== "service") setTimeout(() => shutdown(0), 800);
    return { ok: true };
}

function uninstallServiceNow() {
    uninstallService();
    log("info", "Le logiciel ne démarrera plus tout seul avec le Mac.");
    return { ok: true };
}

applyListen()
    .then(() => {
        console.log(`\n  ✨ Show lumière Matter prêt → http://localhost:${PORT}\n     (Ctrl+C pour arrêter)\n`);
        if (settings.remote.enabled) setTimeout(() => log("info", `📱 Contrôle depuis le téléphone : ${remote.links()[0]?.base ?? ""}`), 1500);
    })
    .catch(e => {
        if (e.code === "EADDRINUSE") console.error(`\nLe port ${PORT} est déjà utilisé : le show tourne peut-être déjà. Ouvre http://localhost:${PORT}\n`);
        else console.error(e);
        process.exit(1);
    });

music.start();
// reprend le mode de synchro choisi la dernière fois (sauf si le show a été arrêté)
if (settings.syncChoice) sync.setChoice(settings.syncChoice);
if (settings.syncEnabled && !settings.standby) sync.setEnabled(true);

for (const id of Object.keys(integ)) startIntegration(id);

hub.start().catch(e => {
    hub.error = e.message;
    log("error", `Le contrôleur Matter n'a pas pu démarrer : ${e.message}`);
    pushState();
});

async function shutdown(code = 0) {
    console.log(code === 75 ? "\nRedémarrage…" : "\nArrêt…");
    player.stop(false);
    sync.setEnabled(false);
    music.stop();
    caffeinate?.kill();
    for (const id of [...devices.drivers.keys()]) devices.removeDriver(id);
    try {
        await hub.close();
    } catch {}
    process.exit(typeof code === "number" ? code : 0);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
