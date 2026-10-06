// Sorties audio du Mac : haut-parleurs intégrés, enceintes et casques Bluetooth, USB, HDMI / DisplayPort (TV, écran),
// AirPlay du système, sorties multiples… On peut voir laquelle joue, en choisir une autre, régler son volume,
// et connecter une enceinte Bluetooth déjà jumelée. Tout passe par des outils fournis avec macOS :
//   - system_profiler SPAudioDataType : la liste, le type et la sortie actuelle ;
//   - say -a '?' : l'identifiant Core Audio de chaque sortie ;
//   - osascript (AppleScript) : le volume ; (JavaScript) : choisir la sortie (Core Audio) et le Bluetooth (IOBluetooth).
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ON_MAC, run } from "./macos.mjs";
import { parseJson, pct, readJson, writeJson } from "./util.mjs";

const JXA = join(dirname(fileURLToPath(import.meta.url)), "jxa");
const BT_JS = join(JXA, "bluetooth.js");
const HELPER_NAME = "Show lumière Bluetooth";
const HELPER = join(process.env.SHOW_DATA_DIR || join(JXA, "..", "..", "data"), "aides", `${HELPER_NAME}.app`);
const AUTH_FILE = join(dirname(HELPER), "bluetooth.json");
const readAuth = () => readJson(AUTH_FILE, {})?.auth ?? null;
const HELPER_VERSION = "show-bt-1"; // changer seulement si le script change : macOS redemanderait l'autorisation
const TRANSPORT = {
    bluetooth: "Bluetooth",
    bluetoothle: "Bluetooth",
    builtin: "Mac",
    usb: "USB",
    hdmi: "HDMI",
    displayport: "DisplayPort",
    airplay: "AirPlay",
    virtual: "virtuelle",
    aggregate: "multi-sortie",
    autoaggregate: "multi-sortie",
    thunderbolt: "Thunderbolt",
    pci: "carte son",
    firewire: "FireWire",
    avb: "réseau (AVB)",
    continuitycapturewired: "iPhone",
    continuitycapturewireless: "iPhone",
};
const KIND = { Bluetooth: "bluetooth", Mac: "mac", USB: "usb", HDMI: "tv", DisplayPort: "tv", AirPlay: "airplay" };

/** Octets petit-boutistes (base64) de plusieurs entiers 32 bits, pour la commande Core Audio. */
const u32b64 = (...vals) => {
    const b = Buffer.alloc(4 * vals.length);
    vals.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4));
    return b.toString("base64");
};
const fourcc = s => [...s].reduce((a, c) => (a << 8) | c.charCodeAt(0), 0) >>> 0;
const ADDR_DEFAULT_OUT = u32b64(fourcc("dOut"), fourcc("glob"), 0);
const ADDR_SYSTEM_OUT = u32b64(fourcc("sOut"), fourcc("glob"), 0);

const normName = s => String(s ?? "").normalize("NFC").trim().toLowerCase();

export class MacAudio {
    available = ON_MAC;
    #cache = { at: 0, list: [] };
    #ids = { at: 0, map: new Map() };
    #bt = { at: 0, list: [], error: null };
    #btDirect = null; // accès Bluetooth direct possible (true) ou via l'app d'aide (false)
    #helperAuth = readAuth(); // autorisation Bluetooth de l'app d'aide (null = jamais lancée)
    lastError = null;

    /** Identifiants Core Audio des sorties (nom -> id), via « say -a ? ». */
    async #deviceIds(force) {
        if (!force && Date.now() - this.#ids.at < 60000) return this.#ids.map;
        const r = await run("say", ["-a", "?"], 5000);
        const map = new Map();
        for (const line of r.out.split("\n")) {
            const m = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
            if (m) map.set(normName(m[2]), Number(m[1]));
        }
        this.#ids = { at: Date.now(), map };
        return map;
    }

