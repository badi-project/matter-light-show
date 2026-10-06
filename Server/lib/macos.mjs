// Outils macOS : lancer une commande, AppleScript / JavaScript pour l'automatisation (osascript), apps ouvertes.
import { execFile } from "node:child_process";

export const IS_DARWIN = process.platform === "darwin";
/** Sur Mac (ou en test avec de faux outils : SHOW_OSASCRIPT_TEST=1). */
export const ON_MAC = IS_DARWIN || !!process.env.SHOW_OSASCRIPT_TEST;
/** Vrai Mac (pas de faux outils) : on peut vérifier qu'une app est ouverte avant de lui parler. */
export const REAL_MAC = IS_DARWIN && !process.env.SHOW_OSASCRIPT_TEST;

/** Lance une commande ; ne rejette jamais : { ok, out, err } (err dit aussi si le processus a été tué). */
export const run = (cmd, args = [], timeout = 8000) =>
    new Promise(resolve =>
        execFile(cmd, args, { timeout, maxBuffer: 8e6 }, (err, out, errout) =>
            resolve({ ok: !err, out: String(out ?? ""), err: err ? `${String(errout || err.message).trim()}${err.signal ? ` (signal ${err.signal})` : ""}` : "" }),
        ),
    );

/** Sortie d'une commande ("" si elle échoue). */
export const runText = (cmd, args, timeout = 3000) => run(cmd, args, timeout).then(r => (r.ok ? r.out : ""));

/** Lance un script AppleScript (ou JavaScript pour l'automatisation : language = "JavaScript"). */
export function osascript(script, timeout = 4000, language = null) {
    const args = language
        ? ["-l", language, "-e", script]
        : script
              .trim()
              .split("\n")
              .flatMap(line => ["-e", line]);
    return new Promise((resolve, reject) => {
        execFile("osascript", args, { timeout }, (err, stdout, stderr) => {
            if (err) {
                const msg = String(stderr || err.message);
                const e = new Error(msg.trim());
                e.notAllowed = /-1743|not allowed|pas autoris|Not authori/i.test(msg);
                // osascript bloqué puis coupé : le Mac attend presque toujours qu'on réponde à sa demande d'autorisation
                e.waiting = !stderr && (err.killed || err.signal === "SIGTERM");
                return reject(e);
            }
            resolve(stdout.replace(/\n$/, ""));
        });
    });
}

/** Logiciel au nom duquel macOS demande les autorisations : « node » en arrière-plan, sinon Terminal. */
export const automationHost = () => (process.env.SHOW_SERVICE === "app" ? process.env.SHOW_APP_NAME || "Show lumière" : process.env.SHOW_SERVICE ? "node" : "Terminal");

/** Message clair quand macOS bloque le pilotage d'une app (Automatisation). */
export function permissionMessage(e, app) {
    const who = automationHost();
    if (e.notAllowed) return `Le Mac n'autorise pas encore ce logiciel à piloter ${app} : Réglages Système › Confidentialité et sécurité › Automatisation › ${who} › coche « ${app} ».`;
    if (e.waiting) return `Le Mac attend ton accord : clique sur OK dans la fenêtre « ${who} souhaite contrôler ${app} ».`;
    return `Lecture de ${app} impossible : ${String(e.message).slice(0, 140)}`;
}

/** Texte AppleScript entre guillemets. */
export const asString = s => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
/** Nombre lu dans une sortie AppleScript (qui écrit « 12,5 » en français). */
export const num = s => parseFloat(String(s ?? "").replace(",", ".")) || 0;

/** Noms des applications ouvertes (sans AppleScript : simple liste des processus). */
export function runningApps() {
    if (process.env.SHOW_RUNNING_APPS !== undefined) return Promise.resolve(new Set(process.env.SHOW_RUNNING_APPS.split(",").filter(Boolean))); // tests
    if (!IS_DARWIN) return Promise.resolve(new Set());
    return runText("ps", ["-axco", "comm"]).then(out => new Set(out.split("\n").map(s => s.trim()).filter(Boolean)));
}
