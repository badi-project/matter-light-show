// Petits outils communs : fichiers JSON, bornes, attentes, erreurs HTTP.
import { readFileSync, renameSync, writeFileSync } from "node:fs";

/** Lit un fichier JSON (fallback s'il manque ou s'il est illisible). */
export function readJson(file, fallback = null) {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

/** Écrit un fichier d'un seul coup (fichier temporaire puis renommage) : jamais à moitié écrit, même si le Mac s'éteint. */
export function writeFileAtomic(file, data) {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, file);
}

export const writeJson = (file, data, indent = 2) => writeFileAtomic(file, JSON.stringify(data, null, indent));

/** JSON lu dans une sortie de commande (null si ce n'en est pas). */
export function parseJson(s) {
    try {
        return JSON.parse(String(s ?? "").trim());
    } catch {
        return null;
    }
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Volume ou pourcentage entier de 0 à 100. */
export const pct = v => clamp(Math.round(Number(v) || 0), 0, 100);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Rejette si la promesse ne se termine pas à temps (la promesse d'origine continue en arrière-plan). */
export function withTimeout(promise, ms, what = "délai dépassé") {
    let t;
    return Promise.race([promise, new Promise((_, reject) => (t = setTimeout(() => reject(new Error(what)), ms)))]).finally(() => clearTimeout(t));
}

/** Erreur renvoyée telle quelle à la page, avec son code HTTP. */
export const httpError = (status, message) => Object.assign(new Error(message), { status });
