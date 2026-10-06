// API : état, accès téléphone, marche/arrêt, service macOS, redémarrage et réglages.
import { isHex, isKelvin } from "../palette.mjs";
import { SOURCE_CHOICES } from "../sources.mjs";
import { clamp } from "../util.mjs";
import { VERSION } from "../version.mjs";

export default ctx => {
    const { settings, sync, dispatcher, music, events, log, onlyMac } = ctx;
    return {
        "GET /api/state": () => ctx.snapshot({ withLogs: true }),
        "GET /api/whoami": async ({ local }) => ({ local }),
        // contrôle depuis le téléphone : QR code, code et adresses (affichés seulement sur le Mac)
        "GET /api/remote": async ({ local }) => {
            onlyMac(local, "L'affichage du QR code");
            return ctx.remoteInfo();
        },
        "POST /api/remote/reset": async ({ local }) => {
            onlyMac(local, "Le changement de clé");
            ctx.remote.reset();
            return ctx.remoteInfo();
        },

        // relance du serveur (après une mise à jour) : le service macOS (ou le lanceur) le redémarre aussitôt
        "POST /api/restart": async () => {
            if (process.env.SHOW_LAUNCHER !== "1") throw new Error("Redémarrage automatique indisponible : relance « Show lumière ».");
            log("info", "Redémarrage du logiciel demandé…");
            setTimeout(() => ctx.shutdown(75), 400);
            return { ok: true };
        },
        // diagnostic (sur le Mac) : commandes acceptées / refusées par lampe, veille macOS, mémoire
        "GET /api/diag": async ({ local }) => {
            onlyMac(local, "Le diagnostic");
            const m = process.memoryUsage();
            return {
                version: VERSION,
                uptime: Math.round(process.uptime()),
                memoryMB: { rss: Math.round(m.rss / 1048576), heap: Math.round(m.heapUsed / 1048576) },
                macWatch: { alive: !!ctx.macWatch?.alive, proven: !!ctx.macWatch?.proven, musicWatched: !!music.watched },
                commands: dispatcher.report(),
                matter: ctx.hub.readStates(), // état rapporté par les lampes Matter (on, niveau 1-254, x/y sur 65536, mireds)
            };
        },
        // résumé léger pour l'app Mac (barre des menus, vérification après migration) : lecture seule
        "GET /api/app/status": async ({ local }) => {
            onlyMac(local, "L'état de l'app");
            const lamps = ctx.allLamps();
            const st = music.state ?? {};
            const ps = ctx.state.playerStatus;
            return {
                version: VERSION,
                service: ctx.serviceMode(),
                pid: process.pid,
                standby: !!settings.standby,
                matter: { ready: !!ctx.hub.ready, error: ctx.hub.error ?? null, nodes: ctx.hub.getNodes().length },
                lamps: { total: lamps.length, reachable: lamps.filter(l => l.reachable !== false).length },
                sync: { enabled: !!sync.enabled, choice: sync.choice ?? null },
                player: { playing: !!ps?.playing, showId: ps?.showId ?? null, showName: ps?.showId ? ctx.shows.list().find(s => s.id === ps.showId)?.name ?? null : null },
                music: { playing: !!st.playing, status: st.status ?? null, title: st.track?.name ?? null, artist: st.track?.artist ?? null, source: music.info?.().name ?? null },
                pages: events.pages,
            };
        },
        "GET /api/ping": async () => ({ ok: true, version: VERSION, service: ctx.serviceMode(), standby: !!settings.standby, pid: process.pid, pages: events.pages }), // pages ouvertes sur le Mac
        // marche / arrêt du show : à l'arrêt, toutes les lampes prennent la même couleur
        "POST /api/power": async ({ body, local }) => {
            const a = body.action;
            if (a === "quit" && !local) throw Object.assign(new Error("Depuis le téléphone, utilise « Arrêter » : « Quitter » fermerait le logiciel et tu ne pourrais plus le relancer à distance."), { status: 403 });
            if (a === "stop") ctx.enterStandby();
            else if (a === "start") ctx.leaveStandby();
            else if (a === "quit") {
                ctx.enterStandby();
                log("info", "Fermeture du logiciel…");
                setTimeout(ctx.quitAfterDrain, 300);
            } else throw new Error("Action inconnue");
            return { ok: true, standby: !!settings.standby };
        },
        "POST /api/service/install": async ({ local }) => (onlyMac(local), ctx.installServiceNow()),
        "POST /api/service/uninstall": async ({ local }) => (onlyMac(local), ctx.uninstallServiceNow()),

        "PATCH /api/settings": async ({ body }) => {
            if ("rate" in body) {
                settings.rate = clamp(Number(body.rate) || 10, 1, 50);
                dispatcher.setRate(settings.rate);
            }
            if ("demo" in body) settings.demo = !!body.demo;
            if ("musicLead" in body) settings.musicLead = clamp(Number(body.musicLead) || 0, -3, 3);
            if ("rhythmIntensity" in body) settings.rhythmIntensity = ["doux", "moyen", "fort", "aucun"].includes(body.rhythmIntensity) ? body.rhythmIntensity : "auto";
            if ("coherence" in body) settings.coherence = ["ambiance", "vague", "piece"].includes(body.coherence) ? body.coherence : "off";
            if ("speakerLink" in body) {
                settings.speakerLink = !!body.speakerLink;
                if (settings.speakerLink) ctx.refreshSpeakers();
            }
            if ("stopColor" in body && body.stopColor) {
                const c = String(body.stopColor.color ?? settings.stopColor?.color ?? "2700K");
                settings.stopColor = {
                    color: c === "off" || /^#[0-9a-f]{6}$/i.test(c) || /^\d{4,5}K$/i.test(c) ? c : "2700K",
                    brightness: clamp(Number(body.stopColor.brightness ?? settings.stopColor?.brightness ?? 60), 1, 100),
                };
                if (settings.standby) ctx.applyTargets(ctx.uniformTargets(), 1);
            }
            if ("otherRooms" in body) settings.otherRooms = ["blanc", "eteint", "inchange"].includes(body.otherRooms) ? body.otherRooms : "blanc";
            if ("myColors" in body && Array.isArray(body.myColors)) {
                settings.myColors = body.myColors
                    .map(c => String(c))
                    .filter(c => isHex(c) || isKelvin(c))
                    .slice(0, 6);
            }
            if ("musicSource" in body && Object.hasOwn(SOURCE_CHOICES, body.musicSource)) {
                settings.musicSource = body.musicSource;
                await music.setChoice(body.musicSource).catch(() => {});
                ctx.refreshSpeakers();
            }
            let remoteChanged = false;
            if (body.remote && typeof body.remote === "object") {
                const was = !!settings.remote.enabled;
                if ("enabled" in body.remote) settings.remote.enabled = !!body.remote.enabled;
                if ("keepAwake" in body.remote) settings.remote.keepAwake = !!body.remote.keepAwake;
                remoteChanged = was !== settings.remote.enabled;
            }
            sync.refresh();
            ctx.saveSettings();
            if (remoteChanged) {
                if (!settings.remote.enabled) events.closePhones(); // les téléphones sont déconnectés
                await ctx.applyListen().catch(e => log("error", `Ouverture au réseau impossible : ${e.message}`));
                log("info", settings.remote.enabled ? `📱 Contrôle depuis le téléphone activé : ${ctx.remote.links()[0]?.base ?? ""}` : "Contrôle depuis le téléphone désactivé.");
            }
            ctx.updateKeepAwake();
            ctx.pushState();
            return { ok: true };
        },
    };
};
