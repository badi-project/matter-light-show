// Sources de musique : Apple Music, Spotify (app du Mac), les autres apps du Mac (Deezer, Tidal, Qobuz, YouTube Music
// dans le navigateur… : ce que macOS affiche dans « En cours de lecture ») et Spotify sur n'importe quel appareil (compte).
// MusicHub choisit la source active (automatiquement : celle qui joue) et se présente au reste du logiciel comme l'ancienne
// classe AppleMusic (state, positionAt, command, airplay…), pour que la synchro n'ait rien à changer.
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { num, ON_MAC, osascript, permissionMessage, REAL_MAC, runningApps } from "./macos.mjs";
import { pct } from "./util.mjs";

const EMPTY = { running: false, playing: false, status: "inconnu", position: 0, at: Date.now(), track: null, playlist: "" };

// ------------------------------------------------------------------------------------------------ Spotify (app du Mac)
const SPOTIFY_STATUS = `
if application "Spotify" is not running then return "notrunning"
tell application "Spotify"
  set vState to player state as text
  if vState is "stopped" then return "stopped"
  set vName to ""
  set vArtist to ""
  set vAlbum to ""
  set vDur to 0
  set vId to ""
  set vArt to ""
  try
    set vTrack to current track
    set vName to name of vTrack
    set vArtist to artist of vTrack
    set vAlbum to album of vTrack
    set vDur to duration of vTrack
    set vId to id of vTrack
    set vArt to artwork url of vTrack
  end try
  return vState & tab & (player position as text) & tab & vName & tab & vArtist & tab & vAlbum & tab & (vDur as text) & tab & vId & tab & vArt
end tell`;

export class SpotifyApp {
    id = "spotify";
    name = "Spotify";
    app = "Spotify";
    caps = { control: true, playlists: false, airplay: false, volume: true };
    available = ON_MAC;
    state = { ...EMPTY };
    error = null;

    async poll() {
        if (!this.available) return this.state;
        const t0 = Date.now();
        try {
            const out = await osascript(SPOTIFY_STATUS);
            const at = (t0 + Date.now()) / 2;
            this.error = null;
            if (out === "notrunning" || out === "stopped") {
                this.state = { ...EMPTY, running: out !== "notrunning", status: out === "stopped" ? "arrêtée" : "Spotify fermé", at };
            } else {
                const [st, pos, name, artist, album, dur, id, art] = out.split("\t");
                const playing = /playing|lecture|kPSP/i.test(st) && !/paus/i.test(st);
                const track = name ? { id: `spotify:${id || `${name}|${artist}`}`, name, artist, album, duration: num(dur) / 1000, bpm: 0, genre: "", artworkUrl: art || undefined } : null;
                this.state = { running: true, playing, status: playing ? "lecture" : "pause", position: num(pos), at, track, playlist: "" };
            }
        } catch (e) {
            this.error = permissionMessage(e, "Spotify");
            this.state = { ...this.state, playing: false, status: "erreur" };
        }
        return this.state;
    }

    async command(action) {
        const scripts = { playpause: "playpause", next: "next track", previous: "previous track", pause: "pause", play: "play" };
        if (!scripts[action]) throw new Error("Commande indisponible avec Spotify");
        await osascript(`tell application "Spotify" to ${scripts[action]}`);
    }
    async getVolume() {
        return Math.round(num(await osascript(`if application "Spotify" is running then tell application "Spotify" to get sound volume`, 4000)));
    }
    async setVolume(v) {
        await osascript(`tell application "Spotify" to set sound volume to ${pct(v)}`, 4000);
    }
}

