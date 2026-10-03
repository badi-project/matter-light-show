// Genre musical : reconnu à partir des étiquettes (app Musique, Apple, Deezer) et, à défaut, deviné à l'écoute.
// Chaque famille de genres donne : des couleurs d'ambiance, un motif d'accents (sur quels temps la lumière tape)
// et un « toucher » (accents secs ou doux).
import { norm } from "./tempo.mjs";

// motifs d'accents : force de 0 à 1 pour chaque temps (boucle de 4 ou 8 temps)
export const PATTERNS = {
    chaque: { label: "chaque temps marqué", beats: [1, 0.7, 0.85, 0.7] },
    backbeat: { label: "temps 2 et 4 (backbeat)", beats: [0.9, 1, 0.55, 1] },
    kicksnare: { label: "grosse caisse et caisse claire", beats: [1, 0.75, 0.6, 0.8] },
    onedrop: { label: "one drop (3ᵉ temps)", beats: [0.35, 0.65, 1, 0.65] },
    dembow: { label: "dembow", beats: [1, 0.55, 0.7, 0.95] },
    afro: { label: "contretemps afro", beats: [0.8, 1, 0.65, 1] },
    darbouka: { label: "darbouka", beats: [1, 0.45, 0.75, 0.6] },
    swing: { label: "swing (2 et 4 doux)", beats: [0.55, 0.85, 0.5, 0.85] },
    boomchick: { label: "boom-chick", beats: [1, 0.55, 0.85, 0.55] },
    pop: { label: "temps fort marqué", beats: [1, 0.6, 0.85, 0.6] },
    lourd: { label: "lourd et martelé", beats: [1, 0.9, 1, 0.9] },
    respiration: { label: "respiration lente", beats: [1, 0.9, 0.78, 0.68, 0.62, 0.68, 0.78, 0.9] },
};

// toucher : durée des accents (en fraction de temps, plafonnée en secondes)
export const FEELS = { sec: { frac: 0.2, max: 0.08 }, moyen: { frac: 0.3, max: 0.15 }, doux: { frac: 0.6, max: 0.6 } };

