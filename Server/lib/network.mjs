// Réseaux (Wi-Fi ou câble) : quel réseau le Mac utilise en ce moment, et quels appareils sont sur quel réseau.
// Un réseau est reconnu par sa box (adresse matérielle du routeur), pas seulement par le nom du Wi-Fi :
// deux Wi-Fi de la même box (2,4 GHz / 5 GHz, répéteur) = le même réseau, où les mêmes appareils sont joignables.
// Le nom du Wi-Fi est lu quand macOS le permet (sinon on te demande de nommer le réseau).
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { runText as run } from "./macos.mjs";

const normMac = m =>
    m && /^[0-9a-f]{1,2}(:[0-9a-f]{1,2}){5}$/i.test(m) && !/^0{1,2}(:0{1,2}){5}$/.test(m)
        ? m
              .split(":")
              .map(x => x.padStart(2, "0"))
              .join(":")
              .toLowerCase()
        : null;

function ipv4Of(iface) {
    return (networkInterfaces()[iface] ?? []).find(a => (a.family === "IPv4" || a.family === 4) && !a.internal) ?? null;
}
function subnetOf(address, netmask) {
    const a = address.split(".").map(Number), m = netmask.split(".").map(Number);
    const bits = m.reduce((s, x) => s + x.toString(2).replace(/0/g, "").length, 0);
    return `${a.map((x, i) => x & m[i]).join(".")}/${bits}`;
}

/** Empreinte des adresses du Mac (change quand il rejoint ou quitte un réseau). */
function addressSignature() {
    const parts = [];
    for (const [name, list] of Object.entries(networkInterfaces())) {
        for (const a of list ?? []) if (!a.internal && (a.family === "IPv4" || a.family === 4)) parts.push(`${name}=${a.address}/${a.netmask}`);
    }
    // tests : réseau simulé dans un fichier
    if (process.env.SHOW_NETWORK_FILE) {
        try {
            parts.push(readFileSync(process.env.SHOW_NETWORK_FILE, "utf8"));
        } catch {}
    }
    return parts.sort().join("|");
}

/** Identifiant stable d'un réseau : la box (adresse matérielle), sinon la plage d'adresses + la passerelle. */
export const networkId = info => (info?.mac ? `box-${info.mac.replace(/:/g, "")}` : info?.subnet ? `res-${info.subnet}-${info.gateway}` : null);

/** Surveille le réseau du Mac (toutes les 8 s) et prévient quand il change (après 2 lectures identiques). */
export class NetworkWatcher extends EventEmitter {
    current = null; // { id, iface, gateway, mac, address, subnet, ssid, online }
    #candidate = null;
    #ssid = { iface: null, value: null, at: 0 };
    #timer = null;

    async #ssidOf(iface, force) {
        if (process.platform !== "darwin" || !/^en\d+$/.test(iface ?? "")) return null;
        if (!force && this.#ssid.iface === iface && Date.now() - this.#ssid.at < 10 * 60000) return this.#ssid.value;
        let ssid = (await run("ipconfig", ["getsummary", iface])).match(/^\s*SSID\s*:\s*(.+?)\s*$/m)?.[1] ?? null;
        if (!ssid || /redacted|<.*>/i.test(ssid)) ssid = (await run("networksetup", ["-getairportnetwork", iface])).match(/Current Wi-?Fi Network:\s*(.+?)\s*$/m)?.[1] ?? null;
        if (ssid && /redacted|<.*>/i.test(ssid)) ssid = null; // macOS cache le nom à ce logiciel
        this.#ssid = { iface, value: ssid, at: Date.now() };
        return ssid;
    }

    /** Lecture du réseau actuel (null si le Mac n'est sur aucun réseau). */
    async detect(forceSsid = false) {
        if (process.env.SHOW_NETWORK_FILE) {
            // tests : réseau simulé
            try {
                const sim = JSON.parse(readFileSync(process.env.SHOW_NETWORK_FILE, "utf8"));
                return sim?.gateway ? { online: true, ...sim, id: sim.id ?? networkId(sim) } : null;
            } catch {
                return null;
            }
        }
        let iface = null, gateway = null, mac = null;
        if (process.platform === "darwin") {
            const r = await run("route", ["-n", "get", "default"]);
            gateway = r.match(/gateway:\s*(\S+)/)?.[1] ?? null;
            iface = r.match(/interface:\s*(\S+)/)?.[1] ?? null;
            if (!iface || !/^(en|bridge)\d+$/.test(iface)) {
                // VPN actif : on regarde l'interface physique (Wi-Fi ou câble)
                iface = (await run("scutil", ["--nwi"])).match(/\b(en\d+)\b/)?.[1] ?? "en0";
                gateway = (await run("ipconfig", ["getoption", iface, "router"])).trim() || null;
            }
            if (gateway) mac = normMac((await run("arp", ["-n", gateway])).match(/ at ([0-9a-f:]+)/i)?.[1]);
        } else {
            // Linux : tables du noyau (pas besoin de la commande « ip »)
            try {
                for (const line of readFileSync("/proc/net/route", "utf8").split("\n").slice(1)) {
                    const [dev, dest, gw] = line.trim().split(/\s+/);
                    if (dest === "00000000" && gw && gw !== "00000000") {
                        iface = dev;
                        gateway = gw.match(/../g).reverse().map(h => parseInt(h, 16)).join(".");
                        break;
                    }
                }
                const arp = readFileSync("/proc/net/arp", "utf8").split("\n").find(l => l.startsWith(`${gateway} `));
                mac = normMac(arp?.trim().split(/\s+/)[3]);
            } catch {}
        }
        if (!gateway || !iface) return null;
        const v4 = ipv4Of(iface);
        const info = {
            online: true,
            iface,
            gateway,
            mac,
            address: v4?.address ?? null,
            subnet: v4 ? subnetOf(v4.address, v4.netmask) : null,
        };
        info.id = networkId(info);
        info.ssid = await this.#ssidOf(iface, forceSsid || info.id !== this.current?.id);
        return info.id ? info : null;
    }

