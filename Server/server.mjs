// Show de lumière 100 % Matter — serveur local (contrôleur Matter + interface web).
// Lancer :  npm start   puis ouvrir http://localhost:8321
//
// Organisation :
//   lib/app/context.mjs  le logiciel en un objet (réglages, état partagé, état complet pour la page)
//   lib/app/lamps.mjs    appareils Matter et autres systèmes, réseaux, aperçu, envoi des commandes
//   lib/app/music.mjs    sources de musique, synchro, enceintes qui jouent, fichiers des shows
//   lib/app/power.mjs    marche / arrêt, Mac éveillé, service macOS
//   lib/app/web.mjs      serveur web, accès téléphone ; lib/routes/*.mjs : l'API, par thème
import { Logger } from "@matter/main";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext } from "./lib/app/context.mjs";
import { createWeb } from "./lib/app/web.mjs";
import audioRoutes from "./lib/routes/audio.mjs";
import homeRoutes from "./lib/routes/home.mjs";
import lampRoutes from "./lib/routes/lamps.mjs";
import musicRoutes from "./lib/routes/music.mjs";
import showRoutes from "./lib/routes/shows.mjs";
import systemRoutes from "./lib/routes/system.mjs";
import { withTimeout } from "./lib/util.mjs";
import { RELEASE_DATE, VERSION } from "./lib/version.mjs";

Logger.level = process.env.MATTER_DEBUG ? "info" : "error";
// pour comprendre une lampe qui décroche : pertes de connexion, changements d'adresse, reconnexions (journal data/serveur.log)
if (!process.env.MATTER_DEBUG) Logger.facilityLevels = { PairedNode: "info", PeerAddressMonitor: "info", PeerConnection: "warn", Peer: "warn" };

const PORT = Number(process.env.PORT) || 8321;
const ctx = createContext({ root: dirname(fileURLToPath(import.meta.url)), port: PORT });
createWeb(ctx, [systemRoutes, lampRoutes, showRoutes, musicRoutes, audioRoutes, homeRoutes]);
const { settings, music, sync, sonos, netWatch, hub, nets, log, state } = ctx;

// une erreur oubliée quelque part ne doit pas arrêter le show
process.on("unhandledRejection", e => console.error("Erreur non traitée :", e));

// 1. la page répond tout de suite
ctx.applyListen()
    .then(() => {
        console.log(`\n  ✨ Show lumière Matter ${VERSION} prêt → http://localhost:${PORT}\n     (Ctrl+C pour arrêter)\n`);
        log("info", `Show lumière ${VERSION}${RELEASE_DATE ? ` (${RELEASE_DATE})` : ""} démarré.`);
        if (settings.remote.enabled) setTimeout(() => log("info", `📱 Contrôle depuis le téléphone : ${ctx.remote.links()[0]?.base ?? ""}`), 1500);
    })
    .catch(e => {
        if (e.code === "EADDRINUSE") console.error(`\nLe port ${PORT} est déjà utilisé : le show tourne peut-être déjà. Ouvre http://localhost:${PORT}\n`);
        else console.error(e);
        process.exit(1);
    });

// 2. la musique, puis le mode de synchro choisi la dernière fois (sauf si le show a été arrêté)
music.start();
ctx.macWatch.start();
if (settings.syncChoice) sync.setChoice(settings.syncChoice);
if (settings.syncEnabled && !settings.standby) sync.setEnabled(true);
ctx.updateKeepAwake();

// 3. le réseau actuel (4 s au plus) : seuls les appareils de ce réseau sont connectés
{
    const first = await withTimeout(netWatch.refresh(), 4000).catch(() => null);
    if (first?.id) state.currentNet = nets.seen(first).id;
}
netWatch.on("change", info => {
    ctx.onNetworkChange(info);
    sonos.refresh(true).catch(() => {}); // les enceintes Sonos dépendent du réseau
});
netWatch.on("offline", () => {
    log("warn", "Le Mac n'est plus connecté à aucun réseau.");
    ctx.pushState();
});
netWatch.on("online", () => ctx.pushState());
netWatch.start();
sonos
    .refresh(true)
    .then(p => p.length && log("info", `Sonos : ${p.length} enceinte(s) trouvée(s) (${p.map(x => x.room).join(", ")}).`))
    .catch(() => {});
setInterval(() => sonos.refresh().catch(() => {}), 300000).unref?.();

// 4. les autres systèmes, puis le contrôleur Matter
for (const id of Object.keys(ctx.integ)) ctx.startIntegration(id);
hub.start()
    .then(() => {
        // appareils installés avant la gestion des réseaux : rattachés au réseau actuel
        const n = nets.claim(ctx.deviceKeys(), state.currentNet);
        if (n) log("info", `${n} appareil(s) rattaché(s) au réseau « ${nets.get(state.currentNet)?.name} ».`);
        ctx.pushState();
    })
    .catch(e => {
        hub.error = e.message;
        log("error", `Le contrôleur Matter n'a pas pu démarrer : ${e.message}`);
        ctx.pushState();
    });

process.on("SIGINT", () => ctx.shutdown(0));
process.on("SIGTERM", () => ctx.shutdown(0));
