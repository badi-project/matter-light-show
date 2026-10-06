// Lien avec l'app Musique (Apple Music) du Mac, via AppleScript (osascript).
// Lit le morceau en cours et sa position, pilote la lecture et les sorties AirPlay (HomePod…).
import { asString, automationHost, num, ON_MAC, osascript } from "./macos.mjs";
import { pct } from "./util.mjs";

// NB : en AppleScript, « st », « nd », « rd », « th » sont des mots réservés (1st, 2nd…) :
// toutes les variables sont donc préfixées par « v ».
const STATUS = `
if application "Music" is not running then return "notrunning"
tell application "Music"
  set vState to player state as text
  if vState is "stopped" then return "stopped"
  set vTrack to current track
  set vName to ""
  set vArtist to ""
  set vAlbum to ""
  set vDur to 0
  set vBpm to 0
  set vGenre to ""
  set vList to ""
  set vId to ""
  try
    set vName to name of vTrack
  end try
  try
    set vArtist to artist of vTrack
  end try
  try
    set vAlbum to album of vTrack
  end try
  try
    set vDur to duration of vTrack
  end try
  try
    set vBpm to bpm of vTrack
  end try
  try
    set vGenre to genre of vTrack
  end try
  try
    set vList to name of current playlist
  end try
  try
    set vId to persistent ID of vTrack
  end try
  return vState & tab & (player position as text) & tab & vName & tab & vArtist & tab & vAlbum & tab & (vDur as text) & tab & (vBpm as text) & tab & vGenre & tab & vList & tab & vId
end tell`;

const AIRPLAY_LIST = `
if application "Music" is not running then return ""
tell application "Music"
  set vOut to ""
  repeat with vDev in AirPlay devices
    set vVol to -1
    try
      set vVol to sound volume of vDev
    end try
    set vOut to vOut & (name of vDev) & tab & ((selected of vDev) as text) & tab & ((available of vDev) as text) & tab & ((kind of vDev) as text) & tab & (vVol as text) & linefeed
  end repeat
  return vOut
end tell`;

const PLAYLISTS = `
tell application "Music"
  set vOut to ""
  repeat with vPl in user playlists
    try
      if (count of tracks of vPl) > 0 then set vOut to vOut & (name of vPl) & linefeed
    end try
  end repeat
  return vOut
end tell`;

export class AppleMusic {
    id = "apple";
    name = "Apple Music";
    app = "Music"; // nom du processus
    caps = { control: true, playlists: true, airplay: true, volume: true };
    available = ON_MAC;
    state = { running: false, playing: false, status: "inconnu", position: 0, at: Date.now(), track: null, playlist: "" };
    error = null;
    #busy = false;

