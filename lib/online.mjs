// Infos publiques sur le morceau joué dans Apple Music :
//  - Apple (API iTunes Search, sans compte) : pochette + extrait de 30 s (pour mesurer le tempo) + genre ;
//  - Deezer (API publique, sans compte) : tempo (BPM) quand il est connu.
// Tout est mis en cache sur le disque (data/morceaux/…).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { norm } from "./tempo.mjs";

const TIMEOUT = 8000;

async function getJson(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { "User-Agent": "ShowLumiere/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

async function download(url, file) {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
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
        try {
            this.#cache = JSON.parse(readFileSync(this.#file, "utf8"));
        } catch {
            this.#cache = {};
        }
    }

    #save() {
        writeFileSync(this.#file, JSON.stringify(this.#cache, null, 1));
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
        if (have?.lookedUp && Date.now() - have.lookedUp < 30 * 24 * 3600e3) return have;
        if (this.#pending.has(key)) return this.#pending.get(key);
        const p = this.#doLookup(key, track).finally(() => this.#pending.delete(key));
        this.#pending.set(key, p);
        return p;
    }

    async #doLookup(key, track) {
        const out = { title: track.name, artist: track.artist, lookedUp: Date.now() };
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

        // Apple : pochette + extrait
        try {
            const j = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=8&country=fr`);
            const hit = (j.results ?? []).find(r => sameSong(track, r.trackName, r.artistName));
            if (hit) {
                out.appleGenre = hit.primaryGenreName;
                if (hit.artworkUrl100) {
                    const url = hit.artworkUrl100.replace(/\/\d+x\d+bb\./, "/600x600bb.");
                    out.coverFile = await download(url, join(this.#dir, `${hash}-pochette.jpg`)).catch(() => undefined);
                }
                if (hit.previewUrl) {
                    out.previewFile = await download(hit.previewUrl, join(this.#dir, `${hash}-extrait.m4a`)).catch(() => undefined);
                }
            }
        } catch (e) {
            out.appleError = e.message;
        }

        // Deezer : tempo (souvent connu pour les titres populaires)
        try {
            const j = await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=8`);
            const hit = (j.data ?? []).find(r => sameSong(track, r.title, r.artist?.name));
            if (hit) {
                const full = await getJson(`https://api.deezer.com/track/${hit.id}`);
                if (full.bpm > 0) out.deezerBpm = full.bpm;
                if (typeof full.gain === "number") out.gain = full.gain;
                if (!out.coverFile && hit.album?.cover_big) {
                    out.coverFile = await download(hit.album.cover_big, join(this.#dir, `${hash}-pochette.jpg`)).catch(() => undefined);
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
