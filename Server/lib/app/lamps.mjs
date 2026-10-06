// Lampes : contrôleur Matter, autres systèmes (WiZ, Home Assistant, Zigbee2MQTT), réseaux, aperçu et envoi des commandes.
import { join } from "node:path";
import { DeviceHub } from "../devices.mjs";
import { HomeAssistantDriver } from "../drivers/homeassistant.mjs";
import { WizDriver } from "../drivers/wiz.mjs";
import { Zigbee2MqttDriver } from "../drivers/zigbee2mqtt.mjs";
import { MatterHub } from "../matter.mjs";
import { NetworkRegistry, NetworkWatcher } from "../network.mjs";
import { Rooms } from "../rooms.mjs";
import { Dispatcher, Player, displayColor } from "../show.mjs";
import { readJson, writeJson } from "../util.mjs";

export const SECRET = "••••••";
export const INTEG_NAME = { wiz: "WiZ", ha: "Home Assistant", z2m: "Zigbee2MQTT" };
const INTEG_DEFAULTS = {
    wiz: { enabled: false, ips: [] },
    ha: { enabled: false, url: "", token: "" },
    z2m: { enabled: false, host: "", port: 1883, username: "", password: "", base: "zigbee2mqtt" },
};
const DEMO_LAMPS = Array.from({ length: 6 }, (_, i) => ({
    id: `demo-${i + 1}`,
    nodeId: "demo",
    endpoint: i + 1,
    name: `Démo ${i + 1}`,
    kind: "color",
    caps: { level: true, xy: true, hs: true, ct: true },
    reachable: true,
    virtual: true,
}));
// débit par passerelle : pont Matter = réglage « Débit max » ; ampoule WiZ, Home Assistant, réseau Zigbee : valeurs sûres.
// Ampoule Matter seule (Thread ou Wi-Fi, ex. IKEA KAJPLATS) : 3 commandes/s au plus, un réseau Thread sature vite.
const DIRECT_MATTER_RATE = 3;

export const nodeKey = id => `matter:${id}`;
export const integKey = id => `integ:${id}`;

