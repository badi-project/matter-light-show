// Contrôleur Matter local : appairage (multi-admin), découverte des lampes et envoi des commandes.
// Aucune API Philips : tout passe par les clusters Matter standard (OnOff, LevelControl, ColorControl, Identify).
import { EventEmitter } from "node:events";
import { CommissioningClient, Environment } from "@matter/main";
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
    OperationalCredentials,
    UserLabel,
} from "@matter/main/clusters";
import { CommissioningError, ControllerCommissioningFlow, Invoke, Read } from "@matter/main/protocol";
import { ManualPairingCodeCodec, NodeId, QrPairingCodeCodec, Status } from "@matter/main/types";
import { CommissioningController } from "@project-chip/matter.js";
import { NodeStates } from "@project-chip/matter.js/device";
import { automationHost } from "./macos.mjs";
import { withTimeout } from "./util.mjs";

const PAUSED_LABEL = "en pause (autre réseau)";
const STATE_LABEL = {
    [NodeStates.Connected]: "connecté",
    [NodeStates.Disconnected]: "déconnecté",
    [NodeStates.Reconnecting]: "reconnexion…",
    [NodeStates.WaitingForDeviceDiscovery]: "recherche sur le réseau…",
};

const OPT = { executeIfOff: true };
const NO_OPT = {};

// délai maximum d'une commande de show : au-delà, la lampe passe à sa commande suivante
// (sinon une réponse perdue la bloquerait pendant toutes les relances de matter.js)
const COMMAND_TIMEOUT = 4000;
const BLIP_MS = 10000; // coupure plus courte : pas signalée dans le journal
const sameBytes = (a, b) => !!a && !!b && Buffer.from(a).equals(Buffer.from(b));

/**
 * Déroulé d'appairage matter.js + une étape en tête : si la lampe garde encore un ancien appairage avec CE show
 * (retrait fait pendant qu'elle était injoignable, donc elle n'a pas pu être prévenue), on efface d'abord cet ancien
 * appairage dans la lampe (commande RemoveFabric, permise pendant l'appairage), puis l'appairage normal continue.
 * Sans cela, la lampe répond « already commissioned into this fabric ».
 */
function flowRemovingStaleFabric({ isKnownNode, onStale }) {
    return class extends ControllerCommissioningFlow {
        constructor(...args) {
            super(...args);
            this.commissioningSteps.push({
                stepNumber: 0,
                subStepNumber: 0, // avant tout le reste (y compris le contrôle « trop de contrôleurs »)
                name: "ShowLumiere.RemoveStaleFabric",
                stepLogic: () => this.removeStaleFabric(),
            });
        }

        async removeStaleFabric() {
            let fabrics = [];
            const read = Read({ fabricFilter: false }, Read.Attribute({ endpoint: 0, cluster: OperationalCredentials, attributes: ["fabrics"] }));
            for await (const chunk of this.interaction.read(read)) {
                for await (const entry of chunk) {
                    if (entry.kind === "attr-value" && entry.path.attributeId === OperationalCredentials.attributes.fabrics.id) fabrics = entry.value ?? [];
                }
            }
            const mine = fabrics.filter(f => BigInt(f.fabricId) === BigInt(this.fabric.fabricId) && sameBytes(f.rootPublicKey, this.fabric.rootPublicKey));
            if (!mine.length) return { code: 2 /* rien à faire */, breadcrumb: this.lastBreadcrumb };
            for (const f of mine) {
                const oldNode = String(f.nodeId);
                if (isKnownNode(oldNode)) {
                    throw new CommissioningError(`Cette lampe est déjà appairée au show (appareil n° ${oldNode}) : elle est dans la liste, inutile de la réappairer.`);
                }
                let response;
                const invoke = Invoke({
                    commands: [{ endpoint: 0, cluster: OperationalCredentials, command: "removeFabric", fields: { fabricIndex: f.fabricIndex } }],
                });
                for await (const chunk of this.interaction.invoke(invoke)) {
                    for (const entry of chunk) {
                        if (entry.kind === "cmd-status" && entry.status !== Status.Success) throw new CommissioningError(`la lampe refuse d'effacer l'ancien appairage (statut ${entry.status})`);
                        if (entry.kind === "cmd-response") response = entry.data;
                    }
                }
                if (response && response.statusCode !== OperationalCredentials.NodeOperationalCertStatus.Ok) {
                    throw new CommissioningError(`la lampe refuse d'effacer l'ancien appairage (${OperationalCredentials.NodeOperationalCertStatus[response.statusCode] ?? response.statusCode})`);
                }
                onStale?.(oldNode);
            }
            return { code: 0, breadcrumb: this.lastBreadcrumb };
        }
    };
}