// spec : 3 = genre précis, 2 = assez large (indé), 1 = très large (pop)
const FAMILIES = [
    { id: "noel", label: "Noël / fêtes", spec: 4, re: /\b(christmas|xmas|noel|navidad|weihnacht|holiday|jingle|santa|reveillon)\b/, pattern: "pop", feel: "moyen", colors: ["#ff1a1a", "#00c853", "#ffc400", "2700K"] },
    { id: "halloween", label: "Halloween", spec: 4, re: /\b(halloween|spooky|zombie|vampire|witch|sorciere|horror|horreur)\b/, pattern: "darbouka", feel: "sec", colors: ["#ff6a00", "#7b2cff", "#39ff14"] },
    { id: "kpop", label: "K-pop", spec: 3, dance: true, energy: 0.1, re: /\b(k ?pop|korean|coreen\w*|coree|asian music|asiatique)\b/, pattern: "chaque", feel: "sec", colors: ["#ff2d95", "#8a2be2", "#00d5ff", "#3dffb5"] },
    { id: "jpop", label: "J-pop", spec: 3, re: /\b(j ?pop|anime|japan|japon|city pop|c ?pop|mandopop|cantopop)\b/, pattern: "pop", feel: "moyen", colors: ["#ff7eb6", "#4fc3ff", "#ffe94d", "#b18cff"] },
    { id: "arabe", label: "Musique arabe / orientale", spec: 3, re: /\b(arab\w*|rai|khaleeji|orient\w*|maghreb\w*|egypt\w*|turk\w*|mahraganat|chaabi)\b/, pattern: "darbouka", feel: "moyen", colors: ["#ffb300", "#00c9b7", "#e0218a", "#c1121f"] },
    { id: "latin", label: "Latino", spec: 3, dance: true, re: /\b(latin\w*|reggaeton|salsa|bachata|cumbia|merengue|samba|bossa|tango|flamenco|bresil\w*|brazil\w*|mpb|sertanejo|dembow|urbano)\b/, pattern: "dembow", feel: "moyen", colors: ["#ff2d6f", "#ff7a00", "#ffd400", "#00d0c0"] },
    { id: "afro", label: "Afro / musiques du monde", spec: 3, dance: true, re: /\b(afro\w*|amapiano|zouk|kompa|coupe decale|ndombolo|highlife|african\w*|africain\w*|afrique|world|monde|bouyon|kizomba)\b/, pattern: "afro", feel: "moyen", colors: ["#19c94a", "#ffc107", "#ff6d00", "#e91e63"] },
    { id: "reggae", label: "Reggae / dancehall", spec: 3, re: /\b(reggae|dancehall|ska|dub|roots)\b/, pattern: "onedrop", feel: "moyen", colors: ["#00b140", "#ffd500", "#e01e1e"] },
    { id: "hiphop", label: "Hip-hop / rap", spec: 3, re: /\b(hip ?hop|rap|trap|drill|grime|urbain|urban)\b/, pattern: "kicksnare", feel: "moyen", colors: ["#7b1fff", "#ffb000", "#e0103a", "#1f4bff"] },
    { id: "funk", label: "Funk / disco", spec: 3, dance: true, re: /\b(funk|disco|boogie)\b/, pattern: "chaque", feel: "sec", colors: ["#ff00b4", "#ff8c00", "#ffd000", "#00e0c6"] },
    { id: "rnb", label: "R&B / soul", spec: 3, re: /\b(r ?b|rnb|soul|gospel)\b/, pattern: "backbeat", feel: "doux", colors: ["#d6249f", "#5e17eb", "#ff9500"] },
    { id: "electro", label: "Électro / dance", spec: 3, dance: true, energy: 0.1, re: /\b(electro\w*|dance|house|techno|edm|trance|dubstep|drum|club|eurodance|hardstyle|breakbeat|synthwave|garage)\b/, pattern: "chaque", feel: "sec", colors: ["#00e5ff", "#ff00d4", "#2b50ff", "#39ff14"] },
    { id: "metal", label: "Métal", spec: 3, energy: 0.15, re: /\b(metal\w*|hardcore|thrash)\b/, pattern: "lourd", feel: "sec", colors: ["#d00000", "6500K", "#4b0082"] },
    { id: "rock", label: "Rock", spec: 3, energy: 0.05, re: /\b(rock|punk|grunge|britpop|emo)\b/, pattern: "backbeat", feel: "sec", colors: ["#ff2a00", "#ff9f00", "5000K"] },
    { id: "jazz", label: "Jazz", spec: 3, calm: true, re: /\b(jazz|swing|bebop|big band)\b/, pattern: "swing", feel: "doux", colors: ["#ffa000", "#1e3cff", "#a0153e"] },
    { id: "blues", label: "Blues", spec: 3, calm: true, re: /\bblues\b/, pattern: "swing", feel: "doux", colors: ["#2340ff", "#4b2bd1", "#ff9800"] },
    { id: "classique", label: "Classique", spec: 3, calm: true, re: /\b(classi\w*|opera|baroque|orchest\w*|symphon\w*|chamber|choral|lyrique)\b/, pattern: "respiration", feel: "doux", colors: ["#ffc04d", "2700K", "#2a4bff", "#8e1b3a"] },
    { id: "film", label: "Musique de film", spec: 3, calm: true, re: /\b(soundtrack|bande originale|films?|movie|cinema|games|jeux video|tv|musical|comedie musicale)\b/, pattern: "respiration", feel: "doux", colors: ["#1d4bff", "#00b3a6", "#ffb300"] },
    { id: "ambient", label: "Ambient / chill", spec: 3, calm: true, re: /\b(ambient|new age|chill\w*|lo ?fi|meditation|relax\w*|downtempo|sleep|spa)\b/, pattern: "respiration", feel: "doux", colors: ["#3a6bff", "#00c2c7", "#a98bff"] },
    { id: "folk", label: "Folk / country", spec: 3, re: /\b(country|folk|americana|bluegrass|acoust\w*|singer|songwriter|auteur)\b/, pattern: "boomchick", feel: "moyen", colors: ["#ffa726", "2700K", "#8bc34a", "#ff7043"] },
    { id: "chanson", label: "Chanson / variété", spec: 3, re: /\b(chanson\w*|variete francaise|pop francaise|french pop)\b/, pattern: "pop", feel: "moyen", colors: ["#ff4f8b", "#3d7bff", "2700K", "#ffc04d"] },
    { id: "indie", label: "Indé / alternatif", spec: 2, re: /\b(alternati\w*|indie|inde|shoegaze|dream pop|bedroom pop)\b/, pattern: "pop", feel: "moyen", colors: ["#19d3c5", "#ff6f61", "#b18cff", "#ffc93c"] },
    { id: "pop", label: "Pop", spec: 1, re: /\b(pop|variete\w*)\b/, pattern: "pop", feel: "moyen", colors: ["#ff2db4", "#00c8ff", "#9b30ff", "#ffe14d"] },
];
const BY_ID = Object.fromEntries(FAMILIES.map(f => [f.id, f]));
const DEFAULT = { id: "autre", label: "Autre", spec: 0, pattern: "pop", feel: "moyen", colors: ["#ff2d6f", "#00c8ff", "#ffb000", "#9b30ff"] };

