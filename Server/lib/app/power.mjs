// Marche / arrêt du show, Mac gardé éveillé, service macOS en arrière-plan, fermeture du logiciel.
import { spawn } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { SERVICE_LOG, installService, serviceInstalled, uninstallService } from "../service.mjs";
import { sleep } from "../util.mjs";

const STOP_DEFAULT = { color: "2700K", brightness: 60 };

export function setupPower(ctx) {
    const { settings, log, state } = ctx;

    /** service = lancé par macOS en arrière-plan ; terminal = fenêtre « Lancer le show » ; manuel = node à la main. */
    ctx.serviceMode = () => (process.env.SHOW_SERVICE === "app" ? "app" : process.env.SHOW_SERVICE === "launchd" ? "service" : process.env.SHOW_LAUNCHER === "1" ? "terminal" : "manuel");
    ctx.serviceInstalled = () => ctx.serviceMode() !== "app" && serviceInstalled(); // en mode app, l'app gère le démarrage avec le Mac
    try {
        if (ctx.serviceMode() === "service" && statSync(SERVICE_LOG).size > 5e6) writeFileSync(SERVICE_LOG, ""); // journal raisonnable
    } catch {}

    /** Toutes les lampes du show dans la couleur « d'arrêt » (réglable). */
    ctx.uniformTargets = () => {
        const c = settings.stopColor ?? STOP_DEFAULT;
        const st = c.color === "off" ? { on: false } : { on: true, color: c.color, brightness: c.brightness ?? 60 };
        return Object.fromEntries(ctx.activeLamps().map(l => [l.id, st]));
    };

    ctx.enterStandby = () => {
        if (!settings.standby) settings.syncBeforeStop = ctx.sync.enabled;
        ctx.player.stop(false);
        if (ctx.sync.enabled) ctx.sync.setEnabled(false);
        ctx.applyTargets(ctx.uniformTargets(), 2);
        settings.standby = true;
        ctx.saveSettings();
        const c = settings.stopColor ?? {};
        log("info", `Show arrêté : toutes les lumières ${c.color === "off" ? "éteintes" : `en ${c.color} (${c.brightness} %)`}.`);
        ctx.updateKeepAwake();
        ctx.pushState();
    };

    ctx.leaveStandby = ({ resume = true } = {}) => {
        if (!settings.standby) return;
        settings.standby = false;
        if (resume && settings.syncBeforeStop) ctx.sync.setEnabled(true);
        ctx.saveSyncSettings();
        log("info", "Show redémarré.");
        ctx.updateKeepAwake();
        ctx.pushState();
    };

    ctx.quitAfterDrain = async () => {
        const t0 = Date.now();
        while (ctx.dispatcher.pending > 0 && Date.now() - t0 < 5000) await sleep(200);
        await sleep(600);
        ctx.shutdown(0); // code 0 : le service ne se relance pas tout seul
    };

    // garder le Mac éveillé seulement quand un show tourne, ou pour le téléphone (caffeinate s'arrête avec ce processus)
    let caffeinate = null;
    ctx.updateKeepAwake = () => {
        if (process.platform !== "darwin") return;
        const want = (!settings.standby && (ctx.sync.enabled || !!state.playerStatus?.playing)) || (settings.remote.enabled && settings.remote.keepAwake);
        if (want && !caffeinate) {
            try {
                caffeinate = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
                caffeinate.on("exit", () => (caffeinate = null));
                caffeinate.on("error", () => (caffeinate = null));
            } catch {}
        } else if (!want && caffeinate) {
            caffeinate.kill();
            caffeinate = null;
        }
    };
    // un show qui démarre ou s'arrête change le besoin : vérifié à chaque changement de lecture, plus une fois par minute
    ctx.player.on("status", () => ctx.updateKeepAwake());
    ctx.sync.on("player", () => ctx.updateKeepAwake());
    setInterval(ctx.updateKeepAwake, 60000).unref?.();

    /** Installe (ou met à jour) le service macOS : démarre avec le Mac, se relance tout seul, sans fenêtre Terminal. */
    ctx.installServiceNow = () => {
        if (ctx.serviceMode() === "app") throw new Error("Le démarrage avec le Mac est géré par l'app Show lumière (icône de la barre des menus › Ouvrir au démarrage du Mac).");
        installService({ delay: 2 }); // le service prend le relais une fois ce processus-ci fermé (port libéré)
        log("info", "Passage en arrière-plan : le logiciel redémarre en service macOS…");
        if (ctx.serviceMode() !== "service") setTimeout(() => ctx.shutdown(0), 800);
        return { ok: true };
    };
    ctx.uninstallServiceNow = () => {
        if (ctx.serviceMode() === "app") throw new Error("Le démarrage avec le Mac est géré par l'app Show lumière (icône de la barre des menus › Ouvrir au démarrage du Mac).");
        uninstallService();
        log("info", "Le logiciel ne démarrera plus tout seul avec le Mac.");
        return { ok: true };
    };

    ctx.shutdown = async (code = 0) => {
        console.log(code === 75 ? "\nRedémarrage…" : "\nArrêt…");
        ctx.player.stop(false);
        ctx.sync.setEnabled(false);
        ctx.music.stop();
        ctx.macWatch?.stop();
        caffeinate?.kill();
        for (const id of [...ctx.devices.drivers.keys()]) ctx.devices.removeDriver(id);
        try {
            await ctx.hub.close();
        } catch {}
        process.exit(typeof code === "number" ? code : 0);
    };
}
