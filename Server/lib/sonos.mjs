// Enceintes Sonos du réseau local (UPnP, sans compte) : on les trouve toutes seules, on règle leur volume,
// et on lit ce qu'elles jouent (titre, artiste, position) pour que les lumières suivent la musique jouée sur Sonos
// (app Sonos, Spotify Connect, radio, AirPlay vers Sonos…).
import dgram from "node:dgram";
import { pct } from "./util.mjs";

const SSDP = { host: "239.255.255.250", port: 1900 };
const PATHS = {
    AVTransport: "/MediaRenderer/AVTransport/Control",
    RenderingControl: "/MediaRenderer/RenderingControl/Control",
    ZoneGroupTopology: "/ZoneGroupTopology/Control",
};
const EMPTY = { running: false, playing: false, status: "inconnu", position: 0, at: Date.now(), track: null, playlist: "" };

const unescapeXml = s =>
    String(s ?? "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&amp;/g, "&");
const tag = (xml, name) => {
    const m = String(xml ?? "").match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`));
    return m ? m[1] : null;
};
const hms = s => {
    const p = String(s ?? "").split(":").map(Number);
    return p.length === 3 && p.every(Number.isFinite) ? p[0] * 3600 + p[1] * 60 + p[2] : 0;
};

async function soap(host, service, action, args = "") {
    const urn = `urn:schemas-upnp-org:service:${service}:1`;
    const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${urn}">${args}</u:${action}></s:Body></s:Envelope>`;
    const r = await fetch(`http://${host}${PATHS[service]}`, {
        method: "POST",
        headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPACTION: `"${urn}#${action}"` },
        body,
        signal: AbortSignal.timeout(4000),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Sonos ${action} : HTTP ${r.status}`);
    return text;
}

/** Recherche des enceintes Sonos (SSDP) : renvoie les adresses « ip:1400 ». */
function discover(timeout = 2500) {
    return new Promise(resolve => {
        const found = new Set();
        let sock;
        try {
            sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
        } catch {
            return resolve([]);
        }
        const msg = Buffer.from(
            ["M-SEARCH * HTTP/1.1", `HOST: ${SSDP.host}:${SSDP.port}`, 'MAN: "ssdp:discover"', "MX: 1", "ST: urn:schemas-upnp-org:device:ZonePlayer:1", "", ""].join("\r\n"),
        );
        sock.on("message", buf => {
            const loc = buf.toString().match(/^location:\s*http:\/\/([^/\s]+)\//im)?.[1];
            if (loc && /sonos|rincon|zoneplayer/i.test(buf.toString())) found.add(loc);
        });
        sock.on("error", () => {});
        sock.bind(0, () => {
            try {
                sock.send(msg, SSDP.port, SSDP.host);
                setTimeout(() => sock.send(msg, SSDP.port, SSDP.host), 400);
            } catch {}
        });
        setTimeout(() => {
            try {
                sock.close();
            } catch {}
            resolve([...found]);
        }, timeout);
    });
}

export class Sonos {
    id = "sonos";
    name = "Sonos";
    app = null;
    caps = { control: true, playlists: false, airplay: false, volume: false };
    state = { ...EMPTY };
    error = null;
    players = []; // [{ uuid, host, room, model, coordinator, volume, transport }]
    #lastDiscovery = 0;

    rooms = []; // pièces du groupe suivi
    resolution = 1; // position donnée à la seconde près

    constructor({ hosts = [] } = {}) {
        this.fixedHosts = hosts; // adresses données à la main (ou tests)
    }

    get available() {
        return this.players.length > 0;
    }

    /** Trouve les enceintes et leurs groupes (toutes les 5 min, ou à la demande). */
    async refresh(force = false) {
        // aucune enceinte trouvée : on recherche moins souvent (toutes les 30 min, et à chaque changement de réseau)
        if (!force && Date.now() - this.#lastDiscovery < (this.players.length ? 300000 : 1800000)) return this.players;
        this.#lastDiscovery = Date.now();
        const hosts = new Set([...this.fixedHosts, ...(this.fixedHosts.length ? [] : await discover())]);
        if (!hosts.size) {
            this.players = [];
            return this.players;
        }
        // la topologie (pièces, groupes, coordinateurs) est connue de chaque enceinte : on la demande à la 1ʳᵉ qui répond
        for (const h of hosts) {
            try {
                const xml = unescapeXml(tag(await soap(h, "ZoneGroupTopology", "GetZoneGroupState"), "ZoneGroupState"));
                const players = [];
                for (const g of xml.matchAll(/<ZoneGroup\s[^>]*Coordinator="([^"]+)"[^>]*>([\s\S]*?)<\/ZoneGroup>/g)) {
                    for (const m of g[2].matchAll(/<ZoneGroupMember\s([^>]*?)\/?>/g)) {
                        const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(x => [x[1], unescapeXml(x[2])]));
                        if (a.Invisible === "1") continue; // caissons, enceintes surround
                        const host = a.Location?.match(/^http:\/\/([^/]+)\//)?.[1];
                        if (!host) continue;
                        players.push({ uuid: a.UUID, host, room: a.ZoneName, coordinator: g[1], isCoordinator: a.UUID === g[1] });
                    }
                }
                if (players.length) {
                    this.players = players;
                    this.error = null;
                    return players;
                }
            } catch (e) {
                this.error = `Sonos : ${e.message}`;
            }
        }
        return this.players;
    }

    /** Volume de chaque enceinte (et état de lecture des groupes) pour la liste des sorties. */
    async outputs() {
        await this.refresh();
        await Promise.all(
            this.players.map(async p => {
                try {
                    p.volume = Number(tag(await soap(p.host, "RenderingControl", "GetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>"), "CurrentVolume"));
                } catch {
                    p.volume = null;
                }
            }),
        );
        return this.players.map(p => ({ id: p.uuid, name: p.room, volume: p.volume, group: this.players.filter(x => x.coordinator === p.coordinator).map(x => x.room), playing: !!this.#groupState.get(p.coordinator)?.playing }));
    }

    async setVolume(uuid, v) {
        const p = this.players.find(x => x.uuid === uuid);
        if (!p) throw new Error("Enceinte Sonos introuvable");
        await soap(p.host, "RenderingControl", "SetVolume", `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${pct(v)}</DesiredVolume>`);
    }

    #groupState = new Map(); // coordinateur -> { playing }
    #activeCoordinator = null;

    /** Source de musique : le premier groupe Sonos qui joue (titre, artiste, position). */
    async poll() {
        await this.refresh();
        const coords = [...new Set(this.players.map(p => p.coordinator))];
        if (!coords.length) {
            this.state = { ...EMPTY, status: "aucune enceinte Sonos" };
            return this.state;
        }
        let best = null;
        for (const c of coords) {
            const p = this.players.find(x => x.uuid === c) ?? this.players.find(x => x.coordinator === c);
            try {
                const t0 = Date.now();
                const ti = await soap(p.host, "AVTransport", "GetTransportInfo", "<InstanceID>0</InstanceID>");
                const st = tag(ti, "CurrentTransportState");
                const playing = st === "PLAYING" || st === "TRANSITIONING";
                this.#groupState.set(c, { playing });
                if (!playing && best) continue;
                const pi = await soap(p.host, "AVTransport", "GetPositionInfo", "<InstanceID>0</InstanceID>");
                const at = (t0 + Date.now()) / 2;
                const meta = unescapeXml(tag(pi, "TrackMetaData"));
                const stream = unescapeXml(tag(meta, "streamContent") ?? ""); // radio : « Artiste - Titre »
                let title = unescapeXml(tag(meta, "title") ?? ""), artist = unescapeXml(tag(meta, "creator") ?? tag(meta, "albumArtist") ?? "");
                if (stream && / - /.test(stream)) [artist, title] = stream.split(" - ", 2);
                const art = unescapeXml(tag(meta, "albumArtURI") ?? "");
                const cand = {
                    coordinator: c,
                    rooms: this.players.filter(x => x.coordinator === c).map(x => x.room),
                    state: {
                        running: true,
                        playing,
                        status: playing ? "lecture" : st === "STOPPED" ? "arrêtée" : "pause",
                        position: hms(tag(pi, "RelTime")),
                        at,
                        approx: !tag(pi, "RelTime") || tag(pi, "RelTime") === "NOT_IMPLEMENTED",
                        track: title ? { id: `sonos:${title}|${artist}`, name: title, artist, album: unescapeXml(tag(meta, "album") ?? ""), duration: hms(tag(pi, "TrackDuration")), bpm: 0, genre: "", artworkUrl: art ? (art.startsWith("http") ? art : `http://${p.host}${art}`) : undefined } : null,
                        playlist: "",
                    },
                };
                if (!best || (playing && !best.state.playing)) best = cand;
            } catch (e) {
                this.error = `Sonos (${p.room}) : ${e.message}`;
            }
        }
        if (!best) return this.state;
        this.#activeCoordinator = best.coordinator;
        this.rooms = best.rooms;
        this.state = { ...best.state, app: `Sonos · ${best.rooms.join(" + ")}` };
        return this.state;
    }

    async command(action) {
        const c = this.#activeCoordinator;
        const p = this.players.find(x => x.uuid === c);
        if (!p) throw new Error("Aucun groupe Sonos actif");
        const map = { playpause: this.state.playing ? "Pause" : "Play", pause: "Pause", play: "Play", next: "Next", previous: "Previous" };
        if (!map[action]) throw new Error("Commande indisponible pour Sonos");
        await soap(p.host, "AVTransport", map[action], `<InstanceID>0</InstanceID>${map[action] === "Play" ? "<Speed>1</Speed>" : ""}`);
    }
}
