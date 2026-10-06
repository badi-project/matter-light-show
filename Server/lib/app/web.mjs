// Serveur web : page, API, mises à jour en direct ; accès depuis le téléphone (clé, code) ; écoute sur le Mac seul
// ou sur tout le réseau local.
import { createServer } from "node:http";
import { extname } from "node:path";
import { createReadStream } from "node:fs";
import { RemoteAccess, isLoopback, loginPage, qrSvg } from "../remote.mjs";
import { trackKey } from "../tempo.mjs";
import { readJson, writeJson } from "../util.mjs";
import { MIME, Router, StaticFiles, readBody, send, sendHtml } from "./http.mjs";

const MANIFEST = JSON.stringify({
    name: "Show lumière",
    short_name: "Lumière",
    display: "standalone",
    background_color: "#0d0f14",
    theme_color: "#0d0f14",
    icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
});

export function createWeb(ctx, routeModules) {
    const { settings, events, log, paths, port: PORT } = ctx;
    const router = new Router();
    for (const m of routeModules) router.add(m(ctx));
    const files = new StaticFiles(paths.public);
    ctx.pageBuild = () => files.build();
    const remote = (ctx.remote = new RemoteAccess({ read: () => readJson(paths.access, null), write: d => writeJson(paths.access, d), port: PORT, log }));

    async function handle(req, res) {
        const url = new URL(req.url, "http://localhost");
        const path = url.pathname;
        const local = isLoopback(req.socket.remoteAddress);

        // le Mac lui-même : seulement sous ses propres noms (bloque les sites qui se font passer pour « localhost »)
        const hostName = String(req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "");
        if (local && hostName && !remote.knownHosts().has(hostName)) return sendHtml(res, 403, "Adresse non reconnue : ouvre http://localhost:" + PORT);
        // pas de commande envoyée par un autre site
        if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
            let same = false;
            try {
                same = new URL(req.headers.origin).host.toLowerCase() === String(req.headers.host ?? "").toLowerCase();
            } catch {}
            if (!same) return send(res, 403, { error: "Requête refusée (envoyée par un autre site)." });
        }

        // icônes et manifeste (écran d'accueil du téléphone) : publics
        if (path === "/manifest.webmanifest") {
            res.writeHead(200, { "Content-Type": "application/manifest+json", "Cache-Control": "private, max-age=86400" });
            return res.end(MANIFEST);
        }
        const isPublic = /^\/icons\/[\w-]+\.png$/.test(path);

        // téléphone ou autre appareil du réseau : clé (QR code / cookie) ou code à 6 chiffres
        if (!local && !isPublic) {
            if (!settings.remote.enabled) {
                if (path.startsWith("/api/")) return send(res, 403, { error: "Contrôle depuis le téléphone désactivé (Réglages › Téléphone, sur le Mac)." });
                return sendHtml(res, 403, loginPage({ enabled: false }));
            }
            if (path === "/api/remote/login" && req.method === "POST") {
                try {
                    const r = remote.login((await readBody(req)).pin, req.socket.remoteAddress);
                    res.setHeader("Set-Cookie", remote.cookieHeader());
                    log("info", `📱 Nouvel appareil connecté avec le code (${req.socket.remoteAddress.replace(/^::ffff:/, "")}).`);
                    return send(res, 200, r);
                } catch (e) {
                    return send(res, e.status ?? 400, { error: e.message });
                }
            }
            const auth = remote.check(req, url);
            if (!auth.ok) {
                if (path.startsWith("/api/")) return send(res, 401, { error: "Téléphone pas encore autorisé : scanne le QR code affiché sur le Mac." });
                return sendHtml(res, 401, loginPage({ enabled: true }));
            }
            if (auth.setCookie) {
                res.setHeader("Set-Cookie", remote.cookieHeader());
                if (auth.fresh) log("info", `📱 Nouvel appareil connecté (${req.socket.remoteAddress.replace(/^::ffff:/, "")}).`);
            }
        }

        // connexion au compte Spotify : aller-retour avec la page de Spotify (sur le Mac)
        if (path === "/api/spotify/login" || path === "/api/spotify/callback") {
            if (!local) return sendHtml(res, 403, "La connexion à Spotify se fait sur le Mac.");
            try {
                if (path.endsWith("login")) {
                    res.writeHead(302, { Location: ctx.spotifyWeb.loginUrl() });
                    return res.end();
                }
                await ctx.spotifyWeb.callback(url.searchParams);
                log("success", `Spotify connecté${ctx.spotifyWeb.cfg.user ? ` (compte ${ctx.spotifyWeb.cfg.user})` : ""} : les lumières suivent aussi Spotify sur tes autres appareils.`);
                ctx.music.refresh().catch(() => {});
                res.writeHead(302, { Location: `http://localhost:${PORT}/?spotify=ok` });
                return res.end();
            } catch (e) {
                log("error", `Connexion à Spotify impossible : ${e.message}`);
                res.writeHead(302, { Location: `http://localhost:${PORT}/?spotify=erreur` });
                return res.end();
            }
        }

        if (path === "/api/events") {
            return events.attach(req, res, {
                remote: !local,
                first: ctx.snapshot({ withLogs: true }),
                onChange: () => events.broadcast("remote", { phones: events.phones }), // le Mac voit qu'un téléphone est connecté
            });
        }

        // pochette et extrait du morceau (fichiers en cache) : envoyés par morceaux, gardés une heure par le navigateur
        if (path === "/api/music/cover" || path === "/api/music/preview") {
            const key = url.searchParams.get("key") || trackKey(ctx.music.state.track);
            const f = ctx.songs.file(key, path.endsWith("cover") ? "cover" : "preview");
            if (!f) {
                res.writeHead(404);
                return res.end();
            }
            res.writeHead(200, { "Content-Type": MIME[extname(f)] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" });
            return createReadStream(f)
                .on("error", () => res.destroy())
                .pipe(res);
        }

        if (path.startsWith("/api/")) {
            const m = router.match(req.method, path);
            if (!m) return send(res, 404, { error: "Route inconnue" });
            if (m.bad) return send(res, 400, { error: "Adresse mal formée" });
            try {
                const data = await m.handler({ params: m.params, body: req.method === "GET" ? {} : await readBody(req), local });
                return send(res, 200, data, req);
            } catch (e) {
                return send(res, e.status ?? 400, { error: e.message });
            }
        }

        // fichiers de la page
        if (!["GET", "HEAD"].includes(req.method) || !files.serve(req, res, path, url.searchParams)) {
            res.writeHead(404);
            res.end("Introuvable");
        }
    }

    // une erreur dans une requête ne doit jamais arrêter le logiciel
    const server = createServer((req, res) =>
        handle(req, res).catch(e => {
            console.error("Requête :", e);
            if (!res.headersSent) send(res, 500, { error: "Erreur interne" });
            else res.destroy();
        }),
    );
    let listenBusy = false;
    server.on("error", e => listenBusy || console.error("Serveur :", e.message));

    // ---------------------------------------------------------------- écoute : Mac seul, ou tout le réseau local (téléphone)
    const wantedHost = () => process.env.HOST || (settings.remote.enabled ? "::" : "127.0.0.1");
    function listenOn(host) {
        return new Promise((resolve, reject) => {
            const onErr = e => {
                server.off("listening", onOk);
                reject(e);
            };
            const onOk = () => {
                server.off("error", onErr);
                resolve();
            };
            server.once("error", onErr);
            server.once("listening", onOk);
            listenBusy = true;
            server.listen(PORT, host);
        }).finally(() => (listenBusy = false));
    }
    /** (Ré)ouvre le port sur la bonne adresse ; les pages déjà connectées restent connectées. */
    ctx.applyListen = async () => {
        const want = wantedHost();
        if (ctx.state.listeningHost === want) return;
        if (ctx.state.listeningHost !== null) server.close();
        let last;
        for (const h of want === "::" ? ["::", "0.0.0.0"] : [want]) {
            try {
                await listenOn(h);
                ctx.state.listeningHost = want;
                return;
            } catch (e) {
                last = e;
                if (e.code === "EADDRINUSE") break;
            }
        }
        if (want !== "127.0.0.1" && !process.env.HOST && last?.code !== "EADDRINUSE") {
            settings.remote.enabled = false; // retour au Mac seul
            ctx.saveSettings();
            await listenOn("127.0.0.1");
            ctx.state.listeningHost = "127.0.0.1";
            log("error", `Ouverture au réseau impossible (${last?.message}) : le show reste accessible depuis le Mac seulement.`);
            return;
        }
        throw last;
    };
    ctx.remoteInfo = () => ({
        enabled: !!settings.remote.enabled,
        keepAwake: !!settings.remote.keepAwake,
        listening: ctx.state.listeningHost,
        pin: remote.pin,
        phones: events.phones,
        links: remote.links().map(l => ({ kind: l.kind, base: l.base, url: l.url, qr: qrSvg(l.url) })),
    });
    return server;
}
