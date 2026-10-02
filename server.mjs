// Show de lumière 100 % Matter — serveur local (contrôleur Matter + interface web).
// Lancer :  npm start   puis ouvrir http://localhost:8321
import { Logger } from "@matter/main";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { MatterHub } from "./lib/matter.mjs";
import { Dispatcher, Player, displayColor } from "./lib/show.mjs";
import { AppleMusic, SimulatedMusic } from "./lib/music.mjs";
import { MusicSync } from "./lib/sync.mjs";
import { SongInfo } from "./lib/online.mjs";
import { trackKey } from "./lib/tempo.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, "data");
const SHOWS = join(ROOT, "shows");
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT) || 8321;
const HOST = process.env.HOST || "127.0.0.1";
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
const TEMPOS_FILE = join(DATA, "tempos.json");
const settings = { rate: 10, demo: false, musicLead: 0.15, rhythmIntensity: "auto", ...readJson(SETTINGS_FILE, {}) };
const lampPrefs = readJson(LAMPS_FILE, {}); // id -> { alias, hidden, order }

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

function allLamps() {
    const list = [...hub.getLamps(), ...(settings.demo ? DEMO_LAMPS : [])].map((l, i) => {
        const p = lampPrefs[l.id] ?? {};
        return { ...l, matterName: l.name, name: p.alias || l.name, hidden: !!p.hidden, order: p.order ?? 1000 + i };
    });
    return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
const activeLamps = () => allLamps().filter(l => !l.hidden);

// ---------------------------------------------------------------- aperçu + envoi
const preview = {}; // lampId -> { on, color, display, brightness }
const dispatcher = new Dispatcher({ hub, rate: settings.rate, log });

function applyTargets(targets, fade) {
    const byId = new Map(allLamps().map(l => [l.id, l]));
    const changes = {};
    for (const [id, state] of Object.entries(targets)) {
        const lamp = byId.get(id);
        if (!lamp) continue;
        preview[id] = state.on ? { ...state, display: displayColor(state.color, lamp.kind) } : { on: false };
        changes[id] = preview[id];
        if (!lamp.virtual && hub.hasLamp(id)) dispatcher.setTarget(lamp, state, fade);
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
});
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
function stopSync() {
    if (sync.enabled) {
        sync.setEnabled(false);
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
function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
}
function snapshot() {
    return {
        matter: { ready: hub.ready, error: hub.error, pairing: hub.pairing },
        nodes: hub.getNodes(),
        lamps: allLamps(),
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
hub.on("changed", () => {
    dispatcher.forget(); // après un changement de structure/connexion, on renverra tout
    pushState();
});

// ---------------------------------------------------------------- HTTP
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

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

const routes = {
    "GET /api/state": () => snapshot(),

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
            if (body.enabled) player.stop();
            sync.setEnabled(body.enabled);
        }
        return { ok: true };
    },
    "POST /api/music/command": async ({ body }) => {
        await music.command(body.action, body.arg);
        return { ok: true };
    },
    "GET /api/music/playlists": async () => music.playlists(),
    "GET /api/music/airplay": async () => music.airplay(),
    "POST /api/music/airplay": async ({ body }) => {
        await music.setAirplay(body.names);
        return music.airplay();
    },
    "POST /api/music/analysis": async ({ body }) => {
        // résultats calculés dans la page : tempo de l'extrait, palette de la pochette
        const data = {};
        if (Number(body.bpm) > 0) data.analysisBpm = Math.round(Number(body.bpm) * 10) / 10;
        if (Array.isArray(body.palette) && body.palette.length) data.palette = body.palette.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 5);
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
        sync.recompute();
        writeJson(SETTINGS_FILE, settings);
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

const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    if (path === "/api/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 20000);
        req.on("close", () => {
            clearInterval(ping);
            clients.delete(res);
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
            const data = await m.handler({ params: m.params, body: req.method === "GET" ? {} : await body(req) });
            return send(res, 200, data);
        } catch (e) {
            return send(res, e.code === 404 ? 404 : 400, { error: e.message });
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

server.on("error", e => {
    if (e.code === "EADDRINUSE") console.error(`\nLe port ${PORT} est déjà utilisé : le show tourne peut-être déjà. Ouvre http://localhost:${PORT}\n`);
    else console.error(e);
    process.exit(1);
});

server.listen(PORT, HOST, () => {
    const shown = HOST === "0.0.0.0" ? "localhost" : HOST === "127.0.0.1" ? "localhost" : HOST;
    console.log(`\n  ✨ Show lumière Matter prêt → http://${shown}:${PORT}\n     (Ctrl+C pour arrêter)\n`);
});

music.start();

hub.start().catch(e => {
    hub.error = e.message;
    log("error", `Le contrôleur Matter n'a pas pu démarrer : ${e.message}`);
    pushState();
});

async function shutdown() {
    console.log("\nArrêt…");
    player.stop(false);
    sync.setEnabled(false);
    music.stop();
    try {
        await hub.close();
    } catch {}
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
