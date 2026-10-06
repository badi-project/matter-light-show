// Veille macOS : un seul processus JavaScript (osascript) reste ouvert et signale lecture / pause / morceau suivant
// (Musique, Spotify), apps ouvertes ou fermées, « En cours de lecture » (Deezer, navigateurs…) et sortie de veille.
// La musique est alors relue au bon moment au lieu d'être relue sans cesse. Si la veille ne marche pas, rien ne
// change : les lectures régulières continuent comme avant.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { ON_MAC } from "./macos.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "jxa", "veille.js");
const RENEW = 60 * 60_000; // relancée toutes les heures (un processus JavaScript qui tourne des jours grossit)

export class MacWatch extends EventEmitter {
    proven = false; // a déjà signalé quelque chose : elle fonctionne vraiment
    #child = null;
    #stopped = false;
    #fails = 0;
    #renew = null;

    start() {
        if (!ON_MAC || this.#child || this.#stopped) return;
        let child;
        try {
            child = spawn("osascript", ["-l", "JavaScript", SCRIPT], { stdio: ["ignore", "pipe", "pipe"] });
        } catch (e) {
            this.emit("failed", e.message);
            return this.#retry();
        }
        this.#child = child;
        this.ready = false;
        const startedAt = Date.now();
        let errText = "";
        createInterface({ input: child.stdout }).on("line", line => this.#line(line.trim()));
        child.stderr.on("data", d => (errText = (errText + d).slice(-400)));
        child.on("error", e => (errText ||= e.message));
        child.on("exit", (code, signal) => {
            this.#child = null;
            clearTimeout(this.#renew);
            if (this.#stopped) return;
            // arrêt anormal (pas la relance de chaque heure) : la raison est signalée une fois dans le journal
            if (!this.proven || Date.now() - startedAt < RENEW - 1000) this.emit("failed", (errText.trim() || `arrêtée (${signal ?? `code ${code}`})`) + (this.ready ? "" : " — avant d'avoir démarré"));
            this.proven = false;
            this.emit("down");
            if (Date.now() - startedAt > 60_000) this.#fails = 0; // a tenu un moment : pas une vraie panne
            this.#retry();
        });
        this.#renew = setTimeout(() => child.kill(), RENEW);
        this.#renew.unref?.();
        // toujours rien au bout de 20 s : signalé (la veille reste lancée, au cas où)
        setTimeout(() => {
            if (this.#child === child && !this.proven) this.emit("failed", this.ready ? "lancée mais silencieuse" : `pas de réponse${errText ? ` : ${errText.trim()}` : ""}`);
        }, 20000).unref?.();
    }

    #retry() {
        this.#fails++;
        if (this.#fails > 5) return this.emit("gaveup"); // ne marche pas sur ce Mac : on s'en passe
        setTimeout(() => this.start(), Math.min(10 * 60_000, 5000 * 2 ** this.#fails)).unref?.();
    }

    #line(line) {
        if (!line) return;
        const [kind, ...rest] = line.split(" ");
        if (kind === "ready") {
            this.ready = true;
            return this.emit("ready");
        }
        if (!this.proven && kind !== "app") {
            this.proven = true; // une vraie information de lecture est arrivée
            this.emit("proven");
        }
        if (kind === "music" || kind === "spotify") this.emit("music", kind);
        else if (kind === "app") this.emit("app", rest[0], rest[1] === "on");
        else if (kind === "wake") this.emit("wake");
        else if (kind === "np") {
            let info = null;
            try {
                info = JSON.parse(rest.join(" "));
            } catch {}
            this.emit("nowplaying", info);
        }
    }

    get alive() {
        return !!this.#child;
    }

    stop() {
        this.#stopped = true;
        clearTimeout(this.#renew);
        this.#child?.kill();
    }
}