    async refresh() {
        const info = await this.detect();
        if (!info) {
            if (this.current?.online) {
                this.current = { ...this.current, online: false };
                this.emit("offline", this.current);
            }
            return this.current;
        }
        if (!this.current) {
            this.current = info;
            this.emit("change", info, null);
            return info;
        }
        if (info.id === this.current.id) {
            this.#candidate = null;
            const wasOffline = !this.current.online;
            this.current = info;
            if (wasOffline) this.emit("online", info);
            return info;
        }
        // nouveau réseau : on attend une 2ᵉ lecture identique (évite les faux changements pendant une reconnexion)
        if (this.#candidate?.id !== info.id) {
            this.#candidate = info;
            clearTimeout(this.#timer);
            this.#timer = setTimeout(() => this.refresh(), 2500);
            return this.current;
        }
        const prev = this.current;
        this.#candidate = null;
        this.current = info;
        this.emit("change", info, prev);
        return info;
    }

    /**
     * Toutes les 8 s, un simple coup d'œil aux adresses du Mac (sans lancer aucune commande) ; la lecture complète
     * (passerelle, box, nom du Wi-Fi) seulement si elles ont changé, après une sortie de veille, ou toutes les 2 min.
     */
    start(every = 8000) {
        let lastSig = null, lastFull = 0, lastLoop = Date.now();
        const loop = async () => {
            const now = Date.now();
            const sig = addressSignature();
            const slept = now - lastLoop > every + 15000; // la minuterie a pris beaucoup de retard : le Mac dormait
            lastLoop = now;
            if (sig !== lastSig || slept || now - lastFull > 120000 || this.#candidate) {
                lastSig = sig;
                lastFull = now;
                try {
                    await this.refresh();
                } catch {}
            }
            this.#loop = setTimeout(loop, every);
            this.#loop.unref?.();
        };
        loop();
    }
    #loop = null;

    stop() {
        clearTimeout(this.#loop);
        clearTimeout(this.#timer);
    }
}

/**
 * Réseaux connus et appareils rattachés. Fichier : { networks: { id: { id, name, ssids, gateway, subnet, firstSeen, lastSeen } },
 * devices: { "matter:1": id | "*", "integ:wiz": id | "*" } } ; « * » = tous les réseaux.
 */
export class NetworkRegistry {
    constructor(data, save) {
        this.data = { networks: {}, devices: {}, ...(data ?? {}) };
        this.save = () => save(this.data);
    }

    list() {
        return Object.values(this.data.networks).sort((a, b) => a.firstSeen - b.firstSeen);
    }
    get(id) {
        return this.data.networks[id] ?? null;
    }

    /** Le Mac est sur ce réseau : on l'ajoute ou on le met à jour. */
    seen(info) {
        let n = this.data.networks[info.id];
        if (!n) {
            const count = Object.keys(this.data.networks).length + 1;
            n = this.data.networks[info.id] = { id: info.id, name: info.ssid || `Réseau ${count}`, named: !!info.ssid, ssids: [], firstSeen: Date.now() };
        }
        n.gateway = info.gateway;
        n.subnet = info.subnet;
        n.lastSeen = Date.now();
        if (info.ssid && !n.ssids.includes(info.ssid)) n.ssids.push(info.ssid);
        if (info.ssid && !n.named && /^Réseau \d+$/.test(n.name)) n.name = info.ssid;
        this.save();
        return n;
    }

    rename(id, name) {
        const n = this.data.networks[id];
        if (!n) throw new Error("Réseau inconnu");
        n.name = String(name ?? "").trim().slice(0, 40) || n.name;
        n.named = true;
        this.save();
        return n;
    }

    /** Oublie un réseau : ses appareils passent sur « tous les réseaux ». */
    forget(id) {
        delete this.data.networks[id];
        for (const [k, v] of Object.entries(this.data.devices)) if (v === id) this.data.devices[k] = "*";
        this.save();
    }

    /** Le réseau « from » est en fait le même que « into » (nouvelle box…) : ses appareils passent sur « into ». */
    merge(from, into) {
        if (from === into) return 0;
        let moved = 0;
        for (const [k, v] of Object.entries(this.data.devices))
            if (v === from) {
                this.data.devices[k] = into;
                moved++;
            }
        const a = this.data.networks[from], b = this.data.networks[into];
        if (a && b) b.ssids = [...new Set([...(b.ssids ?? []), ...(a.ssids ?? [])])];
        delete this.data.networks[from];
        this.save();
        return moved;
    }

    networkOf(key) {
        return this.data.devices[key];
    }
    assign(key, network) {
        if (network !== "*" && network && !this.data.networks[network]) throw new Error("Réseau inconnu");
        this.data.devices[key] = network || "*";
        this.save();
    }
    unassign(key) {
        delete this.data.devices[key];
        this.save();
    }
    /** Appareils sans réseau (installés avant cette fonction, ou ajoutés hors réseau) : rattachés au réseau actuel. */
    claim(keys, current) {
        if (!current) return 0;
        let n = 0;
        for (const k of keys)
            if (!(k in this.data.devices)) {
                this.data.devices[k] = current;
                n++;
            }
        if (n) this.save();
        return n;
    }
    /** L'appareil est-il utilisable sur le réseau actuel ? */
    isHere(key, current) {
        const a = this.data.devices[key];
        return !current || a === undefined || a === "*" || a === current;
    }
    count(id) {
        return Object.values(this.data.devices).filter(v => v === id).length;
    }
}