export function family(id) {
    return BY_ID[id] ?? DEFAULT;
}

function familyOf(text) {
    const t = ` ${norm(text)} `;
    let best = null;
    for (const f of FAMILIES) if (f.re.test(t) && (!best || f.spec > best.spec)) best = f;
    return best;
}

/** Devine une famille à l'écoute (seulement si aucune étiquette n'est connue). */
function guessFromAudio(features, bpm) {
    if (!features) return null;
    const { energy = 0.5, bass = 0.2, pulse = 0.2, brightness = 2000, onsetRate = 2.5 } = features;
    if (energy < 0.3 || (pulse < 0.06 && energy < 0.45)) return BY_ID.ambient;
    if (pulse > 0.3 && bass > 0.25 && bpm >= 115 && bpm <= 135) return BY_ID.electro;
    if (bass > 0.28 && (bpm < 105 || bpm > 135) && onsetRate > 2.5) return BY_ID.hiphop;
    if (brightness > 3500 && onsetRate > 4 && energy > 0.65) return BY_ID.rock;
    if (energy < 0.45 && bass < 0.15) return BY_ID.folk;
    return BY_ID.pop;
}

/**
 * Genre du morceau.
 * Sources (par ordre de confiance) : étiquette de l'app Musique, Apple (iTunes), Deezer (genres de l'album).
 * Les fêtes (Noël, Halloween) se repèrent aussi dans le titre, l'album ou la playlist.
 * Renvoie { id, label, name, sources: [{ src, name }], guessed }.
 */
export function detectGenre({ track = {}, playlist = "", info = {}, features = null, bpm = 0 }) {
    const sources = [];
    if (track.genre) sources.push({ src: "app Musique", name: track.genre });
    if (info.appleGenre && norm(info.appleGenre) !== norm(track.genre)) sources.push({ src: "Apple", name: info.appleGenre });
    for (const g of info.deezerGenres ?? []) if (!sources.some(s => norm(s.name) === norm(g))) sources.push({ src: "Deezer", name: g });

    // fêtes : titre, album, playlist
    const festive = familyOf(`${track.name ?? ""} ${track.album ?? ""} ${playlist ?? ""}`);
    if (festive && festive.spec >= 4) return { id: festive.id, label: festive.label, name: festive.label, sources, guessed: false };

    let best = null;
    for (const s of sources) {
        const f = familyOf(s.name);
        if (f && (!best || f.spec > best.f.spec)) best = { f, s };
    }
    if (best) return { id: best.f.id, label: best.f.label, name: best.s.name, sources, guessed: false };
    if (sources.length) return { id: "autre", label: sources[0].name, name: sources[0].name, sources, guessed: false };
    const g = guessFromAudio(features, bpm);
    if (g) return { id: g.id, label: g.label, name: g.label, sources, guessed: true };
    return { id: "autre", label: "non renseigné", name: "non renseigné", sources, guessed: false };
}

/**
 * Énergie (0..1) : mesurée sur l'extrait si possible, sinon estimée (volume Deezer, genre, tempo).
 */
export function musicEnergy({ features, info = {}, fam, bpm }) {
    const f = family(fam);
    if (features?.energy != null) return { value: Math.max(0, Math.min(1, features.energy + (f.energy ?? 0) * 0.5)), measured: true };
    let e = 0.5;
    if (typeof info.gain === "number") e = 0.2 + 0.6 * Math.max(0, Math.min(1, (info.gain + 14) / 9)); // -14 dB = doux, -5 dB = très fort
    if (f.calm) e -= 0.15;
    e += f.energy ?? 0;
    if (bpm >= 128) e += 0.08;
    if (bpm && bpm < 85) e -= 0.1;
    return { value: Math.max(0, Math.min(1, e)), measured: false };
}

