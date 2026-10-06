// Version du logiciel (package.json), affichée dans Réglages et au démarrage.
import { readFileSync } from "node:fs";

const read = rel => {
    try {
        return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
    } catch {
        return {};
    }
};
const pkg = read("../package.json");

export const VERSION = pkg.version ?? "?";
export const RELEASE_DATE = pkg.releaseDate ?? null; // AAAA-MM-JJ
export const versionInfo = () => ({
    version: VERSION,
    date: RELEASE_DATE,
    node: process.versions.node,
    matter: read("../node_modules/@matter/main/package.json").version ?? null,
});
