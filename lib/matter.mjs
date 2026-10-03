// Contrôleur Matter local : appairage (multi-admin), découverte des lampes et envoi des commandes.
// Aucune API Philips : tout passe par les clusters Matter standard (OnOff, LevelControl, ColorControl, Identify).
import { EventEmitter } from "node:events";
import { Environment } from "@matter/main";
import {
    BasicInformation,
    BridgedDeviceBasicInformation,
    ColorControl,
    Descriptor,
    FixedLabel,
    GeneralCommissioning,
    Identify,
    LevelControl,
    OnOff,
    UserLabel,
} from "@matter/main/clusters";
import { ManualPairingCodeCodec, NodeId, QrPairingCodeCodec } from "@matter/main/types";
import { CommissioningController } from "@project-chip/matter.js";
import { NodeStates } from "@project-chip/matter.js/device";

const STATE_LABEL = {
    [NodeStates.Connected]: "connecté",
    [NodeStates.Disconnected]: "déconnecté",
    [NodeStates.Reconnecting]: "reconnexion…",
    [NodeStates.WaitingForDeviceDiscovery]: "recherche sur le réseau…",
};

const OPT = { executeIfOff: true };
const NO_OPT = {};

function* walk(endpoints) {
    for (const ep of endpoints) {
        yield ep;
        yield* walk(ep.getChildEndpoints());
    }
}

function safeLocal(client, attr) {
    try {
        return client?.attributes?.[attr]?.getLocal();
    } catch {
        return undefined;
    }
}

const ROOM_LABEL = /^(room|rooms|pi[eè]ce|piece|zone|area|location|lieu|salle|group|groupe)$/i;

/** Pièce annoncée par l'appareil Matter (étiquettes FixedLabel / UserLabel, ou étiquettes sémantiques), si le pont la fournit. */
function matterRoomOf(ep) {
    const labels = [];
    for (const C of [FixedLabel, UserLabel]) {
        const list = safeLocal(ep.getClusterClient(C.Complete), "labelList");
        if (Array.isArray(list)) labels.push(...list.map(x => ({ label: String(x.label ?? ""), value: String(x.value ?? "") })));
    }
    const tags = safeLocal(ep.getClusterClient(Descriptor.Complete), "tagList");
    if (Array.isArray(tags)) for (const t of tags) if (t?.label) labels.push({ label: "tag", value: String(t.label) });
    const hit = labels.find(x => ROOM_LABEL.test(x.label.trim()) && x.value.trim()) ?? labels.find(x => x.label === "tag" && x.value.trim());
    return { room: hit ? hit.value.trim() : null, labels };
}

export class MatterHub extends EventEmitter {
    #controller;
    #nodes = new Map(); // nodeId(string) -> { node, name, state }
    #lamps = new Map(); // lampId -> lamp descriptor (+ endpoint ref)
    ready = false;
    error = null;
    pairing = false;

    constructor({ storagePath, countryCode = "FR", log }) {
        super();
        this.storagePath = storagePath;
        this.countryCode = countryCode;
        this.log = log ?? ((level, msg) => console.log(`[${level}] ${msg}`));
    }

