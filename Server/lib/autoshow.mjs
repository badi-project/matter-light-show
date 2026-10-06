// Show automatique fabriqué à partir de la musique : couleurs (pochette + ambiance du genre) et style (calme / groove / énergique).

export const STYLE_LABEL = { calme: "calme", groove: "groove", energique: "énergique" };
const DEFAULT_PALETTE = ["#ff2d6f", "#00c8ff", "#ffb000", "#9b30ff"];

// shade : une couleur foncée (ex. « bleu foncé ») est jouée moins lumineuse
function all(name, color, brightness, duration, fade) {
    return { name, duration, fade, mode: "all", all: { on: true, color, brightness, shade: true } };
}
function pal(name, colors, brightness, shift, duration, fade) {
    return { name, duration, fade, mode: "palette", palette: { colors, brightness, shift, shade: true } };
}

/**
 * Fabrique un show (durées en temps) à partir d'une palette et d'un style.
 * accent : couleur des « impacts » (énergique) ; dim : facteur de luminosité (pochette sombre = ambiance tamisée).
 */
export function makeAutoShow({ palette, style, bpm, title, source, accent = null, dim = 1, name = null }) {
    let c = (palette ?? []).filter(Boolean).slice(0, 8);
    if (c.length === 0) c = DEFAULT_PALETTE;
    if (c.length === 1) c = [c[0], c[0]]; // une seule couleur : on la garde (le rythme passe par la luminosité)
    const n = c.length;
    const rev = [...c].reverse();
    const B = v => Math.max(5, Math.round(v * dim));
    const steps = [];
    if (style === "calme") {
        steps.push(all("Nappe", c[0], B(55), 8, 4));
        for (let s = 0; s < n; s++) steps.push(pal(`Vague douce ${s + 1}`, c, B(60), s, 8, 4));
        steps.push(all("Respiration", c[1], B(45), 8, 4));
        for (let s = 0; s < Math.min(n, 2); s++) steps.push(pal(`Retour ${s + 1}`, rev, B(55), s, 8, 4));
    } else if (style === "energique") {
        for (let round = 0; round < 2; round++) {
            for (let s = 0; s < n; s++) steps.push(pal(`Course ${round * n + s + 1}`, c, B(100), s, 2, 0.25));
            steps.push(all("Impact", accent ?? c[round % n], 100, 2, 0));
            for (let s = 0; s < n; s++) steps.push(pal(`Contre-temps ${s + 1}`, rev, B(90), s, 2, 0.25));
        }
    } else {
        for (let s = 0; s < n; s++) steps.push(pal(`Groove ${s + 1}`, c, B(85), s, 4, 1));
        steps.push(all("Couleur pleine", c[0], B(80), 4, 1));
        for (let s = 0; s < n; s++) steps.push(pal(`Groove inversé ${s + 1}`, rev, B(85), s, 4, 1));
        steps.push(all("Couleur pleine 2", c[Math.min(1, n - 1)], B(80), 4, 1));
    }
    return {
        id: "auto",
        name: name ?? `Auto · ${title || "musique"}`,
        auto: true,
        loop: true,
        speed: 1,
        tempo: { bpm: Math.round(bpm || 120) },
        style,
        paletteSource: source,
        steps,
    };
}
