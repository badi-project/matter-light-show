// Outils de couleurs pour les lampes : HSV, rangement esthétique d'une palette, nuances autour d'une couleur.
// Sur une ampoule : la teinte et la saturation (S) donnent la couleur, la valeur (V) donne la luminosité
// (le répartiteur baisse déjà la luminosité d'une couleur foncée).

export const isHex = c => /^#[0-9a-f]{6}$/i.test(String(c));
export const isKelvin = c => /^\d{4,5}K$/i.test(String(c));
export const hueDist = (a, b) => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d);
};

export function hexToHsv(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function hsvToHex(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(1, s));
    v = Math.max(0, Math.min(1, v));
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return "#" + [r, g, b].map(t => Math.round((t + m) * 255).toString(16).padStart(2, "0")).join("");
}

/** Couleur « neutre » pour le rangement : blancs (K) et couleurs très peu saturées. */
const neutral = c => !isHex(c) || hexToHsv(c).s < 0.12;

/**
 * Range des couleurs choisies pour qu'elles s'enchaînent joliment d'une lampe à l'autre (et d'une pièce à l'autre).
 *  - « degrade » : tour du cercle chromatique en partant du plus grand trou de teinte (rouge → rouge pâle → orange…),
 *    une couleur vive avant sa version pâle, les blancs placés là où le dégradé saute le plus ;
 *  - « contraste » : même tour, mais en alternant les deux moitiés du cercle (voisines contrastées, plus dynamique).
 */
export function arrangeColors(colors, mode = "degrade") {
    const list = [...new Set((colors ?? []).filter(c => isHex(c) || isKelvin(c)).map(c => (isHex(c) ? c.toLowerCase() : c.toUpperCase())))];
    if (list.length <= 2) return list;
    const chroma = list.filter(c => !neutral(c)).map(c => ({ c, ...hexToHsv(c) }));
    const neutrals = list.filter(neutral);
    chroma.sort((a, b) => a.h - b.h || b.s - a.s || b.v - a.v);
    // départ juste après le plus grand trou de teinte : le dégradé ne fait pas de saut au milieu
    let start = 0, gap = -1;
    chroma.forEach((x, i) => {
        const last = i === chroma.length - 1;
        const g = last ? chroma[0].h + 360 - x.h : chroma[i + 1].h - x.h;
        if (g > gap) { gap = g; start = (i + 1) % chroma.length; }
    });
    let seq = chroma.slice(start).concat(chroma.slice(0, start)).map(x => x.c);
    if (mode === "contraste" && seq.length >= 4) {
        const half = Math.ceil(seq.length / 2), a = seq.slice(0, half), b = seq.slice(half), out = [];
        for (let i = 0; i < half; i++) { out.push(a[i]); if (b[i]) out.push(b[i]); }
        seq = out;
    }
    // blancs : insérés là où deux voisines sont les plus éloignées (ils adoucissent la transition)
    for (const w of neutrals) {
        if (seq.length < 2) { seq.push(w); continue; }
        let best = seq.length, bd = -1;
        for (let i = 0; i < seq.length; i++) {
            const a = seq[i], b = seq[(i + 1) % seq.length];
            if (neutral(a) || neutral(b)) continue;
            const d = hueDist(hexToHsv(a).h, hexToHsv(b).h);
            if (d > bd) { bd = d; best = i + 1; }
        }
        seq.splice(best, 0, w);
    }
    return seq;
}

/**
 * Nuance n°i autour d'une couleur (lampes d'une même pièce) : la 1ʳᵉ lampe a la couleur exacte,
 * les suivantes une teinte voisine, une version plus claire ou un peu plus profonde — proches, mais pas identiques.
 */
export function nuance(color, i, strength = 1) {
    if (!i || !isHex(color)) return color;
    const { h, s, v } = hexToHsv(color);
    if (s < 0.12) return color; // blanc / gris : pas de nuance de teinte
    const k = strength;
    const steps = [
        [10 * k, 0, 0],
        [-10 * k, 0, 0],
        [0, -0.3 * k, 0],
        [18 * k, -0.12 * k, 0],
        [0, 0, -0.25 * k],
        [-18 * k, -0.12 * k, 0],
    ];
    const [dh, ds, dv] = steps[(i - 1) % steps.length];
    return hsvToHex(h + dh, Math.max(0.15, s + ds), Math.max(0.35, v + dv));
}