export function setupLamps(ctx) {
    const { paths, settings, log, state } = ctx;

    // ---------------------------------------------------------------- appareils
    const hub = (ctx.hub = new MatterHub({ storagePath: join(paths.data, "matter"), log }));
    const devices = (ctx.devices = new DeviceHub(hub)); // Matter + autres systèmes
    ctx.rooms = new Rooms(readJson(paths.rooms, {}), d => writeJson(paths.rooms, d)); // pièces : lampes, ordre, enceintes
    const fileInteg = readJson(paths.integ, {});
    const integ = (ctx.integ = Object.fromEntries(Object.entries(INTEG_DEFAULTS).map(([k, v]) => [k, { ...v, ...(fileInteg[k] ?? {}) }])));
    ctx.saveInteg = () => writeJson(paths.integ, integ);
    const DRIVERS = {
        wiz: c => new WizDriver({ log, ips: c.ips, broadcast: process.env.WIZ_BROADCAST || "255.255.255.255", port: Number(process.env.WIZ_PORT) || 38899 }),
        ha: c => new HomeAssistantDriver({ log, url: c.url, token: c.token }),
        z2m: c => new Zigbee2MqttDriver({ log, host: c.host, port: c.port, username: c.username, password: c.password, base: c.base }),
    };

    // ---------------------------------------------------------------- réseaux (plusieurs Wi-Fi / maisons)
    const nets = (ctx.nets = new NetworkRegistry(readJson(paths.networks, null), d => writeJson(paths.networks, d)));
    ctx.netWatch = new NetworkWatcher();
    /** Clé « appareil » d'une lampe : son appareil Matter, ou le système (WiZ, Home Assistant, Zigbee2MQTT). */
    const lampDeviceKey = l => (l.virtual ? null : l.source && l.source !== "matter" ? integKey(l.source) : l.nodeId ? nodeKey(l.nodeId) : null);
    const isHere = (ctx.isHere = key => !key || nets.isHere(key, state.currentNet));
    hub.nodeFilter = id => isHere(nodeKey(id));
    ctx.deviceKeys = () => {
        const ids = new Set([...hub.commissionedIds(), ...hub.getNodes().map(n => n.id)]);
        return [...[...ids].map(nodeKey), ...Object.keys(integ).filter(id => integ[id].enabled).map(integKey)];
    };
    /** Pour l'interface : réseau actuel, réseaux connus et leurs appareils. */
    ctx.networkInfo = () => {
        const cur = ctx.netWatch.current;
        const nodes = hub.getNodes();
        const label = key => {
            if (key.startsWith("matter:")) return nodes.find(n => nodeKey(n.id) === key)?.name ?? null;
            const id = key.slice(6);
            return integ[id]?.enabled ? INTEG_NAME[id] : null;
        };
        const devicesOf = id =>
            Object.entries(nets.data.devices)
                .filter(([, v]) => v === id)
                .map(([k]) => ({ key: k, name: label(k) }))
                .filter(d => d.name);
        return {
            current: state.currentNet,
            online: !!cur?.online,
            ssid: cur?.ssid ?? null,
            gateway: cur?.gateway ?? null,
            iface: cur?.iface ?? null,
            networks: nets.list().map(n => ({ ...n, here: n.id === state.currentNet, devices: devicesOf(n.id) })),
            everywhere: devicesOf("*"),
            devices: nets.data.devices,
        };
    };
    /** Applique le réseau actuel : appareils des autres réseaux en pause, ceux de ce réseau (re)connectés. */
    ctx.applyNetwork = () => {
        const r = hub.applyNodeFilter();
        for (const id of Object.keys(integ)) {
            const want = integ[id].enabled && isHere(integKey(id));
            if (want && !devices.drivers.has(id)) ctx.startIntegration(id);
            else if (!want && devices.drivers.has(id)) devices.removeDriver(id);
        }
        dispatcher.forget();
        ctx.sync.refresh();
        ctx.pushState();
        return r;
    };
    ctx.onNetworkChange = info => {
        const prev = state.currentNet;
        const n = nets.seen(info);
        state.currentNet = n.id;
        if (prev === state.currentNet) return ctx.pushState();
        // premier réseau vu depuis le démarrage (Mac démarré hors réseau) : les appareils sans réseau sont rattachés à celui-ci
        const claimed = prev === null ? nets.claim(ctx.deviceKeys(), state.currentNet) : 0;
        const r = ctx.applyNetwork();
        const here = ctx.deviceKeys().filter(k => nets.isHere(k, state.currentNet)).length;
        log(
            "info",
            `📶 Réseau « ${n.name} »${info.ssid && info.ssid !== n.name ? ` (Wi-Fi ${info.ssid})` : ""} : ${here} appareil(s) de ce réseau` +
                (r.paused ? `, ${r.paused} en pause (autre réseau)` : "") +
                (claimed ? `, ${claimed} rattaché(s) à ce réseau` : "") +
                ".",
        );
    };

    // ---------------------------------------------------------------- autres systèmes
    ctx.startIntegration = id => {
        devices.removeDriver(id);
        const c = integ[id];
        if (!c?.enabled || !isHere(integKey(id))) return;
        const d = DRIVERS[id](c);
        devices.addDriver(d);
        d.start().catch(e => d.setState("erreur", e.message));
    };
    ctx.integrationsInfo = () => {
        const st = Object.fromEntries(devices.statuses().map(x => [x.id, x]));
        return Object.fromEntries(
            Object.entries(integ).map(([id, c]) => [
                id,
                { ...c, token: c.token ? SECRET : "", password: c.password ? SECRET : "", status: st[id] ?? { state: !c.enabled ? "désactivé" : isHere(integKey(id)) ? "démarrage…" : "en pause (autre réseau)", count: 0 } },
            ]),
        );
    };

    // ---------------------------------------------------------------- lampes (réelles + démo)
    ctx.allLamps = () => {
        const list = [...devices.getLamps(), ...(settings.demo ? DEMO_LAMPS : [])].map((l, i) => {
            const p = (Object.hasOwn(ctx.lampPrefs, l.id) && ctx.lampPrefs[l.id]) || {};
            const key = lampDeviceKey(l);
            return {
                ...l,
                matterName: l.name,
                name: p.alias || l.name,
                hidden: !!p.hidden,
                order: p.order ?? 1000 + i,
                room: ctx.rooms.roomOf(l.id)?.id ?? null,
                network: key ? nets.networkOf(key) ?? null : null,
                elsewhere: !isHere(key), // sur un autre réseau : ni affichée dans l'aperçu, ni pilotée
            };
        });
        return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    };
    ctx.activeLamps = () => ctx.allLamps().filter(l => !l.hidden && !l.elsewhere);

    // ---------------------------------------------------------------- aperçu + envoi
    const preview = (ctx.preview = {}); // lampId -> { on, color, display, brightness }
    const busRate = bus =>
        bus.startsWith("matter:")
            ? hub.isBridge(bus.slice(7))
                ? settings.rate
                : Math.min(settings.rate, DIRECT_MATTER_RATE)
            : bus.startsWith("wiz:")
              ? 15
              : bus === "ha"
                ? 15
                : bus === "z2m"
                  ? Math.max(settings.rate, 10)
                  : settings.rate;
    const dispatcher = (ctx.dispatcher = new Dispatcher({ hub: devices, rate: settings.rate, log, busRate }));
    dispatcher.on("pending", n => ctx.broadcast("pending", n));

    ctx.applyTargets = (targets, fade) => {
        const byId = new Map(ctx.allLamps().map(l => [l.id, l]));
        const changes = {};
        for (const [id, st] of Object.entries(targets)) {
            const lamp = byId.get(id);
            if (!lamp) continue;
            preview[id] = st.on ? { ...st, display: displayColor(st.color, lamp.kind) } : { on: false };
            changes[id] = preview[id];
            if (!lamp.virtual && devices.hasLamp(id)) dispatcher.setTarget(lamp, st, fade);
        }
        ctx.broadcast("preview", { changes, fade });
    };

    const player = (ctx.player = new Player({ apply: ctx.applyTargets, getLamps: ctx.activeLamps }));
    state.playerStatus = player.status; // dernier état de lecture (show manuel ou synchro musique)
    ctx.onPlayer = s => {
        state.playerStatus = s;
        ctx.broadcast("player", s);
    };
    player.on("status", ctx.onPlayer);

    devices.on("changed", lampIds => {
        dispatcher.forget(lampIds); // après un changement de structure/connexion, on renverra tout (à ces lampes-là)
        ctx.pushState();
    });

    // appareil retiré puis réappairé : ses lampes changent de numéro, mais retrouvent leur nom, leur ordre et leur pièce
    const former = readJson(paths.former, {}); // identifiant de l'appareil -> { name, lamps: { endpoint: ancien id } }
    hub.on("nodeRemoved", ({ uid, name, lamps }) => {
        former[uid] = { name, at: Date.now(), lamps: Object.fromEntries(lamps.map(l => [l.endpoint, l.id])) };
        writeJson(paths.former, former);
    });
    hub.on("nodeReady", ({ key, uid, name }) => {
        const f = uid && former[uid];
        if (!f) return;
        const prefs = ctx.lampPrefs;
        let moved = 0;
        for (const l of hub.getLamps().filter(x => x.nodeId === key)) {
            const old = f.lamps[l.endpoint];
            if (!old || old === l.id) continue;
            if (prefs[old] && !prefs[l.id]) prefs[l.id] = prefs[old];
            delete prefs[old];
            const room = ctx.rooms.roomOf(old);
            if (room && !ctx.rooms.roomOf(l.id)) ctx.rooms.assign(l.id, room.id);
            if (room) ctx.rooms.assign(old, null);
            moved++;
        }
        delete former[uid];
        writeJson(paths.former, former);
        ctx.saveLampPrefs();
        if (moved) log("info", `${name} réappairé : ${moved > 1 ? "ses lampes retrouvent leur nom, leur place et leur pièce" : "la lampe retrouve son nom, sa place et sa pièce"}.`);
        ctx.pushState();
    });
    // appareil de nouveau joignable : il reprend tout de suite l'état voulu (couleur d'arrêt, scène fixe…)
    hub.on("nodeBack", key => {
        for (const l of ctx.activeLamps()) {
            const p = preview[l.id];
            if (l.nodeId !== key || !p || l.virtual) continue;
            dispatcher.setTarget(l, p.on ? { on: true, color: p.color, brightness: p.brightness } : { on: false }, 0.5);
        }
    });
}
