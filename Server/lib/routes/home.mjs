// API : réseaux (plusieurs Wi-Fi), autres systèmes (WiZ, Home Assistant, Zigbee2MQTT) et pièces.
import { integKey, SECRET } from "../app/lamps.mjs";

export default ctx => {
    const { nets, integ, devices, rooms, log, state } = ctx;
    return {
        // ---------- réseaux
        "PATCH /api/networks/:id": async ({ params, body }) => {
            nets.rename(params.id, body.name);
            ctx.pushState();
            return { ok: true };
        },
        // « ce réseau est le même que celui-ci » (nouvelle box…) : ses appareils passent sur le réseau actuel
        "POST /api/networks/:id/merge": async ({ params }) => {
            if (!state.currentNet) throw new Error("Le Mac n'est sur aucun réseau pour l'instant");
            const moved = nets.merge(params.id, state.currentNet);
            log("info", `${moved} appareil(s) rattaché(s) au réseau « ${nets.get(state.currentNet)?.name} ».`);
            ctx.applyNetwork();
            return { ok: true, moved };
        },
        "DELETE /api/networks/:id": async ({ params }) => {
            if (params.id === state.currentNet) throw new Error("C'est le réseau actuel du Mac : impossible de l'oublier");
            nets.forget(params.id);
            ctx.applyNetwork();
            return { ok: true };
        },
        // rattacher un appareil (« matter:1 », « integ:wiz ») à un réseau, ou à tous (« * »)
        "PUT /api/devices/network": async ({ body }) => {
            const key = String(body.key ?? "");
            if (!/^(matter:\d+|integ:(wiz|ha|z2m))$/.test(key)) throw new Error("Appareil inconnu");
            nets.assign(key, body.network === "*" ? "*" : String(body.network ?? ""));
            ctx.applyNetwork();
            return { ok: true };
        },

        // ---------- autres systèmes
        "GET /api/integrations": async () => ctx.integrationsInfo(),
        "PUT /api/integrations/:id": async ({ params, body }) => {
            const c = Object.hasOwn(integ, params.id) ? integ[params.id] : null;
            if (!c) throw new Error("Système inconnu");
            const keep = (k, v) => (v === SECRET ? c[k] : String(v ?? "").trim());
            if ("enabled" in body) c.enabled = !!body.enabled;
            if (c.enabled && state.currentNet && nets.networkOf(integKey(params.id)) === undefined) nets.assign(integKey(params.id), state.currentNet);
            if (params.id === "wiz" && "ips" in body)
                c.ips = String(body.ips ?? "")
                    .split(/[\s,;]+/)
                    .filter(x => /^\d{1,3}(\.\d{1,3}){3}$/.test(x))
                    .slice(0, 50);
            if (params.id === "ha") {
                if ("url" in body) c.url = String(body.url ?? "").trim();
                if ("token" in body) c.token = keep("token", body.token);
            }
            if (params.id === "z2m") {
                if ("host" in body) c.host = String(body.host ?? "").trim();
                if ("port" in body) c.port = Number(body.port) || 1883;
                if ("username" in body) c.username = String(body.username ?? "").trim();
                if ("password" in body) c.password = keep("password", body.password);
                if ("base" in body) c.base = String(body.base ?? "").trim() || "zigbee2mqtt";
            }
            ctx.saveInteg();
            ctx.startIntegration(params.id);
            ctx.pushState();
            return ctx.integrationsInfo()[params.id];
        },
        "POST /api/integrations/:id/refresh": async ({ params }) => {
            const d = devices.drivers.get(params.id);
            if (!d) throw new Error(ctx.integ[params.id]?.enabled ? "En pause : ce système est rattaché à un autre réseau Wi-Fi" : "Système désactivé");
            if (d.discover) d.discover();
            else if (d.refresh) await d.refresh();
            ctx.pushState();
            return { ok: true };
        },

        // ---------- pièces
        "POST /api/rooms": async ({ body }) => {
            const r = rooms.add(body.name, Array.isArray(body.speakers) ? body.speakers : []);
            ctx.roomsChanged();
            return r;
        },
        "PATCH /api/rooms/:id": async ({ params, body }) => {
            const r = rooms.update(params.id, body);
            ctx.roomsChanged();
            return r;
        },
        "DELETE /api/rooms/:id": async ({ params }) => {
            rooms.remove(params.id);
            ctx.roomsChanged();
            return { ok: true };
        },
        "POST /api/rooms/order": async ({ body }) => {
            rooms.order(Array.isArray(body.ids) ? body.ids : []);
            ctx.roomsChanged();
            return { ok: true };
        },
        "POST /api/rooms/auto": async () => {
            await ctx.refreshSpeakers({ names: true });
            const r = rooms.autoFill(ctx.allLamps().filter(l => !l.elsewhere), state.speakerNames);
            ctx.roomsChanged();
            return r;
        },
        "POST /api/lamps/:id/room": async ({ params, body }) => {
            rooms.assign(params.id, body.room || null);
            ctx.roomsChanged();
            return { ok: true };
        },
    };
};
