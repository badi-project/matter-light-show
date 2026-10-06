// API : appareils Matter (appairage, retrait), lampes (nom, ordre, visibilité, essai), réglage direct.
import { MatterHub, pairingErrorMessage } from "../matter.mjs";
import { nodeKey } from "../app/lamps.mjs";

export default ctx => {
    const { hub, nets, dispatcher, log, state } = ctx;
    /** Réglages d'une lampe (jamais un nom spécial comme « __proto__ »). */
    const prefsOf = id => {
        const k = String(id);
        if (!Object.hasOwn(ctx.lampPrefs, k)) Object.defineProperty(ctx.lampPrefs, k, { value: {}, enumerable: true, writable: true, configurable: true });
        return ctx.lampPrefs[k];
    };
    return {
        "POST /api/pair": async ({ body }) => {
            const code = body.code;
            MatterHub.parseCode(code); // valide avant de lancer
            hub.pair(code)
                .then(id => {
                    if (state.currentNet) nets.assign(nodeKey(id), state.currentNet); // un nouvel appareil appartient au réseau actuel
                    ctx.pushState();
                })
                .catch(e => log("error", `Appairage échoué : ${pairingErrorMessage(e)}`));
            return { ok: true };
        },
        // retrait : jamais bloquant (une lampe injoignable est retirée quand même, en local) ; le résultat arrive dans le journal
        "DELETE /api/nodes/:id": async ({ params }) => {
            hub.removeNode(params.id)
                .then(() => nets.unassign(nodeKey(params.id)))
                .catch(e => log("error", `Retrait impossible : ${e.message}`))
                .finally(() => ctx.pushState());
            return { ok: true };
        },

        "PATCH /api/lamps/:id": async ({ params, body }) => {
            const p = prefsOf(params.id);
            if ("alias" in body) p.alias = String(body.alias ?? "").slice(0, 60);
            if ("hidden" in body) p.hidden = !!body.hidden;
            ctx.saveLampPrefs();
            ctx.pushState();
            return { ok: true };
        },
        "POST /api/lamps/order": async ({ body }) => {
            (Array.isArray(body.ids) ? body.ids : []).forEach((id, i) => (prefsOf(id).order = i));
            ctx.saveLampPrefs();
            ctx.pushState();
            return { ok: true };
        },
        "POST /api/lamps/:id/identify": async ({ params }) => {
            const lamp = ctx.allLamps().find(l => l.id === params.id);
            if (!lamp) throw new Error("Lampe inconnue");
            ctx.broadcast("identify", { id: lamp.id });
            if (!lamp.virtual) dispatcher.identify(lamp);
            return { ok: true };
        },
        // réglage immédiat (hors show) : { ids?: [...], state: {on,color,brightness}, fade }
        "POST /api/direct": async ({ body }) => {
            ctx.player.stop();
            ctx.stopSync();
            const ids = body.ids?.length ? body.ids : ctx.activeLamps().map(l => l.id);
            const targets = Object.fromEntries(ids.map(id => [id, body.state ?? { on: false }]));
            ctx.applyTargets(targets, Number(body.fade) || 0.4);
            return { ok: true };
        },
    };
};