/**
 * calme | groove | energique : tempo + genre + énergie (+ netteté de la pulsation).
 * Quand l'énergie a été mesurée sur l'extrait, elle prime sur le tempo (un tempo « rapide » peut se jouer en demi-temps).
 */
export function musicStyle({ bpm, fam, energy, pulse, measured = false }) {
    const f = family(fam);
    if (pulse != null && pulse < 0.06 && energy < 0.55) return "calme"; // pas de pulsation nette (rubato, orchestre…)
    if (energy < 0.33 || (f.calm && energy < 0.5) || (bpm && bpm < 85 && energy < 0.5)) return "calme";
    if (measured) return energy > 0.68 || (f.dance && energy > 0.55 && bpm >= 95) ? "energique" : "groove";
    if (energy > 0.68 || (f.dance && energy > 0.5 && bpm >= 108) || (bpm >= 128 && energy > 0.5)) return "energique";
    return "groove";
}

/** Tempo rapide mais musique peu énergique (dream pop, ballade…) : la lumière suit le demi-tempo ressenti. */
export function feltTempo({ bpm, fam, energy, measured }) {
    const f = family(fam);
    return measured && bpm > 130 && energy < 0.6 && !f.dance ? bpm / 2 : bpm;
}

/** Motif d'accents et toucher pour la famille et le style. */
export function rhythmFor(fam, style) {
    const f = family(fam);
    let pattern = f.pattern;
    let feel = f.feel;
    if (style === "calme") {
        feel = "doux";
        if (!["respiration", "swing", "onedrop"].includes(pattern)) pattern = "respiration";
    } else if (style === "energique" && feel === "doux") feel = "moyen";
    return { id: pattern, ...PATTERNS[pattern], feel, feelSpec: FEELS[feel] };
}

// ------------------------------------------------------------------ couleurs

function hexToHsl(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s, l };
}
function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return "#" + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}
const isHex = c => /^#[0-9a-f]{6}$/i.test(c);
const hueOf = c => (isHex(c) ? hexToHsl(c).h : null);
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const warmth = h => Math.cos(((h - 40) * Math.PI) / 180); // 1 = chaud (orange), -1 = froid (bleu)

/** Couleur adoucie (calme) : vers le blanc, sans perdre la teinte. */
function soften(hex, amount) {
    const { h, s, l } = hexToHsl(hex);
    return hslToHex(h, s * (1 - 0.35 * amount), Math.min(0.8, l + (0.85 - l) * 0.35 * amount));
}

// teintes HSL approximatives -> noms (cohérents avec ceux de la page, calculés en OKLCh)
export function nameOf(c) {
    if (!isHex(c)) return Number.parseInt(c) < 3200 ? "blanc chaud" : Number.parseInt(c) < 5000 ? "blanc neutre" : "blanc froid";
    const { h, s } = hexToHsl(c);
    if (s < 0.15) return "blanc";
    if (h >= 350 || h < 12) return "rouge";
    if (h < 42) return "orange";
    if (h < 68) return "jaune";
    if (h < 100) return "vert-jaune";
    if (h < 145) return "vert";
    if (h < 165) return "menthe";
    if (h < 200) return "turquoise";
    if (h < 255) return "bleu";
    if (h < 285) return "violet";
    if (h < 325) return "magenta";
    return "rose";
}

// « saveur » des nuances selon le genre (mode Nuances de la pochette)
const FLAVOR = {
    electro: "neon", kpop: "neon", jpop: "neon", funk: "neon", latin: "neon", pop: "neon", afro: "neon", noel: "neon", halloween: "neon",
    jazz: "profond", blues: "profond", rnb: "profond", classique: "profond", film: "profond", hiphop: "profond", arabe: "profond",
    ambient: "doux", folk: "doux", chanson: "doux", indie: "doux", reggae: "doux", autre: "doux",
    rock: "brut", metal: "brut",
};
const RECIPES = {
    neon: ["vif", "voisin+18", "voisin-18", "clair"],
    profond: ["fonce", "voisin-14", "profond", "pastel"],
    doux: ["pastel", "clair", "fonce", "voisin+12"],
    brut: ["fonce", "vif", "profond", "clair"],
    calme: ["pastel", "fonce", "clair", "profond"],
};
const SHADE_NAMES = { vif: "vif", clair: "clair", pastel: "pastel", fonce: "foncé", profond: "profond" };
const FLAVOR_LABEL = { neon: "vives et teintes voisines", profond: "profondes et foncées", doux: "douces et pastel", brut: "contrastées (foncé / vif)", calme: "douces et pastel" };