    /** Sorties du Mac : [{ id, name, transport, kind, current, volume? }] (cache de 10 s). */
    async outputs(force = false, maxAge = 10000) {
        if (!this.available) return [];
        if (!force && Date.now() - this.#cache.at < maxAge) return this.#cache.list;
        const [sp, ids] = await Promise.all([run("system_profiler", ["SPAudioDataType", "-json"], 15000), this.#deviceIds(force)]);
        let items = [];
        try {
            const j = JSON.parse(sp.out);
            for (const group of j.SPAudioDataType ?? []) items.push(...(group._items ?? []));
            this.lastError = null;
        } catch {
            this.lastError = sp.err || "liste des sorties illisible";
        }
        const list = [];
        for (const it of items) {
            const isOut = it.coreaudio_device_output !== undefined || it.coreaudio_default_audio_output_device !== undefined || it.coreaudio_output_source !== undefined;
            if (!isOut) continue;
            const name = it._name ?? "";
            const t = String(it.coreaudio_device_transport ?? "").replace(/^coreaudio_device_type_/, "");
            const transport = TRANSPORT[t] ?? (t || "autre");
            list.push({
                id: ids.get(normName(name)) ?? null,
                name,
                transport,
                kind: KIND[transport] ?? "autre",
                current: it.coreaudio_default_audio_output_device === "spaudio_yes",
                manufacturer: it.coreaudio_device_manufacturer ?? "",
            });
        }
        const cur = list.find(o => o.current);
        if (cur) cur.volume = await this.getVolume();
        list.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
        this.#cache = { at: Date.now(), list };
        return list;
    }

    /** Sortie actuelle du Mac (nom), pour relier les pièces aux enceintes. */
    async current(maxAge = 10000) {
        return (await this.outputs(false, maxAge)).find(o => o.current) ?? null;
    }
    /** Noms des sorties déjà connues (sans rien relire). */
    cachedNames() {
        return this.#cache.list.map(o => o.name);
    }

    /** Choisit la sortie du Mac (et celle des sons du système). */
    async select(name) {
        if (!this.available) throw new Error("Seulement sur Mac");
        const ids = await this.#deviceIds(true);
        const id = ids.get(normName(name));
        if (id === undefined) throw new Error(`Sortie « ${name} » introuvable (débranchée ou éteinte ?)`);
        const r = await run("osascript", ["-l", "JavaScript", join(JXA, "sortie-audio.js"), ADDR_DEFAULT_OUT, u32b64(id), ADDR_SYSTEM_OUT], 8000);
        let codes;
        try {
            codes = JSON.parse(r.out.trim());
        } catch {
            throw new Error(`Changement de sortie impossible : ${r.err || r.out || "réponse vide"}`);
        }
        if (codes[0] !== 0) throw new Error(`Changement de sortie refusé par macOS (code ${codes[0]})`);
        this.#cache.at = 0;
        return true;
    }

    /** Volume de la sortie actuelle (0–100), null si elle n'a pas de volume (HDMI…). */
    async getVolume() {
        const r = await run("osascript", ["-e", "output volume of (get volume settings)"], 4000);
        const v = parseInt(r.out, 10);
        return Number.isFinite(v) ? v : null;
    }
    async setVolume(v) {
        const vol = pct(v);
        const r = await run("osascript", ["-e", `set volume output volume ${vol}`], 4000);
        if (!r.ok) throw new Error(`Volume impossible : ${r.err}`);
        const cur = this.#cache.list.find(o => o.current);
        if (cur) cur.volume = vol;
    }

    /** Enceintes et casques Bluetooth jumelés (connectés ou non). */
    async bluetooth(force = false) {
        if (!this.available) return { list: [], error: null };
        const result = () => ({ list: this.#bt.list, error: this.#bt.error, via: this.#btDirect ? "direct" : "app", helperAuth: this.#btDirect ? 3 : this.#helperAuth });
        if (!force && Date.now() - this.#bt.at < 15000) return result();
        // 1) lecture directe (possible quand le logiciel qui lance le show a l'autorisation Bluetooth, ex. Terminal)
        const r = await run("osascript", ["-l", "JavaScript", BT_JS], 8000);
        const j = parseJson(r.out);
        if (j?.auth === 3 && Array.isArray(j.devices)) {
            this.#btDirect = true;
            this.#bt = { at: Date.now(), list: audioOnly(j.devices), error: null };
        } else {
            // 2) sinon (service en arrière-plan) : la liste vient de system_profiler, sans autorisation à demander ;
            //    la connexion passera par la petite app « Show lumière Bluetooth »
            this.#btDirect = false;
            const list = await this.#bluetoothProfiler();
            this.#bt = { at: Date.now(), list: list ?? [], error: list ? null : btError(r.err || r.out) };
        }
        return result();
    }
    /** Lance l'app d'aide sans toucher aux appareils : macOS affiche sa demande d'autorisation la 1re fois. */
    async bluetoothAuthorize() {
        if (this.#btDirect === null) await this.bluetooth(true);
        if (this.#btDirect) return { auth: 3 };
        const j = await this.#helperRun([]);
        if (j.error) throw new Error(`Bluetooth : ${String(j.error).slice(0, 160)}`);
        this.#bt.at = 0;
        return { auth: j.auth };
    }
    /** Appareils Bluetooth jumelés d'après system_profiler (repli). */
    async #bluetoothProfiler() {
        const r = await run("system_profiler", ["SPBluetoothDataType", "-json"], 15000);
        try {
            const j = JSON.parse(r.out);
            const list = [];
            for (const ctl of j.SPBluetoothDataType ?? []) {
                for (const [key, connected] of [["device_connected", true], ["device_not_connected", false]]) {
                    for (const entry of ctl[key] ?? []) {
                        for (const [name, d] of Object.entries(entry)) {
                            const type = String(d.device_minorType ?? "");
                            if (!/head|speaker|audio|hifi|loud|sound|ear|casque|enceinte|car/i.test(type)) continue;
                            list.push({ name, address: String(d.device_address ?? "").replace(/-/g, ":"), connected, minor: /head|ear|casque/i.test(type) ? 6 : 5 });
                        }
                    }
                }
            }
            return list.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name, "fr"));
        } catch {
            return null;
        }
    }
    async bluetoothConnect(address, connect = true) {
        if (!/^[0-9a-f]{2}([-:][0-9a-f]{2}){5}$/i.test(String(address))) throw new Error("Adresse Bluetooth invalide");
        if (this.#btDirect === null) await this.bluetooth(true);
        const args = [connect ? "connect" : "disconnect", address];
        let j;
        if (this.#btDirect) {
            const r = await run("osascript", ["-l", "JavaScript", BT_JS, ...args], 25000);
            j = parseJson(r.out);
            if (!j) throw new Error(btError(r.err || r.out));
        } else {
            j = await this.#helperRun(args);
        }
        if (j.error) throw new Error(`Bluetooth : ${String(j.error).slice(0, 160)}`);
        if (j.auth === 0) throw new Error(`macOS demande l'autorisation : clique « Autoriser » dans la fenêtre « ${HELPER_NAME} souhaite utiliser le Bluetooth » sur le Mac, puis réessaie.`);
        if (j.auth !== 3) throw new Error(`Bluetooth refusé pour « ${HELPER_NAME} » : Réglages Système › Confidentialité et sécurité › Bluetooth › active « ${HELPER_NAME} », puis réessaie.`);
        const hex = a => String(a).replace(/[^0-9a-f]/gi, "").toLowerCase();
        const d = (j.devices ?? []).find(x => hex(x.address) === hex(address));
        if (!d) throw new Error("Appareil Bluetooth introuvable (il n'est plus jumelé à ce Mac ?)");
        if (d.result !== 0) throw new Error(connect ? `Connexion impossible (code ${d.result}) : l'enceinte est-elle allumée, à portée, et libre (pas connectée à un téléphone) ?` : `Déconnexion impossible (code ${d.result})`);
        this.#bt.at = 0;
        this.#cache.at = 0;
        return true;
    }

    /** Petite app « Show lumière Bluetooth » : créée une fois sur le Mac (osacompile), macOS lui demande l'autorisation. */
    async #helper() {
        const plist = join(HELPER, "Contents", "Info.plist");
        if (existsSync(plist) && readFileSync(plist, "utf8").includes(`<string>${HELPER_VERSION}</string>`)) return HELPER;
        mkdirSync(dirname(HELPER), { recursive: true });
        rmSync(HELPER, { recursive: true, force: true });
        rmSync(AUTH_FILE, { force: true });
        this.#helperAuth = null;
        const steps = [
            ["osacompile", ["-l", "JavaScript", "-o", HELPER, BT_JS]],
            ["plutil", ["-replace", "NSBluetoothAlwaysUsageDescription", "-string", "Pour connecter tes enceintes et casques Bluetooth depuis le Show lumière.", plist]],
            ["plutil", ["-replace", "CFBundleIdentifier", "-string", "fr.showlumiere.bluetooth", plist]],
            ["plutil", ["-replace", "CFBundleName", "-string", HELPER_NAME, plist]],
            ["plutil", ["-replace", "LSUIElement", "-bool", "YES", plist]],
            ["plutil", ["-replace", "ShowLumiereHelper", "-string", HELPER_VERSION, plist]],
            ["xattr", ["-cr", HELPER]],
            ["codesign", ["--force", "--deep", "--sign", "-", HELPER]],
        ];
        for (const [cmd, args] of steps) {
            const r = await run(cmd, args, 30000);
            if (!r.ok && cmd !== "xattr") {
                rmSync(HELPER, { recursive: true, force: true });
                throw new Error(`Préparation de l'app Bluetooth impossible (${cmd}) : ${r.err.slice(0, 160)}`);
            }
        }
        return HELPER;
    }
    async #helperRun(args) {
        if (process.platform !== "darwin") throw new Error("Seulement sur Mac");
        const app = await this.#helper();
        const out = join(tmpdir(), `show-bluetooth-${process.pid}-${Date.now()}.json`);
        // -W : attend la fin ; -g : sans passer au premier plan ; -n : nouvelle instance
        const r = await run("open", ["-W", "-g", "-n", app, "--args", "--show-out", out, ...args], 45000);
        let j = null;
        try {
            j = parseJson(readFileSync(out, "utf8"));
            rmSync(out, { force: true });
        } catch {}
        if (j && typeof j.auth === "number") {
            this.#helperAuth = j.auth;
            try {
                writeJson(AUTH_FILE, { auth: j.auth, at: new Date().toISOString() });
            } catch {}
        }
        if (!j) throw new Error(`L'app « ${HELPER_NAME} » n'a pas répondu${r.err ? ` : ${r.err.slice(0, 140)}` : ""}. Tu peux connecter l'enceinte depuis le Centre de contrôle (icône Bluetooth).`);
        return j;
    }
}

// classe principale 4 = audio / vidéo (enceintes, casques, barres de son…)
// (un même appareil peut apparaître deux fois : Bluetooth classique + basse consommation)
const audioOnly = devices => {
    const seen = new Map();
    for (const d of devices) {
        if (d.major !== 4 || !d.name) continue;
        const k = String(d.address).replace(/[^0-9a-f]/gi, "").toLowerCase();
        const prev = seen.get(k);
        seen.set(k, { name: d.name, address: d.address, connected: !!d.connected || !!prev?.connected, minor: d.minor });
    }
    return [...seen.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name, "fr"));
};

function btError(msg) {
    return `Liste Bluetooth illisible${msg ? ` : ${String(msg).slice(0, 140)}` : ""}. Tu peux connecter l'enceinte depuis le Centre de contrôle (icône Bluetooth) : elle apparaîtra dans « Sortie du Mac ».`;
}