    async poll() {
        if (this.#busy) return;
        this.#busy = true;
        const t0 = Date.now();
        try {
            const out = await osascript(STATUS);
            const at = (t0 + Date.now()) / 2;
            this.error = null;
            if (out === "notrunning" || out === "stopped") {
                this.state = { running: out !== "notrunning", playing: false, status: out === "stopped" ? "arrêtée" : "Musique fermée", position: 0, at, track: null, playlist: "" };
            } else {
                const [st, pos, name, artist, album, dur, bpm, genre, playlist, pid] = out.split("\t");
                const track = { id: pid || `${name}|${artist}`, name, artist, album, duration: num(dur), bpm: Math.round(num(bpm)), genre };
                this.state = { running: true, playing: st === "playing", status: st === "playing" ? "lecture" : "pause", position: num(pos), at, track, playlist: playlist || "" };
            }
        } catch (e) {
            const who = automationHost();
            this.error = e.notAllowed
                ? `Le Mac n'autorise pas encore ce logiciel à piloter l'app Musique : Réglages Système › Confidentialité et sécurité › Automatisation › ${who} › coche « Musique ».`
                : e.waiting
                  ? `Le Mac attend ton accord : clique sur OK dans la fenêtre « ${who} souhaite contrôler Musique » (si elle n'apparaît pas : Réglages Système › Confidentialité et sécurité › Automatisation › ${who} › coche « Musique »).`
                  : `Lecture de l'état de Musique impossible : ${e.message.slice(0, 160)}`;
            this.state = { ...this.state, playing: false, status: "erreur" };
        } finally {
            this.#busy = false;
        }
        return this.state;
    }

    // ---------- commandes ----------
    async command(action, arg) {
        if (!this.available) throw new Error("L'app Musique n'est disponible que sur Mac");
        const scripts = {
            playpause: `tell application "Music" to playpause`,
            next: `tell application "Music" to next track`,
            previous: `tell application "Music" to previous track`,
            pause: `tell application "Music" to pause`,
            play: `tell application "Music" to play`,
            playlist: `tell application "Music"\ntry\nset shuffle enabled to false\nend try\nplay playlist ${asString(arg)}\nend tell`,
        };
        if (!scripts[action]) throw new Error("Commande inconnue");
        await osascript(scripts[action]);
    }

    async playlists() {
        if (!this.available) return [];
        return (await osascript(PLAYLISTS, 8000)).split("\n").filter(Boolean);
    }

    async airplay() {
        if (!this.available) return [];
        const out = await osascript(AIRPLAY_LIST, 6000);
        return out
            .split("\n")
            .filter(Boolean)
            .map(line => {
                const [name, selected, available, kind, vol] = line.split("\t");
                const volume = Math.round(num(vol));
                return { name, selected: selected === "true", available: available !== "false", kind, volume: num(vol) >= 0 && vol !== undefined ? volume : null };
            });
    }

    /** Volume d'une enceinte AirPlay (0–100). */
    async setDeviceVolume(name, volume) {
        if (!this.available) throw new Error("L'app Musique n'est disponible que sur Mac");
        const v = pct(volume);
        await osascript(`tell application "Music"
repeat with vDev in AirPlay devices
if (name of vDev) is ${asString(name)} then set sound volume of vDev to ${v}
end repeat
end tell`, 6000);
    }

    /** Volume général de l'app Musique (0–100). */
    async getVolume() {
        if (!this.available) return null;
        return Math.round(num(await osascript(`tell application "Music" to get sound volume`, 4000)));
    }
    async setVolume(volume) {
        if (!this.available) throw new Error("L'app Musique n'est disponible que sur Mac");
        await osascript(`tell application "Music" to set sound volume to ${pct(volume)}`, 4000);
    }

    async setAirplay(names) {
        if (!this.available) throw new Error("L'app Musique n'est disponible que sur Mac");
        if (!names?.length) throw new Error("Choisis au moins une sortie");
        const list = `{${names.map(asString).join(", ")}}`;
        await osascript(`tell application "Music"
set vWanted to {}
repeat with vDev in AirPlay devices
if (name of vDev) is in ${list} then set end of vWanted to (contents of vDev)
end repeat
if vWanted is not {} then set current AirPlay devices to vWanted
end tell`, 8000);
    }
}

// -------------------------------------------------------------------------------------------
// Simulateur (tests hors Mac) : MUSIC_SIM=1 npm start
// -------------------------------------------------------------------------------------------
export class SimulatedMusic extends AppleMusic {
    available = true;
    #tracks = [
        { id: "sim0", name: "Test Groove", artist: "Testeur", album: "Essais", duration: 600, bpm: 0, genre: "Alternative", playlist: "" },
        { id: "sim1", name: "All I Want for Christmas Is You", artist: "Mariah Carey", album: "Merry Christmas", duration: 241, bpm: 0, genre: "Fêtes", playlist: "Noël" },
        { id: "sim2", name: "Thriller", artist: "Michael Jackson", album: "Thriller", duration: 357, bpm: 0, genre: "Pop", playlist: "Halloween" },
    ];
    #i = 0;
    #playing = true;
    #pos = 0;
    #at = Date.now();
    #devices = [
        { name: "Ordinateur", selected: true, available: true, kind: "computer", volume: 60 },
        { name: "HomePod Salon", selected: true, available: true, kind: "HomePod", volume: 35 },
        { name: "Chambre", selected: false, available: true, kind: "AirPlay", volume: 50 },
    ];
    #volume = 80;

    async poll() {
        const now = Date.now();
        if (this.#playing) this.#pos += (now - this.#at) / 1000;
        this.#at = now;
        const tr = this.#tracks[this.#i];
        if (this.#pos > tr.duration) {
            this.#i = (this.#i + 1) % this.#tracks.length;
            this.#pos = 0;
        }
        const t = this.#tracks[this.#i];
        const { playlist, ...track } = t;
        this.state = { running: true, playing: this.#playing, status: this.#playing ? "lecture" : "pause", position: this.#pos, at: now, track, playlist };
        return this.state;
    }
    async command(action, arg) {
        if (action === "playpause") this.#playing = !this.#playing;
        if (action === "next") (this.#i = (this.#i + 1) % this.#tracks.length), (this.#pos = 0);
        if (action === "previous") this.#pos = 0;
        if (action === "playlist") (this.#i = Math.max(0, this.#tracks.findIndex(t => t.playlist === arg))), (this.#pos = 0), (this.#playing = true);
        await this.poll();
    }
    async playlists() {
        return ["Noël", "Halloween"];
    }
    async airplay() {
        return this.#devices;
    }
    async setAirplay(names) {
        this.#devices.forEach(d => (d.selected = names.includes(d.name)));
    }
    async setDeviceVolume(name, volume) {
        const d = this.#devices.find(x => x.name === name);
        if (!d) throw new Error("Enceinte inconnue");
        d.volume = volume;
    }
    async getVolume() {
        return this.#volume;
    }
    async setVolume(volume) {
        this.#volume = volume;
    }
}
