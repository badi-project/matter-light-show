// Show automatique fabriqué à partir de la musique : couleurs (pochette ou genre) + style (tempo, genre).
import { norm } from "./tempo.mjs";

// Palettes par défaut selon le genre, quand la pochette n'a pas encore été analysée.
const GENRE_PALETTES = [
    [/jazz|blues|soul|r&b|rnb/, ["#ff9a2e", "#7a3cff", "#ff4f6d"]],
    [/classi|opera|baroque/, ["#ffcf7a", "#5a8cff", "#ffb36b"]],
    [/electro|dance|house|techno|edm|trance/, ["#00e5ff", "#ff00d4", "#2b50ff", "#00ff9c"]],
    [/hip|rap|trap|drill/, ["#9b30ff", "#ffb000", "#ff1a3c"]],
    [/rock|metal|punk|grunge/, ["#ff2a00", "#ff8c00", "#ffffff"]],
    [/reggae|dancehall|afro/, ["#00c040", "#ffd400", "#ff1a1a"]],
    [/latin|salsa|reggaeton|bachata|samba|bossa/, ["#ff2d6f", "#ffb000", "#ff5a00", "#ff00d4"]],
    [/country|folk|acoust|singer|auteur/, ["#ffb36b", "#7fbf4f", "#ffd27a"]],
    [/ambient|new age|soundtrack|bande|film|anime/, ["#4b6bff", "#00c8ff", "#9b7bff"]],
    [/alternati|indie|indé/, ["#2bd4c0", "#ff7a6b", "#b48cff"]],
    [/pop|variet|k-pop|j-pop/, ["#ff2db4", "#00c8ff", "#9b30ff"]],
];
const DEFAULT_PALETTE = ["#ff2d6f", "#00c8ff", "#ffb000", "#9b30ff"];

export function genrePalette(genre) {
    const g = norm(genre);
    for (const [re, pal] of GENRE_PALETTES) if (re.test(g)) return pal;
    return DEFAULT_PALETTE;
}

function hexToHsl(hex) {
    const n = parseInt(String(hex).replace("#", ""), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return { h, s, l };
}

function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return "#" + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

const hueDist = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * Garantit des couleurs vraiment différentes sur des ampoules : une pochette presque monochrome
 * (ex. tons orangés) donnerait des changements invisibles. On garde les couleurs de la pochette,
 * on retire blancs/gris, puis on complète avec des teintes du genre ou complémentaires
 * jusqu'à avoir au moins `min` teintes bien distinctes (≥ 50° d'écart).
 */
export function enrichPalette(palette, genre, min = 3) {
    const out = [];
    const hues = [];
    const distinct = () => {
        const kept = [];
        for (const h of hues) if (kept.every(k => hueDist(k, h) >= 50)) kept.push(h);
        return kept.length;
    };
    for (const c of palette ?? []) {
        if (typeof c !== "string" || !c.startsWith("#")) continue; // blancs « 2700K »
        const { h, s, l } = hexToHsl(c);
        if (s < 0.3 || l < 0.12 || l > 0.92) continue; // gris, noir, blanc
        if (hues.some(x => hueDist(x, h) < 25)) continue; // quasi identique sur une lampe
        out.push(c);
        hues.push(h);
    }
    const add = (hex) => {
        const { h } = hexToHsl(hex);
        if (hues.every(x => hueDist(x, h) >= 50)) {
            out.push(hex);
            hues.push(h);
        }
    };
    if (distinct() < min) for (const c of genrePalette(genre)) if (distinct() < min + 1) add(c);
    const base = hues[0] ?? 30;
    for (const d of [150, 210, 90, 270, 45, 315]) if (distinct() < min) add(hslToHex((base + d) % 360, 1, 0.5));
    return out.slice(0, 5);
}

/** calme | groove | energique, selon le tempo et le genre. */
export function musicStyle(bpm, genre) {
    const g = norm(genre);
    const calmGenre = /jazz|classi|ambient|new age|soundtrack|bande|film|vocal|easy|singer|auteur|lounge|piano/.test(g);
    const danceGenre = /electro|dance|house|techno|edm|hip|rap|reggaeton|trap|drill|disco|funk/.test(g);
    if (calmGenre && bpm < 130) return "calme";
    if (bpm && bpm < 90) return "calme";
    if (bpm >= 125 || (danceGenre && bpm >= 100)) return "energique";
    return "groove";
}

export const STYLE_LABEL = { calme: "calme", groove: "groove", energique: "énergique" };

function all(name, color, brightness, duration, fade) {
    return { name, duration, fade, mode: "all", all: { on: true, color, brightness } };
}
function pal(name, colors, brightness, shift, duration, fade) {
    return { name, duration, fade, mode: "palette", palette: { colors, brightness, shift } };
}

/** Fabrique un show (durées en temps) à partir d'une palette et d'un style. */
export function makeAutoShow({ palette, style, bpm, title, source }) {
    let c = (palette ?? []).filter(Boolean).slice(0, 5);
    if (c.length === 0) c = DEFAULT_PALETTE;
    if (c.length === 1) c = [c[0], "2700K"];
    const n = c.length;
    const rev = [...c].reverse();
    const steps = [];
    if (style === "calme") {
        steps.push(all("Nappe", c[0], 55, 8, 4));
        for (let s = 0; s < n; s++) steps.push(pal(`Vague douce ${s + 1}`, c, 60, s, 8, 4));
        steps.push(all("Respiration", c[1], 45, 8, 4));
        for (let s = 0; s < Math.min(n, 2); s++) steps.push(pal(`Retour ${s + 1}`, rev, 55, s, 8, 4));
    } else if (style === "energique") {
        for (let round = 0; round < 2; round++) {
            for (let s = 0; s < n; s++) steps.push(pal(`Course ${round * n + s + 1}`, c, 100, s, 2, 0.25));
            steps.push(all("Impact", c[round % n], 100, 2, 0));
            for (let s = 0; s < n; s++) steps.push(pal(`Contre-temps ${s + 1}`, rev, 90, s, 2, 0.25));
        }
    } else {
        for (let s = 0; s < n; s++) steps.push(pal(`Groove ${s + 1}`, c, 85, s, 4, 1));
        steps.push(all("Couleur pleine", c[0], 80, 4, 1));
        for (let s = 0; s < n; s++) steps.push(pal(`Groove inversé ${s + 1}`, rev, 85, s, 4, 1));
        steps.push(all("Couleur pleine 2", c[Math.min(1, n - 1)], 80, 4, 1));
    }
    return {
        id: "auto",
        name: `Auto · ${title || "musique"}`,
        auto: true,
        loop: true,
        speed: 1,
        tempo: { bpm: Math.round(bpm || 120) },
        style,
        paletteSource: source,
        steps,
    };
}
