// Infos publiques sur le morceau joué (Apple Music, Spotify, Deezer…) :
//  - Apple (API iTunes Search, sans compte) : pochette + extrait de 30 s (pour mesurer le tempo) + genre ;
//  - Deezer (API publique, sans compte) : tempo (BPM) quand il est connu.
// Tout est mis en cache sur le disque (data/morceaux/…).
import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { norm } from "./tempo.mjs";
import { readJson, writeFileAtomic, writeJson } from "./util.mjs";

const TIMEOUT = 8000;
const LOOKUP_V = 2; // v2 : + genres de l'album Deezer

async function getJson(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { "User-Agent": "ShowLumiere/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

async function download(url, file) {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    writeFileAtomic(file, Buffer.from(await r.arrayBuffer())); // jamais d'image à moitié téléchargée
    return file;
}

/** Titre nettoyé pour la recherche (sans « feat. », « Remastered »…). */
function cleanTitle(s) {
    return String(s ?? "")
        .replace(/\s*[([](feat|with|ft)\.?[^)\]]*[)\]]/gi, "")
        .replace(/\s*[([][^)\]]*(remaster|version|live|edit|mono|stereo)[^)\]]*[)\]]/gi, "")
        .replace(/\s-\s.*(remaster|version|live|edit).*$/i, "")
        .trim();
}

function sameSong(track, title, artist) {
    const t = norm(cleanTitle(track.name));
    const a = norm(track.artist);
    const rt = norm(cleanTitle(title));
    const ra = norm(artist);
    const titleOk = t === rt || t.startsWith(rt) || rt.startsWith(t);
    const artistOk = !a || !ra || a.includes(ra.split(" ")[0]) || ra.includes(a.split(" ")[0]);
    return titleOk && artistOk;
}

export class SongInfo {
    #cache;
    #file;
    #dir;
    #pending = new Map();

    /** fixtures : dossier de fichiers de test (pochette « titre.jpg/png », extrait « titre.wav ») à la place d'Internet. */
    constructor(dataDir, { fixtures } = {}) {
        this.fixtures = fixtures;
        this.#dir = join(dataDir, "morceaux");
        mkdirSync(this.#dir, { recursive: true });
        this.#file = join(this.#dir, "index.json");
        this.#cache = readJson(this.#file, {});
    }

    #save() {
        writeJson(this.#file, this.#cache, 1);
    }

    get(key) {
        return this.#cache[key] ?? null;
    }

    /** Ajoute des résultats d'analyse venant de la page (tempo de l'extrait, palette de la pochette). */
    merge(key, data) {
        const cur = this.#cache[key] ?? {};
        this.#cache[key] = { ...cur, ...data, updatedAt: Date.now() };
        this.#save();
        return this.#cache[key];
    }

    file(key, kind) {
        const info = this.#cache[key];
        const f = info?.[kind === "cover" ? "coverFile" : "previewFile"];
        return f && existsSync(f) ? f : null;
    }

    /** Recherche (une fois par morceau) la pochette, l'extrait et le tempo. */
    async lookup(key, track) {
        if (!track?.name) return null;
        const have = this.#cache[key];
        if (have?.lookedUp && (have.v ?? 1) >= LOOKUP_V && Date.now() - have.lookedUp < 30 * 24 * 3600e3) return have;
        if (this.#pending.has(key)) return this.#pending.get(key);
        const p = this.#doLookup(key, track).finally(() => this.#pending.delete(key));
        this.#pending.set(key, p);
        return p;
    }

    async #doLookup(key, track) {
        const out = { title: track.name, artist: track.artist, lookedUp: Date.now(), v: LOOKUP_V };
        if (this.fixtures) {
            const base = join(this.fixtures, norm(track.name).replace(/ /g, "-"));
            for (const ext of ["jpg", "png"]) if (existsSync(`${base}.${ext}`)) out.coverFile = `${base}.${ext}`;
            for (const ext of ["wav", "m4a", "mp3"]) if (existsSync(`${base}.${ext}`)) out.previewFile = `${base}.${ext}`;
            this.#cache[key] = { ...(this.#cache[key] ?? {}), ...out };
            this.#save();
            return this.#cache[key];
        }
        const term = `${track.artist ?? ""} ${cleanTitle(track.name)}`.trim();
        const hash = createHash("sha1").update(key).digest("hex").slice(0, 16);
        const coverPath = join(this.#dir, `${hash}-pochette.jpg`);
        const previewPath = join(this.#dir, `${hash}-extrait.m4a`);
        // déjà téléchargés lors d'une recherche précédente : on ne les retélécharge pas
        const fetchTo = (url, file) => (existsSync(file) ? Promise.resolve(file) : download(url, file));

        // pochette donnée par l'app elle-même (Spotify) : la bonne à coup sûr
        // (https, ou une enceinte du réseau local, ex. Sonos : http://192.168.x.x:1400/getaa?…)
        if (track.artworkUrl && (/^https:\/\//.test(track.artworkUrl) || /^http:\/\/(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\.[\d.]+(:\d+)?\//.test(track.artworkUrl)))
            out.coverFile = await fetchTo(track.artworkUrl, coverPath).catch(() => undefined);

        // Apple : pochette + extrait
        try {
            const j = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=8&country=fr`);
            const hit = (j.results ?? []).find(r => sameSong(track, r.trackName, r.artistName));
            if (hit) {
                out.appleGenre = hit.primaryGenreName;
                if (hit.artworkUrl100 && !out.coverFile) {
                    const url = hit.artworkUrl100.replace(/\/\d+x\d+bb\./, "/300x300bb."); // affichée en 54 px, analysée en 128 px
                    out.coverFile = await fetchTo(url, coverPath).catch(() => undefined);
                }
                if (hit.previewUrl) {
                    out.previewFile = await fetchTo(hit.previewUrl, previewPath).catch(() => undefined);
                }
            }
        } catch (e) {
            out.appleError = e.message;
        }

        // Deezer : tempo (souvent connu pour les titres populaires) et genres de l'album
        try {
            const j = await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=8`);
            const hit = (j.data ?? []).find(r => sameSong(track, r.title, r.artist?.name));
            if (hit) {
                const full = await getJson(`https://api.deezer.com/track/${hit.id}`);
                if (full.bpm > 0) out.deezerBpm = full.bpm;
                if (typeof full.gain === "number") out.gain = full.gain;
                const albumId = full.album?.id ?? hit.album?.id;
                if (albumId) {
                    const alb = await getJson(`https://api.deezer.com/album/${albumId}`).catch(() => null);
                    const genres = (alb?.genres?.data ?? []).map(g => g.name).filter(Boolean);
                    if (genres.length) out.deezerGenres = genres;
                }
                if (!out.coverFile && (hit.album?.cover_medium || hit.album?.cover_big)) {
                    out.coverFile = await fetchTo(hit.album.cover_medium || hit.album.cover_big, coverPath).catch(() => undefined);
                }
            }
        } catch (e) {
            out.deezerError = e.message;
        }

        if (out.appleError && out.deezerError) delete out.lookedUp; // pas de réseau : on réessaiera au prochain passage
        this.#cache[key] = { ...(this.#cache[key] ?? {}), ...out };
        this.#save();
        return this.#cache[key];
    }
}
