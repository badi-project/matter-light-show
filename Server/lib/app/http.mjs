// Outils du serveur web : routes de l'API, corps JSON, réponses, fichiers de la page (compressés, mis en cache).
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { brotliCompressSync, constants as Z, gzipSync } from "node:zlib";

export const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".svg", ".json"]);

/** Encodage accepté par le navigateur ("br", "gzip" ou null). */
const encodingOf = req => {
    const a = String(req?.headers["accept-encoding"] ?? "");
    return /\bbr\b/.test(a) ? "br" : /\bgzip\b/.test(a) ? "gzip" : null;
};

/** Réponse JSON (compressée si elle est grosse : l'état complet pèse ~15 Ko). */
export function send(res, code, data, req = null) {
    const body = Buffer.from(JSON.stringify(data));
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
    if (body.length > 4096 && encodingOf(req) === "gzip") {
        res.writeHead(code, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
        return res.end(gzipSync(body, { level: 5 }));
    }
    res.writeHead(code, headers);
    res.end(body);
}

export function sendHtml(res, code, page) {
    res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(page);
}

export async function readBody(req) {
    let raw = "";
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 2_000_000) throw Object.assign(new Error("Requête trop volumineuse"), { status: 413 });
    }
    try {
        return raw ? JSON.parse(raw) : {};
    } catch {
        throw Object.assign(new Error("Requête illisible (JSON invalide)"), { status: 400 });
    }
}

/** Table des routes « MÉTHODE /api/chemin/:param » -> fonction. */
export class Router {
    #routes = []; // { method, parts, handler }

    add(table) {
        for (const [key, handler] of Object.entries(table)) {
            const [method, pattern] = key.split(" ");
            if (this.#routes.some(r => r.key === key)) throw new Error(`Route en double : ${key}`);
            this.#routes.push({ key, method, parts: pattern.split("/"), handler });
        }
        return this;
    }

    /** { handler, params } ; null si aucune route ; { bad: true } si l'adresse est mal encodée. */
    match(method, pathname) {
        const up = pathname.split("/");
        for (const r of this.#routes) {
            if (r.method !== method || r.parts.length !== up.length) continue;
            const params = {};
            let ok = true;
            for (let i = 0; i < r.parts.length && ok; i++) {
                const p = r.parts[i];
                if (p.startsWith(":")) {
                    try {
                        params[p.slice(1)] = decodeURIComponent(up[i]);
                    } catch {
                        return { bad: true };
                    }
                } else ok = p === up[i];
            }
            if (ok) return { handler: r.handler, params };
        }
        return null;
    }
}

/**
 * Fichiers de la page (dossier public) : lus une fois puis gardés en mémoire (relus s'ils changent), compressés
 * (brotli / gzip), avec ETag. Dans index.html, les liens vers les fichiers locaux reçoivent « ?v=empreinte » : ces
 * fichiers-là sont gardés un an par le navigateur (une nouvelle version change l'empreinte).
 */
export class StaticFiles {
    #cache = new Map(); // chemin -> { mtime, size, raw, gz, br, etag, hash }

    constructor(dir) {
        this.dir = resolve(dir);
    }

    #load(file) {
        let st;
        try {
            st = statSync(file);
        } catch {
            return null;
        }
        if (!st.isFile()) return null;
        const hit = this.#cache.get(file);
        // la page dépend aussi des empreintes des fichiers qu'elle cite : relue si l'un d'eux a changé
        if (hit && hit.mtime === st.mtimeMs && hit.size === st.size && hit.deps.every(d => this.#load(d.file)?.hash === d.hash)) return hit;
        let raw = readFileSync(file);
        const ext = extname(file);
        const deps = [];
        let build = null;
        if (file === join(this.dir, "index.html")) {
            // empreinte de la page et de tout ce qu'elle cite, écrite dans la page : une page ouverte voit qu'une
            // nouvelle version est installée et se recharge
            const html = this.#fingerprint(raw.toString("utf8"), deps);
            build = createHash("sha1").update(html).digest("base64url").slice(0, 10);
            raw = Buffer.from(html.replace('content="__BUILD__"', `content="${build}"`));
        }
        const hash = createHash("sha1").update(raw).digest("base64url").slice(0, 10);
        const entry = { mtime: st.mtimeMs, size: st.size, raw, hash, build, deps, etag: `"${hash}"`, type: MIME[ext] ?? "application/octet-stream", compress: COMPRESSIBLE.has(ext) && raw.length > 1024 };
        this.#cache.set(file, entry);
        return entry;
    }

    /** Empreinte de la version de la page installée (relue au plus toutes les 2 s). */
    build() {
        const now = Date.now();
        if (now - this.#buildAt > 2000) {
            this.#buildAt = now;
            this.#build = this.#load(join(this.dir, "index.html"))?.build ?? null;
        }
        return this.#build;
    }
    #build = null;
    #buildAt = 0;

    /** Ajoute « ?v=empreinte » aux fichiers locaux cités par la page (scripts, styles, icônes). */
    #fingerprint(html, deps) {
        return html.replace(/\b(src|href)="(?!https?:|data:|\/\/|#|\/api\/)\/?([\w./-]+\.(?:js|css|png|svg))"/g, (all, attr, path) => {
            const f = join(this.dir, path);
            const e = this.#load(f);
            if (!e) return all;
            deps.push({ file: f, hash: e.hash });
            return `${attr}="/${path}?v=${e.hash}"`;
        });
    }

    /** Envoie le fichier ; false s'il n'existe pas. */
    serve(req, res, pathname, query) {
        const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
        const file = resolve(this.dir, rel);
        if (file !== this.dir && !file.startsWith(this.dir + sep)) return false;
        const e = this.#load(file);
        if (!e) return false;
        // fichier cité avec son empreinte : gardé un an ; la page elle-même : toujours revalidée (304 si inchangée)
        const immutable = query?.get("v") === e.hash;
        const headers = {
            "Content-Type": e.type,
            "Cache-Control": immutable ? "private, max-age=31536000, immutable" : "private, no-cache",
            ETag: e.etag,
            Vary: "Accept-Encoding",
        };
        if (req.headers["if-none-match"] === e.etag) {
            res.writeHead(304, headers);
            res.end();
            return true;
        }
        const enc = e.compress ? encodingOf(req) : null;
        let body = e.raw;
        if (enc === "br") body = e.br ??= brotliCompressSync(e.raw, { params: { [Z.BROTLI_PARAM_QUALITY]: 10 } });
        else if (enc === "gzip") body = e.gz ??= gzipSync(e.raw, { level: 9 });
        if (enc) headers["Content-Encoding"] = enc;
        res.writeHead(200, headers);
        res.end(req.method === "HEAD" ? undefined : body);
        return true;
    }
}
