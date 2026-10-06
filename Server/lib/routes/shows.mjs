// API : shows (liste, lecture, édition) et lecture manuelle (lancer, tester une étape, arrêter).
import { randomUUID } from "node:crypto";

export default ctx => {
    const { shows, player, sync } = ctx;
    return {
        "GET /api/shows": () => shows.list(),
        "GET /api/shows/:id": ({ params }) => {
            const s = shows.load(params.id);
            if (!s) throw Object.assign(new Error("Show introuvable"), { status: 404 });
            return s;
        },
        "POST /api/shows": async ({ body }) => {
            const id = shows.safeId(body.id) || `show-${randomUUID().slice(0, 8)}`;
            const show = { name: "Nouveau show", loop: true, speed: 1, steps: [], ...body, id };
            shows.save(id, show);
            ctx.pushState();
            return show;
        },
        "PUT /api/shows/:id": async ({ params, body }) => {
            const id = shows.safeId(params.id);
            const show = { ...body, id };
            shows.save(id, show);
            player.update(show);
            sync.refresh();
            ctx.broadcast("shows", shows.list());
            return { ok: true };
        },
        "DELETE /api/shows/:id": async ({ params }) => {
            shows.remove(params.id);
            if (player.status.showId === params.id) player.stop();
            ctx.pushState();
            return { ok: true };
        },

        "POST /api/play": async ({ body }) => {
            const show = body.show ?? shows.load(body.id);
            if (!show) throw new Error("Show introuvable");
            ctx.stopSync();
            ctx.leaveStandby({ resume: false });
            player.play(show, Number(body.from) || 0);
            return { ok: true };
        },
        "POST /api/step": async ({ body }) => {
            const show = body.show ?? shows.load(body.id);
            ctx.stopSync();
            player.applyStep(show, Number(body.index) || 0);
            return { ok: true };
        },
        "POST /api/stop": async () => {
            player.stop();
            return { ok: true };
        },
    };
};