/** Description des nuances jouées (mode Nuances de la pochette). */
export function nuanceLabel(fam, style) {
    return FLAVOR_LABEL[style === "calme" ? "calme" : FLAVOR[family(fam).id] ?? "doux"];
}

// HSV : sur une ampoule, S = « blanchi » ou non (chromaticité), V = luminosité
function hexToHsv(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return { h: hexToHsl(hex).h, s: max ? (max - min) / max : 0, v: max };
}
function hsvToHex(h, s, v) {
    const l = v * (1 - s / 2);
    const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
    return hslToHex(h, sl, l);
}

/** Variante d'une couleur : même teinte plus vive / claire / pastel / foncée / profonde, ou teinte voisine. */
function variant(hex, kind) {
    const { h } = hexToHsl(hex);
    if (kind.startsWith("voisin")) {
        const c = hsvToHex((h + Number(kind.slice(6)) + 360) % 360, 1, 1);
        return { c, name: `${nameOf(c)} (teinte voisine)` };
    }
    const [sat, val] = { vif: [1, 1], clair: [0.45, 1], pastel: [0.25, 1], fonce: [1, 0.55], profond: [1, 0.32] }[kind];
    return { c: hsvToHex(h, sat, val), name: `${nameOf(hex)} ${SHADE_NAMES[kind]}` };
}

/** Deux couleurs qu'une ampoule rendrait presque pareil. */
function sameColor(a, b) {
    if (!isHex(a) || !isHex(b)) return a === b;
    const x = hexToHsv(a), y = hexToHsv(b);
    const hd = x.s < 0.08 && y.s < 0.08 ? 0 : hueDist(x.h, y.h);
    return hd < 10 && Math.abs(x.s - y.s) < 0.2 && Math.abs(x.v - y.v) < 0.18;
}

/**
 * Palette du show automatique, selon le mode choisi :
 *  - complet  : pochette + couleurs d'ambiance (genre, style, tempo) ;
 *  - sobre    : pochette + 2 couleurs d'ambiance seulement ;
 *  - pochette : uniquement les couleurs de la pochette ;
 *  - nuances  : couleurs de la pochette déclinées (vif, clair, pastel, foncé, teintes voisines) selon le genre et le style.
 * Renvoie { colors: [{ c, src, name }], accent, dim }.
 */
