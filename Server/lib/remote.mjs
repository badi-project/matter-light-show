// Contrôle depuis le téléphone (ou tout appareil sur le même Wi-Fi que le Mac).
// Le Mac lui-même (localhost) a toujours accès. Un autre appareil doit présenter la clé (QR code, gardée ensuite
// dans un cookie) ou le code à 6 chiffres affiché sur le Mac. « Changer la clé » déconnecte tous les téléphones.
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { hostname, networkInterfaces } from "node:os";
import { runText } from "./macos.mjs";
import qrcode from "./vendor/qrcode.mjs";

export const COOKIE = "sl_cle";
const MAX_FAILS = 5; // essais de code ratés…
const FAIL_WINDOW = 5 * 60_000; // …par tranche de 5 minutes (tous appareils confondus)

export const isLoopback = addr => /^(127\.|::1$|::ffff:127\.)/.test(String(addr ?? ""));
const cleanAddr = a => String(a ?? "").replace(/^::ffff:/, "");

function sameSecret(a, b) {
    const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
    return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Petit QR code en SVG (noir sur blanc, marge de 3 modules). */
export function qrSvg(text) {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(), m = 3;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** Adresses IPv4 du Mac sur le réseau local (Wi-Fi / Ethernet d'abord ; pas les VPN ni les machines virtuelles). */
export function lanAddresses() {
    const out = [];
    for (const [name, list] of Object.entries(networkInterfaces())) {
        if (/^(lo|utun|bridge|vnic|vmnet|docker|veth|awdl|llw|gif|stf|anpi|ap\d)/.test(name)) continue;
        for (const a of list ?? []) {
            if (a.family !== "IPv4" && a.family !== 4) continue;
            if (a.internal || a.address.startsWith("169.254.")) continue;
            out.push({ name, address: a.address });
        }
    }
    const rank = n => (/^en0$/.test(n) ? 0 : /^(en|eth|wl)/.test(n) ? 1 : 2);
    return out.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

export class RemoteAccess {
    #fails = [];
    #local = null; // nom Bonjour du Mac (« MacBook-Air-de-Paul »)
    #namesAt = 0;

    /** read/write : lecture et écriture du fichier des secrets ; port : port du serveur. */
    constructor({ read, write, port, log }) {
        this.port = port;
        this.log = log ?? (() => {});
        this.write = write;
        this.data = { ...(read() ?? {}) };
        if (!this.data.key || !this.data.pin) this.reset(false);
        this.refreshNames();
    }

    reset(announce = true) {
        this.data.key = randomBytes(18).toString("base64url");
        this.data.pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
        this.write(this.data);
        if (announce) this.log("info", "Nouvelle clé d'accès : les téléphones déjà connectés devront rescanner le QR code.");
    }

    get key() {
        return this.data.key;
    }
    get pin() {
        return this.data.pin;
    }

    // ---------- noms et adresses du Mac
    refreshNames() {
        this.#namesAt = Date.now();
        const fallback = () => {
            const h = hostname().replace(/\.local$/i, "");
            return h.split(".")[0] || "localhost";
        };
        if (process.platform !== "darwin") {
            this.#local = fallback();
            return;
        }
        runText("scutil", ["--get", "LocalHostName"], 2000).then(out => (this.#local = out.trim() || fallback()));
    }
    get localName() {
        if (Date.now() - this.#namesAt > 10 * 60_000) this.refreshNames(); // le nom du Mac change rarement
        return this.#local ? `${this.#local}.local` : null;
    }
    #hosts = { at: 0, set: null };
    /** Noms sous lesquels le Mac peut être appelé (pour vérifier l'en-tête Host) ; relus toutes les 5 s au plus. */
    knownHosts() {
        if (this.#hosts.set && Date.now() - this.#hosts.at < 5000) return this.#hosts.set;
        const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
        const ln = this.localName;
        if (ln) hosts.add(ln.toLowerCase());
        for (const a of lanAddresses()) hosts.add(a.address);
        this.#hosts = { at: Date.now(), set: hosts };
        return hosts;
    }
    /** Adresses à ouvrir sur le téléphone : par le nom du Mac (stable), puis par l'adresse IP (secours). */
    links() {
        const out = [];
        const ln = this.localName;
        if (ln) out.push({ kind: "nom", base: `http://${ln}:${this.port}` });
        for (const a of lanAddresses().slice(0, 2)) out.push({ kind: "ip", base: `http://${a.address}:${this.port}`, iface: a.name });
        return out.map(l => ({ ...l, url: `${l.base}/?cle=${this.key}` }));
    }

    // ---------- autorisation
    cookieHeader() {
        return `${COOKIE}=${this.key}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax`;
    }
    #cookie(req) {
        for (const part of String(req.headers.cookie ?? "").split(";")) {
            const [k, ...v] = part.trim().split("=");
            if (k === COOKIE) return v.join("=");
        }
        return null;
    }
    /** { ok, setCookie, fresh } : clé dans le cookie, ou dans l'adresse (?cle=…, QR code). */
    check(req, url) {
        if (sameSecret(this.#cookie(req), this.key)) return { ok: true };
        if (sameSecret(url.searchParams.get("cle"), this.key)) return { ok: true, setCookie: true, fresh: true };
        return { ok: false };
    }
    /** Code à 6 chiffres tapé sur le téléphone. Lève une erreur (status 401 / 429) si refusé. */
    login(pin, addr) {
        const now = Date.now();
        this.#fails = this.#fails.filter(t => now - t < FAIL_WINDOW);
        if (this.#fails.length >= MAX_FAILS) {
            const wait = Math.ceil((FAIL_WINDOW - (now - this.#fails[0])) / 60_000);
            throw Object.assign(new Error(`Trop d'essais : réessaie dans ${wait} min (ou scanne le QR code affiché sur le Mac).`), { status: 429 });
        }
        if (!sameSecret(String(pin ?? "").replace(/\D/g, ""), this.pin)) {
            this.#fails.push(now);
            this.log("warn", `Code de connexion incorrect tapé depuis ${cleanAddr(addr)}.`);
            throw Object.assign(new Error("Code incorrect. Il est affiché sur le Mac : Réglages › Téléphone."), { status: 401 });
        }
        this.#fails = [];
        return { ok: true, next: `/?cle=${this.key}` };
    }
}

const PAGE_STYLE = `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0f14;color:#e9ecf3;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:360px;padding:28px 22px;text-align:center}img{width:84px;height:84px;border-radius:20px}h1{font-size:22px;margin:14px 0 6px}
p{color:#8a93a8;margin:8px 0}b{color:#e9ecf3}input{width:100%;box-sizing:border-box;margin:18px 0 10px;padding:14px;font:600 28px/1 ui-monospace,Menlo,monospace;letter-spacing:10px;text-align:center;border-radius:12px;border:1px solid #272e40;background:#1c2130;color:#e9ecf3}
button{width:100%;padding:14px;border:0;border-radius:12px;background:#ffb000;color:#1a1200;font:600 17px/1 inherit}#err{color:#ff5d5d;min-height:24px}`;

/** Page affichée sur un téléphone pas encore autorisé (ou si l'accès est coupé). */
export function loginPage({ enabled }) {
    const body = enabled
        ? `<h1>Show lumière</h1>
<p>Pour piloter les lumières depuis ce téléphone, <b>scanne le QR code</b> affiché sur le Mac (page Show lumière › <b>Réglages › Téléphone</b>)…</p>
<p>…ou tape le <b>code à 6 chiffres</b> affiché au même endroit :</p>
<form id="f"><input id="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="••••••" autofocus>
<div id="err"></div><button>Se connecter</button></form>
<script>
document.getElementById("f").onsubmit = async e => {
  e.preventDefault();
  const err = document.getElementById("err"); err.textContent = "";
  try {
    const r = await fetch("/api/remote/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: document.getElementById("pin").value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Refusé");
    location.href = j.next || "/";
  } catch (x) { err.textContent = x.message; }
};
</script>`
        : `<h1>Show lumière</h1>
<p>Le contrôle depuis le téléphone est <b>désactivé</b>.</p>
<p>Active-le sur le Mac : page Show lumière › <b>Réglages › Téléphone</b>, puis scanne le QR code.</p>`;
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Show lumière</title><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>${PAGE_STYLE}</style></head><body><main><img src="/icons/apple-touch-icon.png" alt="">${body}</main></body></html>`;
}
