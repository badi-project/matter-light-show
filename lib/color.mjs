// Conversions de couleurs : #rrggbb / température (K) -> valeurs attendues par le cluster Matter ColorControl.

export function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return { r: 255, g: 255, b: 255 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Luminosité "intrinsèque" d'une couleur choisie (0..1) : une couleur sombre donne une lampe plus faible. */
export function colorValue(hex) {
    const { r, g, b } = hexToRgb(hex);
    return Math.max(r, g, b) / 255;
}

/** #rrggbb -> coordonnées CIE xy (gamut large, D65 — formule recommandée pour les lampes Hue). */
export function hexToXy(hex) {
    let { r, g, b } = hexToRgb(hex);
    [r, g, b] = [r, g, b].map(v => {
        v /= 255;
        return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
    });
    const X = r * 0.649926 + g * 0.103455 + b * 0.197109;
    const Y = r * 0.234327 + g * 0.743075 + b * 0.022598;
    const Z = r * 0.0 + g * 0.053077 + b * 1.035763;
    const sum = X + Y + Z;
    if (sum === 0) return { x: 0.3127, y: 0.329 }; // noir -> point blanc
    return { x: X / sum, y: Y / sum };
}

/** #rrggbb -> teinte/saturation au format Matter (0..254). */
export function hexToHueSat(hex) {
    const { r, g, b } = hexToRgb(hex);
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === R) h = ((G - B) / d) % 6;
        else if (max === G) h = (B - R) / d + 2;
        else h = (R - G) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return { hue: Math.round((h / 360) * 254), saturation: Math.round(s * 254) };
}

/** Température de couleur (Kelvin) -> xy (approximation du locus de Planck). */
export function kelvinToXy(kelvin) {
    const T = Math.min(25000, Math.max(1667, kelvin));
    let x;
    if (T <= 4000) x = -0.2661239e9 / T ** 3 - 0.2343589e6 / T ** 2 + 0.8776956e3 / T + 0.17991;
    else x = -3.0258469e9 / T ** 3 + 2.1070379e6 / T ** 2 + 0.2226347e3 / T + 0.24039;
    let y;
    if (T <= 2222) y = -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683;
    else if (T <= 4000) y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
    else y = 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
    return { x, y };
}

export function xyToMatter({ x, y }) {
    const clamp = v => Math.max(0, Math.min(0xfeff, Math.round(v * 65536)));
    return { colorX: clamp(x), colorY: clamp(y) };
}

export function kelvinToMireds(kelvin, min = 153, max = 500) {
    const m = Math.round(1e6 / Math.max(1000, kelvin));
    return Math.max(min, Math.min(max, m));
}

/** Pourcentage 0..100 -> niveau Matter 1..254 */
export function percentToLevel(pct) {
    return Math.max(1, Math.min(254, Math.round((Math.max(0, Math.min(100, pct)) / 100) * 254)));
}

/** Température -> couleur d'affichage approximative (pour l'aperçu). */
export function kelvinToHex(kelvin) {
    const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
    let r, g, b;
    if (t <= 66) {
        r = 255;
        g = 99.4708025861 * Math.log(t) - 161.1195681661;
        b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    } else {
        r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
        g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
        b = 255;
    }
    const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
}
