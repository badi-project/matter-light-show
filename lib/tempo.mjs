// Tempos (BPM) de morceaux connus + calage manuel (« taper le tempo »).
// Valeurs relevées sur songbpm.com / getsongbpm.com, ramenées entre 85 et 180 BPM
// (les sites donnent parfois le double ou la moitié). Elles sont approximatives :
// le bouton « Taper le tempo » permet de caler précisément n'importe quel morceau.

export const KNOWN_TEMPOS = [
    // Noël
    { title: "All I Want for Christmas Is You", artist: "Mariah Carey", bpm: 150 },
    { title: "Last Christmas", artist: "Wham", bpm: 108 },
    { title: "Jingle Bell Rock", artist: "Bobby Helms", bpm: 119 },
    { title: "Rockin' Around the Christmas Tree", artist: "Brenda Lee", bpm: 142 },
    { title: "Feliz Navidad", artist: "Feliciano", bpm: 152 },
    { title: "It's Beginning to Look a Lot Like Christmas", artist: "Michael Buble", bpm: 95 },
    { title: "Santa Tell Me", artist: "Ariana Grande", bpm: 96 },
    { title: "It's the Most Wonderful Time of the Year", artist: "Andy Williams", bpm: 101 },
    { title: "Wonderful Christmastime", artist: "Paul McCartney", bpm: 95 },
    { title: "Merry Christmas Everyone", artist: "Shakin' Stevens", bpm: 102 },
    { title: "Run Rudolph Run", artist: "Chuck Berry", bpm: 152 },
    { title: "Let It Snow", artist: "Dean Martin", bpm: 115 },
    { title: "Petit Papa Noel", artist: "Tino Rossi", bpm: 134 },
    { title: "Do They Know It's Christmas", artist: "Band Aid", bpm: 115 },
    { title: "A Holly Jolly Christmas", artist: "Burl Ives", bpm: 94 },
    { title: "Underneath the Tree", artist: "Kelly Clarkson", bpm: 160 },
    { title: "Sleigh Ride", artist: "Ronettes", bpm: 92 },
    { title: "Mistletoe", artist: "Justin Bieber", bpm: 162 },
    // Halloween
    { title: "Thriller", artist: "Michael Jackson", bpm: 118 },
    { title: "Ghostbusters", artist: "Ray Parker", bpm: 116 },
    { title: "Monster Mash", artist: "Pickett", bpm: 139 },
    { title: "Somebody's Watching Me", artist: "Rockwell", bpm: 124 },
    { title: "This Is Halloween", artist: "", bpm: 168 },
    { title: "Spooky Scary Skeletons", artist: "Andrew Gold", bpm: 154 },
    { title: "Werewolves of London", artist: "Warren Zevon", bpm: 104 },
    { title: "Halloween Theme", artist: "John Carpenter", bpm: 136 },
    { title: "Bloody Mary", artist: "Lady Gaga", bpm: 100 },
];

/** minuscules, sans accents, sans (Remastered…) ni « - 2003 Edit », sans ponctuation */
export function norm(s) {
    return String(s ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[([].*?[)\]]/g, " ")
        .replace(/\s-\s.*$/, " ")
        .replace(/[’']/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

export function normalizeBpm(bpm) {
    let b = Number(bpm) || 0;
    if (b <= 0) return 0;
    while (b > 180) b /= 2;
    while (b < 85) b *= 2;
    return Math.round(b * 10) / 10;
}

export function lookupKnown(track) {
    if (!track) return null;
    const t = norm(track.name);
    const a = norm(track.artist);
    for (const k of KNOWN_TEMPOS) {
        const kt = norm(k.title);
        if (!(t === kt || t.startsWith(kt + " "))) continue;
        if (k.artist && !a.includes(norm(k.artist))) continue;
        return k.bpm;
    }
    return null;
}

export const trackKey = track => (track ? `${norm(track.name)}|${norm(track.artist)}` : "");

/**
 * Calage à partir des instants tapés (positions dans le morceau, en secondes).
 * refBpm : tempo de référence connu (base intégrée ou app Musique), utilisé s'il est proche.
 * Retourne { bpm, phase } : phase = position d'un temps, ramenée dans [0, durée d'un temps[.
 */
export function fitTaps(positions, refBpm = 0) {
    const p = [...positions].sort((a, b) => a - b);
    if (p.length < 4) throw new Error("Tape au moins 4 temps");
    const diffs = p.slice(1).map((v, i) => v - p[i]);
    const med = [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
    if (!(med > 0.25 && med < 2)) throw new Error("Rythme de tapes irrégulier, recommence");
    // tempo tapé : régression linéaire position = a + b·k (k = numéro du temps)
    const ks = p.map(v => Math.round((v - p[0]) / med));
    const n = p.length;
    const mk = ks.reduce((s, v) => s + v, 0) / n;
    const mp = p.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (ks[i] - mk) * (p[i] - mp);
        den += (ks[i] - mk) ** 2;
    }
    let bpm = normalizeBpm(60 / (den ? num / den : med));
    // quelques tapes ne donnent le tempo qu'à ~1 % près : on préfère une référence proche, sinon un entier
    const ref = normalizeBpm(refBpm);
    bpm = ref && Math.abs(ref - bpm) / ref < 0.05 ? ref : Math.round(bpm);
    const period = 60 / bpm;
    // phase : moyenne circulaire des tapes sur la grille de ce tempo
    let sx = 0, sy = 0;
    for (const v of p) {
        const a = (2 * Math.PI * (((v % period) + period) % period)) / period;
        sx += Math.cos(a);
        sy += Math.sin(a);
    }
    const ang = (Math.atan2(sy, sx) + 2 * Math.PI) % (2 * Math.PI);
    const phase = (ang / (2 * Math.PI)) * period;
    return { bpm, phase: Math.round(phase * 1000) / 1000 };
}