export function buildPalette({ cover, fam, style, bpm, energy, mode = "complet" }) {
    const f = family(fam);
    const coverCols = (cover?.colors ?? []).map(x => (typeof x === "string" ? { hex: x } : x)).filter(x => isHex(x.hex));
    const dim = cover?.light != null && cover.light < 0.35 ? 0.8 : 1; // pochette sombre = ambiance plus tamisée
    const out = [];
    const firstHex = () => out.find(o => isHex(o.c))?.c;
    const contrasting = () => {
        const h0 = hueOf(firstHex() ?? "#ff2d6f");
        return out.filter(o => isHex(o.c)).sort((a, b) => hueDist(hueOf(b.c), h0) - hueDist(hueOf(a.c), h0))[0]?.c ?? null;
    };

    // ---- pochette seule
    if (mode === "pochette") {
        coverCols.slice(0, 5).forEach(x => out.push({ c: x.hex, src: "pochette", name: x.name || nameOf(x.hex) }));
        if (!out.length) out.push({ c: "2700K", src: "pochette", name: "blanc chaud" }, { c: "4000K", src: "pochette", name: "blanc neutre" });
        return { colors: out, accent: style === "energique" && out.length > 1 ? contrasting() : null, dim };
    }

    // ---- nuances de la pochette
    if (mode === "nuances") {
        const target = style === "calme" ? 5 : style === "energique" ? 7 : 6;
        const bases = coverCols.slice(0, style === "energique" ? 3 : 2);
        if (!bases.length) {
            const whites = style === "calme" ? ["2200K", "2700K", "3500K"] : ["2700K", "4000K", "6500K"];
            whites.forEach(c => out.push({ c, src: "pochette", name: nameOf(c) }));
            return { colors: out, accent: null, dim };
        }
        bases.forEach(x => out.push({ c: x.hex, src: "pochette", name: x.name || nameOf(x.hex) }));
        let recipe = style === "calme" ? RECIPES.calme : RECIPES[FLAVOR[f.id] ?? "doux"];
        if (bases.length === 1) recipe = [...recipe, ...RECIPES.calme, "voisin+30", "voisin-30"].filter((k, i, a) => a.indexOf(k) === i);
        for (const kind of recipe) {
            for (const b of bases) {
                if (out.length >= target) break;
                const v = variant(b.hex, kind);
                if (out.some(o => sameColor(o.c, v.c))) continue;
                out.push({ ...v, src: "nuance" });
            }
            if (out.length >= target) break;
        }
        let accent = null;
        if (style === "energique") accent = hslToHex(hexToHsl(bases[0].hex).h, 0.6, 0.86); // flash : la couleur principale presque blanche
        return { colors: out, accent, dim };
    }

    // ---- complet / sobre : pochette + ambiance du genre
    const sobre = mode === "sobre";
    const keepCover = Math.min(coverCols.length, style === "calme" ? 2 : 3);
    const want = style === "calme" ? 3 : style === "energique" ? 5 : 4;
    const target = sobre ? Math.max(1, keepCover) + 2 : want + (style !== "calme" && bpm > 140 ? 1 : 0);
    const add = (c, src, name) => {
        if (out.length >= 9) return false;
        if (isHex(c)) {
            const h = hueOf(c);
            if (out.some(o => isHex(o.c) && hueDist(hueOf(o.c), h) < (src === "pochette" ? 12 : 40))) return false;
        } else if (out.some(o => !isHex(o.c))) return false; // un seul blanc
        out.push({ c, src, name: name || nameOf(c) });
        return true;
    };

    // 1) pochette : ses couleurs principales (2 à 3 selon sa richesse)
    coverCols.slice(0, Math.min(keepCover, Math.max(1, target - 1))).forEach(x => add(x.hex, "pochette", x.name));
    const nCover = out.length;
    // sobre : 2 couleurs d'ambiance ; complet : 3 (calme, groove) à 4 (énergique), +1 si très rapide
    const extra = (style === "energique" ? 4 : 3) + (style !== "calme" && bpm > 140 ? 1 : 0);
    const limit = sobre ? nCover + 2 : nCover ? nCover + extra : target;

    // 2) ambiance du genre : chaud d'abord si calme ou lent, froid / néon d'abord si rapide et énergique
    let amb = [...f.colors];
    const temp = style === "calme" || (bpm && bpm < 90) ? 1 : bpm > 135 && style === "energique" ? -1 : 0;
    if (temp) amb.sort((a, b) => (isHex(b) ? warmth(hueOf(b)) : 0.5) * temp - (isHex(a) ? warmth(hueOf(a)) : 0.5) * temp);
    if (style === "energique" || sobre) amb = amb.filter(c => isHex(c) || (!sobre && ["metal", "rock", "electro"].includes(f.id)));
    for (const c of amb) {
        if (out.length >= limit) break;
        add(c, "ambiance");
    }
    // 3) encore trop peu : la teinte la plus éloignée de celles déjà prises (palette bien répartie)
    while (out.length < limit) {
        const hs = out.filter(o => isHex(o.c)).map(o => hueOf(o.c));
        let bestH = 0, bestD = -1;
        for (let h = 0; h < 360; h += 15) {
            const d = hs.length ? Math.min(...hs.map(x => hueDist(x, h))) : 180;
            if (d > bestD) { bestD = d; bestH = h; }
        }
        if (bestD < 30 || !add(hslToHex(bestH, 1, 0.55), "ambiance")) break;
    }

    // calme : tout est adouci ; énergique : saturé
    if (style === "calme") out.forEach(o => { if (isHex(o.c)) o.c = soften(o.c, o.src === "ambiance" ? 1 : 0.5); });

    // couleur d'impact (énergique) : flash blanc pour rock / métal / électro (pas en sobre), sinon la couleur la plus contrastée
    let accent = null;
    if (style === "energique") accent = !sobre && ["metal", "rock", "electro"].includes(f.id) && energy > 0.6 ? "6500K" : contrasting();
    return { colors: out, accent, dim };
}