// ------------------------------------------------------------------------------- Autres apps du Mac (« En cours de lecture »)
// Lu par JavaScript pour l'automatisation (osascript), qui a le droit de lire le centre « En cours de lecture » de macOS
// (fonctionne sur macOS 15.4 et suivants, dont macOS 26). Couvre Deezer, Tidal, Qobuz, les lecteurs web (Chrome, Safari)…
const NOW_PLAYING_JXA = `
function run() {
  var out = {};
  try {
    var MR = $.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/MediaRemote.framework/");
    MR.load;
    var Req = $.NSClassFromString("MRNowPlayingRequest");
    try { var c = Req.localNowPlayingPlayerPath.client; out.app = c.displayName.js; out.bundle = c.bundleIdentifier.js; } catch (e) {}
    var item = Req.localNowPlayingItem;
    var info = item.nowPlayingInfo;
    var get = function (k) { try { var v = info.valueForKey(k); if (!v || v.isNil()) return null; return v.js; } catch (e) { return null; } };
    out.title = get("kMRMediaRemoteNowPlayingInfoTitle");
    out.artist = get("kMRMediaRemoteNowPlayingInfoArtist");
    out.album = get("kMRMediaRemoteNowPlayingInfoAlbum");
    out.duration = get("kMRMediaRemoteNowPlayingInfoDuration");
    out.elapsed = get("kMRMediaRemoteNowPlayingInfoElapsedTime");
    out.rate = get("kMRMediaRemoteNowPlayingInfoPlaybackRate");
    try { var ts = info.valueForKey("kMRMediaRemoteNowPlayingInfoTimestamp"); if (ts && !ts.isNil()) out.timestamp = ts.timeIntervalSince1970 * 1000; } catch (e) {}
    try { var p = item.metadata.calculatedPlaybackPosition; if (typeof p === "number") out.position = p; } catch (e) {}
  } catch (e) { out.error = String(e); }
  return JSON.stringify(out);
}`;
const NOW_PLAYING_COMMAND = cmd => `
function run() {
  $.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/MediaRemote.framework/").load;
  var C = $.NSClassFromString("MRNowPlayingController");
  C.localRouteController.sendCommandOptionsCompletion(${cmd}, $(), null);
  return "ok";
}`;
const MR_COMMAND = { playpause: 2, next: 4, previous: 5, pause: 1, play: 0 };
/** Apps déjà lues directement (plus précis) : la source « autres apps » les laisse de côté. */
const NATIVE_BUNDLES = { "com.apple.Music": "apple", "com.spotify.client": "spotify" };

export class NowPlaying {
    id = "autre";
    name = "Autres apps du Mac";
    app = null;
    caps = { control: true, playlists: false, airplay: false, volume: false };
    available = ON_MAC;
    state = { ...EMPTY };
    error = null;
    native = null; // « apple » / « spotify » si c'est en fait une app lue directement
    appName = null;
    #track = { key: null, startedAt: 0, lastPos: null };