    async start() {
        const env = Environment.default;
        env.vars.set("storage.path", this.storagePath);
        this.#controller = new CommissioningController({
            environment: { environment: env, id: "show-lumiere" },
            autoConnect: false,
            adminFabricLabel: "Show lumiere",
        });
        await this.#controller.start();
        this.ready = true;
        const ids = this.#controller.getCommissionedNodes();
        if (ids.length) this.log("info", `${ids.length} appareil(s) Matter déjà appairé(s), connexion…`);
        for (const id of ids) this.#attach(id).catch(e => this.log("error", `Connexion à l'appareil ${id} impossible : ${e.message}`));
        this.emit("changed");
    }

    async close() {
        await this.#controller?.close();
    }

    // ---------- Appairage ----------

    static parseCode(raw) {
        const code = String(raw ?? "").trim();
        if (/^MT:/i.test(code)) {
            const [data] = QrPairingCodeCodec.decode(code.toUpperCase());
            return { passcode: data.passcode, identifierData: { longDiscriminator: data.discriminator } };
        }
        const digits = code.replace(/\D/g, "");
        if (digits.length !== 11 && digits.length !== 21) {
            throw new Error("Le code d'appairage doit contenir 11 chiffres (ex. 3497-011-2332) ou commencer par MT:");
        }
        const data = ManualPairingCodeCodec.decode(digits);
        return { passcode: data.passcode, identifierData: { shortDiscriminator: data.shortDiscriminator } };
    }

    async pair(rawCode) {
        if (!this.ready) throw new Error("Le contrôleur Matter n'est pas encore démarré");
        if (this.pairing) throw new Error("Un appairage est déjà en cours");
        const { passcode, identifierData } = MatterHub.parseCode(rawCode);
        this.pairing = true;
        this.emit("changed");
        this.log("info", "Recherche de l'appareil en mode appairage sur le réseau local…");
        try {
            const nodeId = await this.#controller.commissionNode({
                commissioning: {
                    regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
                    regulatoryCountryCode: this.countryCode,
                },
                discovery: { identifierData },
                passcode,
            });
            this.log("success", `Appareil appairé (nœud ${nodeId}). Lecture des lampes…`);
            await this.#attach(nodeId);
            return String(nodeId);
        } finally {
            this.pairing = false;
            this.emit("changed");
        }
    }

    async removeNode(nodeIdStr) {
        const entry = this.#nodes.get(nodeIdStr);
        for (const [id, lamp] of this.#lamps) if (lamp.nodeId === nodeIdStr) this.#lamps.delete(id);
        this.#nodes.delete(nodeIdStr);
        this.emit("changed");
        try {
            await this.#controller.removeNode(NodeId(BigInt(nodeIdStr)), true);
            this.log("info", `Appareil ${entry?.name ?? nodeIdStr} retiré de ce contrôleur (il reste dans l'app Maison).`);
        } catch (e) {
            this.log("warn", `Retrait partiel de ${nodeIdStr} : ${e.message}`);
        }
    }

    // ---------- Connexion / découverte ----------

    async #attach(nodeId) {
        const key = String(nodeId);
        const node = await this.#controller.getNode(nodeId);
        const entry = { node, name: `Appareil ${key}`, state: "connexion…" };
        this.#nodes.set(key, entry);
        this.emit("changed");

        node.events.stateChanged.on(state => {
            entry.state = STATE_LABEL[state] ?? String(state);
            if (state === NodeStates.Connected) this.#scan(key);
            this.emit("changed");
        });
        node.events.structureChanged.on(() => this.#scan(key));
        node.events.attributeChanged.on(({ path: { endpointId, attributeName }, value }) => {
            if (!["reachable", "nodeLabel", "labelList", "tagList"].includes(attributeName)) return;
            const lamp = this.#lamps.get(`${key}-${endpointId}`);
            if (!lamp) return;
            if (attributeName === "reachable") lamp.reachable = !!value;
            else if (value) lamp.name = String(value);
            this.emit("changed");
        });

        if (!node.isConnected) node.connect();
        if (!node.initialized) await node.events.initialized;
        entry.state = STATE_LABEL[node.connectionState] ?? entry.state;
        this.#scan(key);
    }

    #scan(key) {
        const entry = this.#nodes.get(key);
        if (!entry) return;
        const { node } = entry;
        let info;
        try {
            info = node.basicInformation;
        } catch {}
        entry.name = info?.nodeLabel || info?.productName || entry.name;
        if (info?.vendorName && !entry.vendor) entry.vendor = info.vendorName;

        const seen = new Set();
        for (const ep of walk(node.getDevices())) {
            const onOff = ep.getClusterClient(OnOff.Complete);
            if (!onOff || ep.number === undefined) continue;
            const id = `${key}-${ep.number}`;
            seen.add(id);
            const level = ep.getClusterClient(LevelControl.Complete);
            const color = ep.getClusterClient(ColorControl.Complete);
            const bridged = ep.getClusterClient(BridgedDeviceBasicInformation.Complete);
            const basic = ep.getClusterClient(BasicInformation.Complete);
            const f = color?.supportedFeatures ?? {};
            const caps = { level: !!level, xy: !!f.xy, hs: !!f.hueSaturation, ct: !!f.colorTemperature };
            const kind = caps.xy || caps.hs ? "color" : caps.ct ? "white" : caps.level ? "dim" : "onoff";
            const name =
                safeLocal(bridged, "nodeLabel") ||
                safeLocal(bridged, "productLabel") ||
                safeLocal(basic, "nodeLabel") ||
                `${entry.name} · ${ep.number}`;
            const reachable = bridged ? safeLocal(bridged, "reachable") !== false : true;
            const { room: matterRoom, labels: matterLabels } = matterRoomOf(ep);
            this.#lamps.set(id, {
                id,
                nodeId: key,
                endpoint: ep.number,
                name,
                kind,
                caps,
                ctMin: safeLocal(color, "colorTempPhysicalMinMireds") || 153,
                ctMax: safeLocal(color, "colorTempPhysicalMaxMireds") || 500,
                reachable,
                matterRoom,
                matterLabels: matterLabels.length ? matterLabels : undefined,
                clients: { onOff, level, color, identify: ep.getClusterClient(Identify.Complete) },
            });
        }
        for (const id of [...this.#lamps.keys()]) {
            if (this.#lamps.get(id).nodeId === key && !seen.has(id)) this.#lamps.delete(id);
        }
        if (entry.lampCount !== seen.size) {
            this.log("info", `${entry.name} : ${seen.size} lampe(s) trouvée(s).`);
            const rooms = [...new Set([...this.#lamps.values()].filter(l => l.nodeId === key && l.matterRoom).map(l => l.matterRoom))];
            this.log("info", rooms.length ? `Pièces annoncées en Matter : ${rooms.join(", ")}.` : `${entry.name} n'annonce pas de pièces en Matter (à définir dans l'onglet Lampes).`);
        }
        entry.lampCount = seen.size;
        this.emit("changed");
    }

    // ---------- Infos pour l'interface ----------

    getNodes() {
        return [...this.#nodes.entries()].map(([id, e]) => ({ id, name: e.name, state: e.state }));
    }

    getLamps() {
        return [...this.#lamps.values()].map(({ clients, ...rest }) => rest);
    }

    hasLamp(id) {
        return this.#lamps.has(id);
    }

    // ---------- Commandes (appelées par le répartiteur) ----------

    /** Exécute une commande élémentaire. cmd.type : on | off | level | xy | hs | ct | identify */
    async exec(lampId, cmd) {
        const lamp = this.#lamps.get(lampId);
        if (!lamp) throw new Error(`Lampe inconnue ${lampId}`);
        const c = lamp.clients;
        const t = Math.max(0, Math.round((cmd.fade ?? 0) * 10)); // Matter : dixièmes de seconde
        switch (cmd.type) {
            case "on":
                return c.onOff.on();
            case "off":
                return c.onOff.off();
            case "level":
                if (!c.level) return cmd.withOnOff ? c.onOff.on() : undefined;
                return cmd.withOnOff
                    ? c.level.moveToLevelWithOnOff({ level: cmd.level, transitionTime: t, optionsMask: NO_OPT, optionsOverride: NO_OPT })
                    : c.level.moveToLevel({ level: cmd.level, transitionTime: t, optionsMask: NO_OPT, optionsOverride: NO_OPT });
            case "xy":
                return c.color.moveToColor({ colorX: cmd.colorX, colorY: cmd.colorY, transitionTime: t, optionsMask: OPT, optionsOverride: OPT });
            case "hs":
                return c.color.moveToHueAndSaturation({ hue: cmd.hue, saturation: cmd.saturation, transitionTime: t, optionsMask: OPT, optionsOverride: OPT });
            case "ct":
                return c.color.moveToColorTemperature({ colorTemperatureMireds: cmd.mireds, transitionTime: t, optionsMask: OPT, optionsOverride: OPT });
            case "identify":
                if (c.identify) return c.identify.identify({ identifyTime: cmd.seconds ?? 3 });
                // pas de cluster Identify : on fait clignoter (4 bascules = retour à l'état initial)
                for (let i = 0; i < 4; i++) {
                    await c.onOff.toggle();
                    await new Promise(r => setTimeout(r, 450));
                }
                return undefined;
        }
    }

    getLampForDispatch(lampId) {
        return this.#lamps.get(lampId);
    }
}
