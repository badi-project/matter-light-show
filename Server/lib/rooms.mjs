// Pièces de la maison : quelles lampes sont ensemble, dans quel ordre on passe de l'une à l'autre (vagues),
// et quelles enceintes AirPlay jouent dans chaque pièce.
// Source : pièces annoncées par le pont en Matter (étiquettes) si elles existent, sinon proposées d'après
// les noms des lampes, puis corrigées à la main dans l'onglet Lampes.
import { norm } from "./tempo.mjs";
import { nuance } from "./palette.mjs";
import { normalizeState, resolveStep } from "./show.mjs";

const slug = s => norm(s).replace(/ /g, "-").slice(0, 40) || "piece";

// mots-clés -> pièce proposée
const KEYWORDS = [
    [/\b(chevet|lit|chambre|bedroom|nuit|dressing)\b/, "Chambre"],
    [/\b(parent\w*)\b/, "Chambre parents"],
    [/\b(cine\w*|cinema|tv|tele\w*|television|canape|salon|sejour|living|lampadaire|home cinema)\b/, "Salon"],
    [/\b(cuisine|kitchen|plan de travail|ilot)\b/, "Cuisine"],
    [/\b(salle a manger|dining|table)\b/, "Salle à manger"],
    [/\b(bureau|office|desk)\b/, "Bureau"],
    [/\b(salle de bain\w*|sdb|bathroom|douche|miroir)\b/, "Salle de bain"],
    [/\b(entree|couloir|hall|escalier\w*|palier)\b/, "Entrée"],
    [/\b(jardin|terrasse|garden|bougainvill\w*|arbre\w*|palmier\w*|piscine|exterieur|facade|allee|portail|balcon|olivier\w*)\b/, "Jardin"],
];

/** Pièce proposée d'après le nom d'une lampe (ou null). */
export function guessRoomName(lampName) {
    const n = ` ${norm(lampName)} `;
    for (const [re, room] of KEYWORDS) if (re.test(n)) return room;
    // « Maison 1 », « Maison 2 »… : même préfixe = même groupe
    const prefix = String(lampName).trim().replace(/[\s_-]*[0-9a-f]*\d[0-9a-f]*\s*$/i, "").trim();
    // noms génériques (« WiZ 0A1F », « Lampe 2 »…) : pas une pièce
    if (/^(wiz|lampe|ampoule|light|bulb|spot|led|ruban|strip|hue|lamp|lumiere|lumière)$/i.test(prefix)) return null;
    return prefix && prefix !== String(lampName).trim() ? prefix : null;
}

/** Enceintes AirPlay qui jouent probablement dans une pièce (d'après leurs noms). */
export function guessSpeakers(roomName, speakerNames) {
    const r = norm(roomName);
    return speakerNames.filter(sp => {
        const s = norm(sp);
        if (!s || !r) return false;
        const rw = r.split(" "), sw = s.split(" ");
        if (rw.every(w => sw.includes(w)) || sw.every(w => rw.includes(w))) return true; // « Chambre » ~ « Chambre Paul »
        if (r === "salon" && /\b(soundbar|barre de son|tv|televiseur|apple tv)\b/.test(s)) return true;
        return false;
    });
}

export class Rooms {
    constructor(data, save) {
        this.data = { rooms: [], lampRoom: {}, ...(data ?? {}) };
        this.save = () => save(this.data);
    }

    list() {
        return this.data.rooms;
    }

    roomOf(lampId) {
        const id = this.data.lampRoom[lampId];
        return this.data.rooms.find(r => r.id === id) ?? null;
    }

    add(name, speakers = []) {
        name = String(name ?? "").trim().slice(0, 40);
        if (!name) throw new Error("Donne un nom à la pièce");
        let id = slug(name);
        while (this.data.rooms.some(r => r.id === id)) id += "-2";
        const room = { id, name, speakers: [...new Set(speakers)] };
        this.data.rooms.push(room);
        this.save();
        return room;
    }

    update(id, { name, speakers } = {}) {
        const r = this.data.rooms.find(x => x.id === id);
        if (!r) throw new Error("Pièce inconnue");
        if (name != null && String(name).trim()) r.name = String(name).trim().slice(0, 40);
        if (Array.isArray(speakers)) r.speakers = [...new Set(speakers.map(String))];
        this.save();
        return r;
    }

    remove(id) {
        this.data.rooms = this.data.rooms.filter(r => r.id !== id);
        for (const [lamp, room] of Object.entries(this.data.lampRoom)) if (room === id) delete this.data.lampRoom[lamp];
        this.save();
    }