/** Message clair pour une erreur d'appairage. */
export function pairingErrorMessage(e) {
    const m = String(e?.message ?? e);
    if (/already commissioned into this fabric|device-already-commissioned|FabricConflict/i.test(m))
        return "Cette lampe garde encore un ancien appairage avec ce show (elle était injoignable quand tu l'as retirée, elle n'a donc pas pu être prévenue) et elle a refusé qu'on l'efface. Réinitialise-la aux réglages d'usine (voir la notice de la lampe), ajoute-la de nouveau dans l'app Maison ou IKEA, puis réappaire-la ici.";
    if (/déjà appairée au show/i.test(m)) return m;
    if (/maximum number of fabrics|TableFull|exceed supported fabrics/i.test(m))
        return "Cette lampe a déjà le nombre maximum de contrôleurs (souvent 5). Retire-la d'une autre app (Google Home, Alexa, SmartThings…) puis réessaie.";
    if (/refuse d'effacer l'ancien appairage/i.test(m))
        return `Cette lampe garde un ancien appairage avec ce show et a refusé qu'on l'efface${(m.match(/\(([^)]*)\)/) ?? [])[1] ? ` (${m.match(/\(([^)]*)\)/)[1]})` : ""}. Réinitialise-la aux réglages d'usine (voir sa notice), puis réappaire-la.`;
    if (/passcode|PASE|pake|discover|not found|timeout|timed out|introuvable/i.test(m))
        return `${m}. Vérifie que le code est récent (il expire après ~15 min), que la lampe est en mode appairage et que le Mac est sur le même réseau.`;
    return `${m}.`;
}

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
    #nodes = new Map(); // nodeId(string) -> { node, name, state, connected, lostAt, fails… }
    #watchdog = null;
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

    /** Numéros des appareils réellement appairés (enregistrés par le contrôleur). */
    commissionedIds() {
        try {
            return this.#controller.getCommissionedNodes().map(String);
        } catch {
            return [];
        }
    }

    /**
     * Nettoie le stockage du contrôleur : appareils restés à moitié enregistrés après un appairage raté
     * (aucune adresse opérationnelle), et le cas échéant un appareil précis (retrait forcé).
     */
    async cleanupStorage(forceNodeId = null) {
        let removed = 0;
        let peers = [];
        try {
            peers = [...this.#controller.node.peers];
        } catch {
            return 0;
        }
        for (const peer of peers) {
            let address, commissionedAt;
            try {
                const st = peer.maybeStateOf(CommissioningClient);
                address = st?.peerAddress;
                commissionedAt = st?.commissionedAt;
            } catch {
                continue; // état illisible : on n'y touche pas
            }
            const orphan = !address && !commissionedAt && !this.pairing;
            const forced = forceNodeId !== null && address && String(address.nodeId) === String(forceNodeId);
            if (!orphan && !forced) continue;
            try {
                await withTimeout(peer.delete(), 10000);
                removed++;
            } catch (e) {
                this.log("warn", `Nettoyage du stockage Matter incomplet : ${e.message}`);
            }
        }
        return removed;
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
        // appareil injoignable : nouvelle tentative de connexion toutes les 30 s (en plus de celles de matter.js, qui s'espacent)
        this.#watchdog = setInterval(() => {
            for (const e of this.#nodes.values()) {
                if (e.paused || !e.lostAt || e.connected || Date.now() - Math.max(e.lostAt, e.kickAt ?? 0) < 30000) continue;
                e.kickAt = Date.now();
                try {
                    e.node.triggerReconnect();
                } catch {}
            }
        }, 15000);
        this.#watchdog.unref?.();
        // restes d'appairages ratés (sans danger, mais inutiles)
        setTimeout(() => this.cleanupStorage().then(n => n && this.log("info", `Stockage Matter nettoyé (${n} reste(s) d'appairage raté).`)), 20000).unref?.();
    }

    async close() {
        this.closing = true; // pas de « ne répond plus » à l'arrêt du logiciel
        clearInterval(this.#watchdog);
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
        const commissioningFlowImpl = flowRemovingStaleFabric({
            isKnownNode: id => this.commissionedIds().includes(String(id)),
            onStale: id =>
                this.log("info", `Cette lampe gardait un ancien appairage avec le show (appareil n° ${id}, retiré pendant qu'elle était injoignable) : effacé, l'appairage continue…`),
        });
        try {
            const nodeId = await this.#controller.commissionNode(
                {
                    commissioning: {
                        regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
                        regulatoryCountryCode: this.countryCode,
                    },
                    discovery: { identifierData },
                    passcode,
                },
                { commissioningFlowImpl },
            );
            this.log("success", `Appareil appairé (nœud ${nodeId}). Lecture des lampes…`);
            await this.#attach(nodeId);
            return String(nodeId);
        } finally {
            this.pairing = false;
            this.emit("changed");
            setTimeout(() => this.cleanupStorage(), 3000); // un essai raté laisse des restes dans le stockage
        }
    }

    /**
     * Retire un appareil. On prévient l'appareil s'il répond (10 s max), puis on l'efface du stockage du contrôleur
     * dans tous les cas (retrait forcé en local). Une lampe injoignable garde alors l'ancien appairage, qui sera
     * effacé automatiquement si on la réappaire (voir flowRemovingStaleFabric).
     */
    /** Identifiant stable de l'appareil (le même s'il est réappairé). */
    #uidOf(entry) {
        try {
            const b = entry?.node?.basicInformation;
            return b?.uniqueId || b?.serialNumber || null;
        } catch {
            return null;
        }
    }

    async removeNode(nodeIdStr) {
        const entry = this.#nodes.get(nodeIdStr);
        const name = entry?.name ?? `Appareil ${nodeIdStr}`;
        const uid = this.#uidOf(entry);
        const lampsBefore = [...this.#lamps.values()].filter(l => l.nodeId === nodeIdStr).map(l => ({ id: l.id, endpoint: l.endpoint }));
        for (const [id, lamp] of this.#lamps) if (lamp.nodeId === nodeIdStr) this.#lamps.delete(id);
        this.#nodes.delete(nodeIdStr);
        clearTimeout(entry?.slowTimer);
        this.emit("changed");
        const nodeId = NodeId(BigInt(nodeIdStr));
        let told = false;
        if (entry?.node?.isConnected) {
            try {
                await withTimeout(entry.node.decommission(), 10000, "pas de réponse");
                told = true;
            } catch {}
        }
        let clean = true;
        try {
            await withTimeout(this.#controller.removeNode(nodeId, false), 15000, "délai dépassé");
        } catch (e) {
            clean = false;
            this.log("warn", `Retrait de ${name} : ${e.message}, nettoyage direct du stockage…`);
        }
        const forced = await this.cleanupStorage(clean ? null : nodeIdStr);
        if (!clean && !forced && this.commissionedIds().includes(nodeIdStr)) {
            this.log("error", `${name} n'a pas pu être effacé du stockage. Redémarre le logiciel (↻) puis réessaie.`);
            return;
        }
        if (uid) this.emit("nodeRemoved", { key: nodeIdStr, uid, name, lamps: lampsBefore });
        this.log(
            "info",
            told
                ? `${name} retiré du show (l'appareil a été prévenu ; il reste dans l'app Maison).`
                : `${name} retiré du show (nettoyage local forcé). L'appareil ${entry?.paused ? "est sur un autre réseau" : "ne répondait pas"} : il garde peut-être l'ancien appairage, qui sera effacé automatiquement si tu le réappaires.`,
        );
    }

    // ---------- Connexion / découverte ----------

    async #attach(nodeId) {
        const key = String(nodeId);
        const node = await this.#controller.getNode(nodeId);
        const paused = this.nodeFilter ? !this.nodeFilter(key) : false; // appareil d'un autre réseau
        const entry = { node, name: `Appareil ${key}`, state: paused ? PAUSED_LABEL : "connexion…", paused };
        this.#nodes.set(key, entry);
        this.emit("changed");

        node.events.stateChanged.on(state => {
            if (entry.paused) {
                // appareil d'un autre réseau : on ne cherche pas à le joindre, ce n'est pas une panne
                entry.connected = false;
                entry.state = PAUSED_LABEL;
                this.emit("changed");
                return;
            }
            const wasConnected = entry.connected;
            entry.state = STATE_LABEL[state] ?? String(state);
            entry.connected = state === NodeStates.Connected;
            if (entry.connected) {
                entry.everConnected = true;
                entry.fails = 0;
                if (entry.lostAt) {
                    const s = Math.round((Date.now() - entry.lostAt) / 1000);
                    clearTimeout(entry.warnTimer);
                    if (entry.warned) this.log("success", `${entry.name} de nouveau joignable (après ${s < 120 ? `${s} s` : `${Math.round(s / 60)} min`}).`);
                    entry.lostAt = null;
                    entry.warned = false;
                    this.emit("nodeBack", key);
                }
                this.#scan(key);
            } else if (wasConnected && !entry.lostAt && !this.closing) {
                entry.lostAt = Date.now();
                // coupure de quelques secondes (Mac qui sort de veille, Wi-Fi) : rien à signaler si elle se rétablit seule
                clearTimeout(entry.warnTimer);
                entry.warnTimer = setTimeout(() => {
                    if (!entry.lostAt || this.#nodes.get(key) !== entry || this.closing) return;
                    entry.warned = true;
                    this.log("warn", `${entry.name} ne répond plus : reconnexion automatique en cours…`);
                }, BLIP_MS);
                entry.warnTimer.unref?.();
                // toujours absent après 3 min : piste la plus probable
                clearTimeout(entry.slowTimer);
                entry.slowTimer = setTimeout(() => {
                    if (!entry.lostAt || this.#nodes.get(key) !== entry) return;
                    this.log("warn", `${entry.name} toujours injoignable. Vérifie qu'elle est alimentée (interrupteur) ; pour une ampoule Thread (IKEA, Eve, Nanoleaf…), que le HomePod / l'Apple TV qui sert de routeur Thread est allumé.`);
                }, 180000);
                entry.slowTimer.unref?.();
            }
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

        if (!node.isConnected && !entry.paused) node.connect();
        // Toujours pas joignable après 45 s : le plus souvent, le Mac bloque l'accès au réseau local.
        setTimeout(() => {
            if (this.#nodes.get(key) !== entry || node.isConnected || entry.everConnected || entry.paused) return; // seulement au démarrage
            entry.lostAt ??= Date.now(); // ses commandes échouent tout de suite au lieu d'attendre (et l'interface la montre injoignable)
            this.emit("changed");
            const who = automationHost();
            this.log(
                "warn",
                `${entry.name} injoignable pour l'instant. Si ça dure : Réglages Système › Confidentialité et sécurité › Réseau local › active « ${who} », puis clique ↻ (vérifie aussi que le pont est allumé et sur le même Wi-Fi/réseau).`,
            );
        }, 45000).unref?.();
        if (!node.initialized) await node.events.initialized;
        entry.state = entry.paused ? PAUSED_LABEL : STATE_LABEL[node.connectionState] ?? entry.state;
        entry.connected = node.isConnected;
        if (entry.connected) entry.everConnected = true;
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
        if (seen.size && !entry.readySent) {
            entry.readySent = true;
            this.emit("nodeReady", { key, uid: this.#uidOf(entry), name: entry.name });
        }
        this.emit("changed");
    }

    // ---------- Infos pour l'interface ----------

    getNodes() {
        return [...this.#nodes.entries()].map(([id, e]) => ({ id, name: e.name, state: e.state, paused: !!e.paused }));
    }

    /**
     * Réseaux : les appareils d'un autre réseau sont mis en pause (déconnectés, sans tentative de reconnexion),
     * ceux du réseau actuel sont (re)connectés. nodeFilter(key) -> true si l'appareil est sur le réseau actuel.
     */
    applyNodeFilter() {
        let paused = 0, resumed = 0;
        for (const [key, e] of this.#nodes) {
            const want = this.nodeFilter ? this.nodeFilter(key) : true;
            if (!want && !e.paused) {
                e.paused = true;
                e.lostAt = null;
                e.fails = 0;
                clearTimeout(e.slowTimer);
                e.state = PAUSED_LABEL;
                e.connected = false;
                e.node.disconnect().catch(() => {});
                paused++;
            } else if (want && e.paused) {
                e.paused = false;
                e.state = "connexion…";
                e.lostAt = null;
                try {
                    e.node.connect();
                } catch {}
                resumed++;
            }
        }
        if (paused || resumed) this.emit("changed");
        return { paused, resumed };
    }

    /** Pont (plusieurs lampes derrière, ex. Hue) ou lampe Matter seule (souvent en Thread ou en Wi-Fi). */
    isBridge(nodeKey) {
        let n = 0;
        for (const l of this.#lamps.values()) if (l.nodeId === nodeKey && ++n > 1) return true;
        return false;
    }

    getLamps() {
        return [...this.#lamps.values()].map(({ clients, ...rest }) => {
            const e = this.#nodes.get(rest.nodeId);
            return e && ((e.connected === false && e.lostAt) || e.paused) ? { ...rest, reachable: false } : rest;
        });
    }

    hasLamp(id) {
        return this.#lamps.has(id);
    }

    /** État réel des lampes tel que le pont le rapporte (abonnement Matter, rien n'est envoyé) : diagnostic. */
    readStates() {
        const out = {};
        for (const [id, l] of this.#lamps) {
            const { onOff, level, color } = l.clients;
            const s = { on: safeLocal(onOff, "onOff") ?? null, level: safeLocal(level, "currentLevel") ?? null, reachable: l.reachable };
            if (color) {
                const mode = safeLocal(color, "colorMode");
                s.colorMode = mode ?? null; // 0 teinte/saturation, 1 xy, 2 température de blanc
                s.x = safeLocal(color, "currentX") ?? null;
                s.y = safeLocal(color, "currentY") ?? null;
                s.mireds = safeLocal(color, "colorTemperatureMireds") ?? null;
            }
            out[id] = s;
        }
        return out;
    }

    // ---------- Commandes (appelées par le répartiteur) ----------

    /** Exécute une commande élémentaire. cmd.type : on | off | level | xy | hs | ct | identify */
    async exec(lampId, cmd) {
        const lamp = this.#lamps.get(lampId);
        if (!lamp) throw new Error(`Lampe inconnue ${lampId}`);
        const entry = this.#nodes.get(lamp.nodeId);
        if (entry?.paused) throw Object.assign(new Error("sur un autre réseau"), { unreachable: true });
        if (entry?.lostAt) throw Object.assign(new Error("injoignable (reconnexion en cours)"), { unreachable: true });
        try {
            const r = await withTimeout(this.#exec(lamp, cmd), cmd.type === "identify" ? 8000 : COMMAND_TIMEOUT, "timeout : pas de réponse");
            if (entry) entry.fails = 0;
            return r;
        } catch (e) {
            if (entry && /abort|timeout|timed out|no response|closed|unreachable|PeerUnresponsive/i.test(String(e?.message))) {
                entry.fails = (entry.fails ?? 0) + 1;
                // plusieurs commandes sans réponse alors que matter.js croit la lampe connectée : on force une reconnexion
                if (entry.fails >= 3 && Date.now() - (entry.kickAt ?? 0) > 60000) {
                    entry.kickAt = Date.now();
                    this.log("warn", `${entry.name} ne répond plus aux commandes : nouvelle connexion…`);
                    try {
                        entry.node.triggerReconnect();
                    } catch {}
                }
            }
            throw e;
        }
    }

    async #exec(lamp, cmd) {
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