    async poll() {
        if (!this.available) return this.state;
        const t0 = Date.now();
        let j;
        try {
            j = JSON.parse(await osascript(NOW_PLAYING_JXA, 5000, "JavaScript"));
        } catch (e) {
            this.error = `« En cours de lecture » illisible : ${String(e.message).slice(0, 120)}`;
            this.state = { ...EMPTY, status: "erreur" };
            return this.state;
        }
        const now = (t0 + Date.now()) / 2;
        this.error = j.error && !j.title ? `« En cours de lecture » illisible : ${j.error}` : null;
        this.appName = j.app || null;
        this.native = NATIVE_BUNDLES[j.bundle] ?? null;
        if (!j.title) {
            this.state = { ...EMPTY, running: !!j.app, status: j.app ? "rien en lecture" : "aucune app", at: now };
            return this.state;
        }
        const rate = typeof j.rate === "number" ? j.rate : null;
        const key = `${j.title}|${j.artist ?? ""}`;
        if (this.#track.key !== key) this.#track = { key, startedAt: now, lastPos: null };
        // position : calculée par macOS, sinon temps écoulé + horodatage, sinon estimée depuis le début du morceau
        let position = null, approx = false;
        if (typeof j.position === "number" && j.position >= 0) position = j.position;
        else if (typeof j.elapsed === "number") position = j.elapsed + (j.timestamp && rate ? ((now - j.timestamp) / 1000) * rate : 0);
        if (position === null || (this.#track.lastPos !== null && position === this.#track.lastPos && rate !== 0)) {
            // certains lecteurs web ne donnent pas la position : on l'estime (le micro peut caler les temps ensuite)
            position = (now - this.#track.startedAt) / 1000;
            approx = true;
        }
        this.#track.lastPos = typeof j.position === "number" ? j.position : j.elapsed ?? null;
        const playing = rate === null ? true : rate > 0;
        this.state = {
            running: true,
            playing,
            status: playing ? "lecture" : "pause",
            position,
            at: now,
            approx,
            app: j.app || "app",
            track: {
                id: `np:${key}`,
                name: j.title,
                artist: j.artist ?? "",
                album: j.album ?? "",
                duration: typeof j.duration === "number" ? j.duration : 0,
                bpm: 0,
                genre: "",
            },
            playlist: "",
        };
        return this.state;
    }

    async command(action) {
        if (!(action in MR_COMMAND)) throw new Error("Commande indisponible pour cette app");
        await osascript(NOW_PLAYING_COMMAND(MR_COMMAND[action]), 5000, "JavaScript");
    }
}

// ------------------------------------------------------------------------- Spotify sur tous tes appareils (compte, API Web)
// Suit Spotify même quand il joue sur l'iPhone, une enceinte Spotify Connect… Il faut créer une « app » gratuite sur
// developer.spotify.com (le propriétaire doit avoir Spotify Premium depuis 2026) et coller son identifiant (Client ID).
const SPOTIFY_ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_URL || "https://accounts.spotify.com"; // (variables : tests)
const SPOTIFY_API = process.env.SPOTIFY_API_URL || "https://api.spotify.com/v1";
const SCOPES = "user-read-playback-state user-read-currently-playing user-modify-playback-state";

export class SpotifyWeb {
    id = "spotify-web";
    name = "Spotify (compte, tous appareils)";
    app = null;
    caps = { control: true, playlists: false, airplay: false, volume: false };
    available = true;
    state = { ...EMPTY };
    error = null;
    device = null; // appareil Spotify qui joue (nom, type)
    #pkce = null;
    #retryAt = 0;

    constructor({ load, save, redirectUri }) {
        this.cfg = { ...(load() ?? {}) };
        this.saveCfg = () => save(this.cfg);
        this.redirectUri = redirectUri;
    }

    get configured() {
        return !!this.cfg.clientId;
    }
    get connected() {
        return !!this.cfg.refreshToken;
    }
    info() {
        return { configured: this.configured, connected: this.connected, clientId: this.cfg.clientId ? `${this.cfg.clientId.slice(0, 6)}…` : "", user: this.cfg.user ?? null, redirectUri: this.redirectUri, device: this.device, error: this.error };
    }

    setClientId(id) {
        const v = String(id ?? "").trim();
        if (v && !/^[0-9a-f]{32}$/i.test(v)) throw new Error("Le Client ID Spotify fait 32 caractères (chiffres et lettres a à f).");
        this.cfg = v ? { clientId: v } : {};
        this.state = { ...EMPTY };
        this.saveCfg();
    }
    disconnect() {
        this.cfg = { clientId: this.cfg.clientId };
        this.state = { ...EMPTY };
        this.device = null;
        this.saveCfg();
    }

    /** Adresse de connexion Spotify (code PKCE : pas de secret à stocker). */
    loginUrl() {
        if (!this.configured) throw new Error("Colle d'abord le Client ID de ton app Spotify");
        const verifier = randomBytes(48).toString("base64url");
        const state = randomBytes(12).toString("base64url");
        this.#pkce = { verifier, state, at: Date.now() };
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        const q = new URLSearchParams({
            client_id: this.cfg.clientId,
            response_type: "code",
            redirect_uri: this.redirectUri,
            code_challenge_method: "S256",
            code_challenge: challenge,
            scope: SCOPES,
            state,
        });
        return `${SPOTIFY_ACCOUNTS}/authorize?${q}`;
    }

    async callback(params) {
        if (params.get("error")) throw new Error(`Spotify a refusé : ${params.get("error")}`);
        if (!this.#pkce || params.get("state") !== this.#pkce.state || Date.now() - this.#pkce.at > 15 * 60e3) throw new Error("Lien de connexion expiré : recommence.");
        const r = await this.#tokenRequest({ grant_type: "authorization_code", code: params.get("code"), redirect_uri: this.redirectUri, code_verifier: this.#pkce.verifier });
        this.#pkce = null;
        this.#storeTokens(r);
        try {
            const me = await this.#api("GET", "/me");
            this.cfg.user = me?.display_name || me?.id || null;
            this.saveCfg();
        } catch {}
    }

    async #tokenRequest(fields) {
        const r = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: this.cfg.clientId, ...fields }),
            signal: AbortSignal.timeout(10000),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
        return j;
    }
    #storeTokens(j) {
        this.cfg.accessToken = j.access_token;
        this.cfg.expiresAt = Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000;
        if (j.refresh_token) this.cfg.refreshToken = j.refresh_token; // Spotify peut en donner un nouveau
        this.saveCfg();
    }
    async #access() {
        if (this.cfg.accessToken && Date.now() < this.cfg.expiresAt) return this.cfg.accessToken;
        if (!this.cfg.refreshToken) throw new Error("Spotify non connecté");
        try {
            this.#storeTokens(await this.#tokenRequest({ grant_type: "refresh_token", refresh_token: this.cfg.refreshToken }));
        } catch (e) {
            if (/invalid_grant|revoked/i.test(e.message)) this.disconnect(); // accès retiré côté Spotify : il faut se reconnecter
            throw e;
        }
        return this.cfg.accessToken;
    }
    async #api(method, path, body) {
        const token = await this.#access();
        const r = await fetch(`${SPOTIFY_API}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(8000),
        });
        if (r.status === 204) return null;
        if (r.status === 429) {
            this.#retryAt = Date.now() + (Number(r.headers.get("retry-after")) || 10) * 1000;
            throw new Error("Spotify demande de patienter (trop de requêtes)");
        }
        if (r.status === 401) {
            this.cfg.expiresAt = 0;
            throw new Error("jeton Spotify expiré");
        }
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
        return j;
    }

    async poll() {
        if (!this.connected || Date.now() < this.#retryAt) return this.state;
        const t0 = Date.now();
        try {
            const j = await this.#api("GET", "/me/player?additional_types=track");
            const at = (t0 + Date.now()) / 2;
            this.error = null;
            if (!j || !j.item) {
                this.device = j?.device ? { name: j.device.name, type: j.device.type } : null;
                this.state = { ...EMPTY, running: !!j, status: j ? "rien en lecture" : "aucun appareil Spotify actif", at };
                return this.state;
            }
            const it = j.item;
            this.device = j.device ? { name: j.device.name, type: j.device.type } : null;
            this.state = {
                running: true,
                playing: !!j.is_playing,
                status: j.is_playing ? "lecture" : "pause",
                position: (Number(j.progress_ms) || 0) / 1000,
                at,
                app: this.device?.name ? `Spotify · ${this.device.name}` : "Spotify",
                track: {
                    id: `spotify:${it.id ?? it.uri}`,
                    name: it.name,
                    artist: (it.artists ?? []).map(a => a.name).join(", "),
                    album: it.album?.name ?? "",
                    duration: (Number(it.duration_ms) || 0) / 1000,
                    bpm: 0,
                    genre: "",
                    isrc: it.external_ids?.isrc,
                    artworkUrl: it.album?.images?.[0]?.url,
                },
                playlist: "",
            };
        } catch (e) {
            this.error = `Spotify (compte) : ${e.message}`;
        }
        return this.state;
    }

    /** Appareils Spotify Connect (enceintes, TV, consoles, téléphone…) visibles par le compte. */
    async devices() {
        if (!this.connected) return [];
        const j = await this.#api("GET", "/me/player/devices");
        return (j?.devices ?? []).map(d => ({ id: d.id, name: d.name, type: d.type, active: !!d.is_active, volume: d.supports_volume === false ? null : d.volume_percent ?? null, restricted: !!d.is_restricted }));
    }
    /** Fait passer la lecture Spotify sur cet appareil. */
    async transfer(deviceId, play = true) {
        await this.#api("PUT", "/me/player", { device_ids: [String(deviceId)], play });
    }
    async setDeviceVolume(deviceId, v) {
        const q = new URLSearchParams({ volume_percent: String(pct(v)) });
        if (deviceId) q.set("device_id", String(deviceId));
        await this.#api("PUT", `/me/player/volume?${q}`);
    }

    async command(action) {
        const map = { playpause: this.state.playing ? ["PUT", "/me/player/pause"] : ["PUT", "/me/player/play"], pause: ["PUT", "/me/player/pause"], play: ["PUT", "/me/player/play"], next: ["POST", "/me/player/next"], previous: ["POST", "/me/player/previous"] };
        if (!map[action]) throw new Error("Commande indisponible");
        await this.#api(...map[action]);
    }
}

// ----------------------------------------------------------------------------------------------- choix de la source
export const SOURCE_CHOICES = {
    auto: "Automatique (l'app qui joue)",
    apple: "Apple Music",
    spotify: "Spotify (app du Mac)",
    autre: "Autres apps du Mac (Deezer, Tidal, navigateur…)",
    sonos: "Enceintes Sonos (ce qu'elles jouent)",
    "spotify-web": "Spotify sur tous mes appareils (compte)",
};
const PRIORITY = ["apple", "spotify", "autre", "sonos", "spotify-web"];

export class MusicHub extends EventEmitter {
    state = { ...EMPTY };
    error = null;
    active = null; // id de la source suivie
    #sources;
    #choice;
    #timer = null;
    #lastScan = 0;
    #lastPoll = 0;
    #running = new Set();
    #playedAt = 0; // dernière fois que quelque chose jouait
    #polledAt = new Map(); // source -> dernière lecture
    #nudgeAt = 0;

    /** sources : { apple, spotify, autre, "spotify-web" } ; choice : réglage (« auto » par défaut). */
    constructor({ sources, choice = "auto" }) {
        super();
        this.#sources = sources;
        this.#choice = SOURCE_CHOICES[choice] ? choice : "auto";
        this.active = this.#choice === "auto" ? "apple" : this.#choice;
    }

    get available() {
        return Object.values(this.#sources).some(s => s.available);
    }
    get choice() {
        return this.#choice;
    }
    get source() {
        return this.#sources[this.active] ?? null;
    }
    sourceOf(id) {
        return this.#sources[id] ?? null;
    }
    setChoice(choice) {
        if (!SOURCE_CHOICES[choice]) throw new Error("Source inconnue");
        this.#choice = choice;
        if (choice !== "auto") this.active = choice;
        this.#lastScan = 0;
        return this.refresh();
    }

    /** Pour l'interface : source suivie, ce qu'elle sait faire, les sources disponibles. */
    info() {
        const src = this.source;
        return {
            choice: this.#choice,
            active: this.active,
            name: src?.name ?? "",
            app: this.state.app ?? src?.name ?? "",
            caps: src?.caps ?? {},
            approx: !!this.state.approx,
            choices: Object.entries(SOURCE_CHOICES)
                .filter(([id]) => id === "auto" || this.#sources[id]?.available)
                .map(([id, label]) => ({ id, label })),
            spotifyWeb: this.#sources["spotify-web"]?.info?.() ?? null,
        };
    }

    /** La veille macOS (lib/macwatch.mjs) prévient d'un changement : lecture tout de suite (regroupée sur 250 ms). */
    nudge() {
        if (!this.#nudgeAt) this.#nudgeAt = Date.now() + 250;
    }
    /** Vrai quand la veille macOS a déjà prouvé qu'elle signale les changements : on peut lire moins souvent. */
    watched = false;

    start() {
        const loop = async () => {
            try {
                await this.#tick();
            } catch {}
            this.#timer = setTimeout(loop, 500);
        };
        loop();
    }
    stop() {
        clearTimeout(this.#timer);
    }
    refresh() {
        this.#lastPoll = 0;
        this.#lastScan = 0;
        return this.#tick();
    }

    // Fréquence des lectures. Pendant la lecture : souvent (la position est aussi extrapolée entre deux lectures).
    // Rien ne joue depuis une minute : plus rarement. Avec la veille macOS, qui signale lecture, pause, morceau suivant
    // et apps ouvertes ou fermées, les lectures de contrôle s'espacent encore.
    #intervals() {
        const playing = this.state.playing;
        const idle = !playing && Date.now() - this.#playedAt > 60000;
        const w = this.watched;
        const scan = playing ? (w ? 15000 : 5000) : idle ? (w ? 30000 : 8000) : w ? 10000 : 5000;
        const base = { apple: [1000, 2500], spotify: [1500, 2500], autre: [2000, 3000], sonos: [1500, 3000], "spotify-web": [2000, 4000] }[this.active] ?? [2000, 2500];
        let poll = playing ? base[0] : base[1];
        if (w) poll = playing ? Math.max(poll, 1500) : 10000;
        if (idle) poll = Math.max(poll, w ? 30000 : 8000);
        return { scan, poll };
    }

    async #tick() {
        const now = Date.now();
        if (this.state.playing) this.#playedAt = now;
        const nudged = this.#nudgeAt && now >= this.#nudgeAt;
        if (nudged) this.#nudgeAt = 0;
        const { scan, poll } = this.#intervals();
        // mode automatique : qui joue en ce moment ?
        if (this.#choice === "auto" && (nudged || now - this.#lastScan > scan)) {
            this.#lastScan = now;
            this.#lastPoll = now;
            await this.#scan();
            return;
        }
        // sinon : la source suivie
        if (!nudged && now - this.#lastPoll < poll) return;
        // en mode automatique et rien ne joue depuis longtemps : la recherche suffit (elle relit aussi cette source)
        if (this.#choice === "auto" && !this.state.playing && now - this.#playedAt > 60000) return;
        this.#lastPoll = now;
        const src = this.source;
        if (!src?.available) return;
        if (this.#choice !== "auto" && src.app && src.id !== "apple" && REAL_MAC && !(await runningApps()).has(src.app)) {
            this.#adopt(src.id, { ...EMPTY, status: `${src.name} fermé` }, null);
            return;
        }
        await src.poll();
        this.#adopt(src.id, src.state, src.error);
    }

    async #scan() {
        this.#running = await runningApps();
        const states = {};
        let found = false;
        for (const id of PRIORITY) {
            const s = this.#sources[id];
            if (!s?.available) continue;
            if (s.app && REAL_MAC && !this.#running.has(s.app)) {
                states[id] = { ...EMPTY, status: `${s.name} fermé` };
                continue;
            }
            if (id === "spotify-web" && !s.connected) continue;
            // la plus prioritaire qui joue gagne : les apps du Mac suivantes ne sont pas relues (c'est ce qui coûte) ;
            // Sonos et le compte Spotify (simples requêtes réseau) le sont de temps en temps, pour la carte des sorties
            if (found && (s.app || id === "autre" || Date.now() - (this.#polledAt.get(id) ?? 0) < 15000)) continue;
            await s.poll();
            this.#polledAt.set(id, Date.now());
            if (found) continue;
            // « autres apps » : ignore Apple Music / Spotify, déjà lus directement
            states[id] = id === "autre" && s.native ? { ...s.state, playing: false, handledBy: s.native } : s.state;
            if (states[id].playing) found = true;
        }
        const playingId = PRIORITY.find(id => states[id]?.playing);
        // rien ne joue : on reste sur la source qui a un morceau (en pause), en préférant l'app lue directement
        const hasTrack = id => !!states[id]?.track && !states[id]?.handledBy;
        const keep = hasTrack(this.active) ? this.active : PRIORITY.find(hasTrack) ?? states.autre?.handledBy ?? this.active;
        const next = playingId ?? keep;
        this.active = next;
        const src = this.#sources[next];
        this.#adopt(next, states[next] ?? src?.state ?? { ...EMPTY }, src?.error ?? null);
    }

    #adopt(id, st, error) {
        const prev = this.state;
        const prevKey = `${this.active}|${prev.track?.id}|${prev.status}`;
        const next = { ...st, source: id, app: st.app ?? this.#sources[id]?.name };
        // même morceau qui continue : les petites erreurs de lecture de la position sont lissées, pour que les temps
        // ne sautent pas (une vraie avance ou un retour dans le morceau est pris tel quel)
        if (prev.playing && st.playing && prev.source === id && prev.track?.id && prev.track.id === st.track?.id && !st.approx && st.at >= prev.at) {
            const predicted = this.positionAt(st.at);
            const res = this.#sources[id]?.resolution ?? 0; // Sonos : position à la seconde près
            if (res > 0) {
                if (predicted > st.position - 0.15 && predicted < st.position + res + 0.15) next.position = predicted;
            } else if (Math.abs(st.position - predicted) < 0.35) next.position = predicted + (st.position - predicted) * 0.25;
        }
        this.active = id;
        this.error = error;
        this.state = next;
        this.emit("state", this.state, prevKey !== `${id}|${st.track?.id}|${st.status}`);
    }

    positionAt(t = Date.now()) {
        const s = this.state;
        return s.playing ? s.position + (t - s.at) / 1000 : s.position;
    }

    // ---------- commandes (vers la source suivie)
    async command(action, arg) {
        const src = this.source;
        if (!src) throw new Error("Aucune source de musique");
        if (action === "playlist") {
            if (!src.caps.playlists) throw new Error(`Les playlists se lancent depuis ${src.name}`);
        } else if (!src.caps.control) throw new Error(`${src.name} ne se pilote pas d'ici`);
        await src.command(action, arg);
        setTimeout(() => this.refresh(), 300);
    }
    async playlists() {
        const a = this.#sources.apple;
        return a?.available ? a.playlists() : [];
    }
    /** Sorties AirPlay de l'app Musique (vides si Musique est fermée : on ne l'ouvre pas pour ça). */
    async airplay() {
        const a = this.#sources.apple;
        return a?.available ? a.airplay() : [];
    }
    async setAirplay(names) {
        return this.#sources.apple.setAirplay(names);
    }
    async setDeviceVolume(name, v) {
        return this.#sources.apple.setDeviceVolume(name, v);
    }
    async getVolume() {
        const src = this.source;
        return src?.caps?.volume ? src.getVolume() : null;
    }
    async setVolume(v) {
        const src = this.source;
        if (!src?.caps?.volume) throw new Error(`Le volume se règle dans ${src?.name ?? "l'app"}`);
        return src.setVolume(v);
    }
}

