// Fonctionnement en arrière-plan sur Mac : un « LaunchAgent » démarre le logiciel avec la session,
// sans fenêtre Terminal, et le relance s'il s'arrête anormalement (code de sortie ≠ 0 ; 75 = redémarrage demandé).
// Utilisable aussi en ligne de commande : node lib/service.mjs install | uninstall | plist
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SERVICE_LABEL = "fr.showlumiere.serveur";
export const SERVICE_PLIST = join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SERVICE_LOG = join(ROOT, "data", "serveur.log");

const xml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function servicePlist(node = process.execPath) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(join(ROOT, "server.mjs"))}</string></array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SHOW_LAUNCHER</key><string>1</string>
    <key>SHOW_SERVICE</key><string>launchd</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xml(SERVICE_LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(SERVICE_LOG)}</string>
</dict>
</plist>
`;
}

export const serviceInstalled = () => process.platform === "darwin" && existsSync(SERVICE_PLIST);

/** Écrit le LaunchAgent puis le (re)charge après « delay » secondes (le temps que l'instance actuelle libère le port). */
export function installService({ delay = 2 } = {}) {
    if (process.platform !== "darwin") throw new Error("Le fonctionnement en arrière-plan n'existe que sur Mac.");
    mkdirSync(dirname(SERVICE_PLIST), { recursive: true });
    mkdirSync(dirname(SERVICE_LOG), { recursive: true });
    writeFileSync(SERVICE_PLIST, servicePlist());
    const uid = process.getuid();
    const child = spawn(
        "/bin/sh",
        ["-c", `sleep ${delay}; launchctl bootout gui/${uid}/${SERVICE_LABEL} 2>/dev/null; sleep 1; launchctl bootstrap gui/${uid} "${SERVICE_PLIST}"`],
        { detached: true, stdio: "ignore" },
    );
    child.unref();
}

export function uninstallService() {
    if (process.platform !== "darwin") throw new Error("Le fonctionnement en arrière-plan n'existe que sur Mac.");
    const uid = process.getuid();
    const child = spawn("/bin/sh", ["-c", `sleep 1; rm -f "${SERVICE_PLIST}"; launchctl bootout gui/${uid}/${SERVICE_LABEL} 2>/dev/null`], {
        detached: true,
        stdio: "ignore",
    });
    child.unref();
}

// ligne de commande (utilisée par l'app « Show lumière »)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const cmd = process.argv[2];
    if (cmd === "plist") process.stdout.write(servicePlist());
    else if (cmd === "install") {
        installService({ delay: 0 });
        console.log("Service installé :", SERVICE_PLIST);
    } else if (cmd === "uninstall") {
        uninstallService();
        console.log("Service retiré.");
    } else console.log("Usage : node lib/service.mjs install | uninstall | plist");
}