    order(ids) {
        const pos = new Map(ids.map((id, i) => [id, i]));
        this.data.rooms.sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
        this.save();
    }

    assign(lampId, roomId) {
        if (roomId && !this.data.rooms.some(r => r.id === roomId)) throw new Error("Pièce inconnue");
        if (roomId) this.data.lampRoom[lampId] = roomId;
        else delete this.data.lampRoom[lampId];
        this.save();
    }

    /**
     * Remplit automatiquement les pièces des lampes qui n'en ont pas :
     * pièce annoncée en Matter si elle existe, sinon d'après le nom. Les enceintes sont reliées d'après les noms.
     * Renvoie { created, assigned, source }.
     */
    autoFill(lamps, speakerNames = []) {
        let created = 0, assigned = 0, fromMatter = 0;
        for (const l of lamps) {
            if (this.data.lampRoom[l.id]) continue;
            const name = l.matterRoom || guessRoomName(l.matterName || l.name) || guessRoomName(l.name);
            if (!name) continue;
            if (l.matterRoom) fromMatter++;
            let room = this.data.rooms.find(r => norm(r.name) === norm(name));
            if (!room) {
                room = this.add(name, guessSpeakers(name, speakerNames));
                created++;
            }
            this.data.lampRoom[l.id] = room.id;
            assigned++;
        }
        for (const r of this.data.rooms) if (!r.speakers?.length) r.speakers = guessSpeakers(r.name, speakerNames);
        this.save();
        return { created, assigned, source: fromMatter ? "matter" : "noms" };
    }

    /**
     * Plan des pièces pour la synchro.
     * lamps : lampes actives (dans l'ordre) ; activeSpeakers : enceintes AirPlay en cours de lecture ;
     * speakerLink : ne jouer que dans les pièces où la musique passe.
     * Renvoie { groups: [{ id, name, lamps }], inactive: [lampes], linked: bool, playing: [noms de pièces] }.
     */
    plan(lamps, { activeSpeakers = [], speakerLink = false } = {}) {
        const byRoom = new Map(this.data.rooms.map(r => [r.id, { id: r.id, name: r.name, speakers: r.speakers ?? [], lamps: [] }]));
        const loose = [];
        for (const l of lamps) {
            const g = byRoom.get(this.data.lampRoom[l.id]);
            if (g) g.lamps.push(l);
            else loose.push(l);
        }
        let groups = [...byRoom.values()].filter(g => g.lamps.length);
        if (loose.length) groups.push({ id: "_autres", name: "Sans pièce", speakers: [], lamps: loose });
        let inactive = [];
        let linked = false;
        if (speakerLink) {
            const on = new Set(activeSpeakers.map(norm));
            const playing = groups.filter(g => g.speakers.some(s => on.has(norm(s))));
            if (playing.length) {
                linked = true;
                inactive = groups.filter(g => !playing.includes(g)).flatMap(g => g.lamps);
                groups = playing;
            }
        }
        return { groups, inactive, linked, playing: groups.map(g => g.name) };
    }
}

/**
 * Couleurs d'une étape réparties PAR PIÈCE : chaque pièce prend une couleur dominante de l'étape
 * (pièce n°i = couleur n°i de la palette, décalée comme l'étape), et ses lampes des nuances proches.
 * Étape « toutes les lampes » : même couleur partout, nuancée dans chaque pièce. Étape « lampe par lampe » : inchangée.
 */
export function roomTargets(step, groups, strength = 1) {
    const mode = step?.mode ?? "all";
    if (mode === "custom") return resolveStep(step, groups.flatMap(g => g.lamps));
    let colors, brightness, shift = 0;
    if (mode === "palette") {
        colors = (step.palette?.colors ?? []).filter(Boolean);
        brightness = step.palette?.brightness;
        shift = Number(step.palette?.shift) || 0;
    } else {
        const a = step?.all ?? {};
        colors = [a.on === false ? "off" : a.color ?? "2700K"];
        brightness = a.brightness;
    }
    const out = {};
    if (!colors.length) return out;
    const n = colors.length;
    groups.forEach((g, i) => {
        const base = colors[(((i + shift) % n) + n) % n];
        g.lamps.forEach((l, j) => {
            out[l.id] = base === "off" ? { on: false } : normalizeState({ on: true, color: nuance(base, j, strength), brightness });
        });
    });
    return out;
}
