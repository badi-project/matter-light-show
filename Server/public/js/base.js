// Show lumière — Données, utilitaires, état, connexion en direct, rendu général, aperçu des lampes.
// (Scripts classiques chargés dans l'ordre par index.html : ils partagent leurs noms de haut niveau.)
// =====================================================================================
// Données & utilitaires
// =====================================================================================
const PRESETS = ["#ff0000","#ff4f3a","#ff8c00","#ffb000","#ffe600","#a8ff00","#00d84a","#00ffa2",
                 "#00c8ff","#0080ff","#2b50ff","#4b2bff","#9b30ff","#ff00d4","#ff2d6f","#ffffff"];
const PASTELS = ["#ff9999","#ffc299","#ffe7a3","#fff7a8","#d9ffa3","#a8f0c0","#a3ffe0","#a8e8ff","#a3c8ff","#b8b3ff","#d6b3ff","#ffb3f0","#ffb3c8","#f2d6c9","#e6e0d6","#d9e6f2"];
const WHITES = [["2200K","Bougie"],["2700K","Chaud"],["4000K","Neutre"],["5000K","Jour"],["6500K","Froid"]];
const KIND = { color: "Couleur", white: "Blanc", dim: "Variateur", onoff: "On/Off" };
const ICON = {
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>',
  stop: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>',
  dup: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="5" width="9" height="9" rx="2"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>',
  up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10l4-4 4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6l4 4 4-4"/></svg>',
  del: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/></svg>',
  eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  flash: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9 1L3 9h4l-1 6 6-8H8z"/></svg>',
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const isK = c => typeof c === "string" && /^\d{4,5}K$/i.test(c);
function kelvinToHex(k) {
  const t = Math.min(40000, Math.max(1000, parseInt(k))) / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
const disp = c => c === "off" ? "#1d222d" : isK(c) ? kelvinToHex(c) : (c || "#ffffff");
// couleur réellement visible selon le type de lampe (une lampe blanche ignore les couleurs)
const shown = (l, c) => !l || !l.kind || l.kind === "color" ? disp(c) : (l.kind === "white" ? (isK(c) ? disp(c) : "#ffe4c4") : "#ffd6a0");
const colorLabel = c => c === "off" ? "Éteinte" : isK(c) ? (WHITES.find(w => w[0] === c)?.[1] ?? "Blanc") + " " + c : c.toUpperCase();

async function api(method, url, data) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
let toastTimer;
function toast(msg, isError) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (isError ? " error" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), isError ? 6000 : 2500);
}

// Même logique que le serveur (lib/show.mjs) pour prévisualiser une étape
function resolveStep(step, lamps) {
  const out = {}; const mode = step.mode || "all";
  const norm = s => (!s || s.on === false || s.color === "off" || Number(s.brightness) === 0) ? { on: false } : { on: true, color: s.color || "2700K", brightness: Number(s.brightness ?? 100) };
  if (mode === "all") lamps.forEach(l => out[l.id] = norm(step.all));
  else if (mode === "palette") {
    const cs = (step.palette?.colors || []).filter(Boolean), n = cs.length, sh = Number(step.palette?.shift) || 0;
    if (n) lamps.forEach((l, i) => { const c = cs[(((i + sh) % n) + n) % n]; out[l.id] = c === "off" ? { on: false } : norm({ on: true, color: c, brightness: step.palette.brightness }); });
  } else lamps.forEach(l => { if (step.lamps?.[l.id]) out[l.id] = norm(step.lamps[l.id]); });
  return out;
}

// =====================================================================================
// État de l'application
// =====================================================================================
const S = { st: null, tab: "shows", showId: localStorage.getItem("showId") || null, show: null, saveTimer: null };
// sur le Mac (localhost) ou sur un téléphone / un autre appareil du réseau
S.local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(location.hostname);
document.body.classList.toggle("phone", !S.local);
fetch("/api/whoami").then(r => r.json()).then(w => { S.local = !!w.local; document.body.classList.toggle("phone", !S.local); if (S.st) renderRemote(); }).catch(() => {});
const allNetLamps = () => (S.st?.lamps || []);
const lamps = () => allNetLamps().filter(l => !l.elsewhere); // lampes du réseau actuel
const activeLamps = () => lamps().filter(l => !l.hidden);

// ---------- Connexion temps réel ----------
// Page cachée (autre onglet, téléphone verrouillé) : les données restent à jour mais rien n'est dessiné ;
// tout est redessiné d'un coup au retour sur la page.
const visible = () => document.visibilityState !== "hidden";
S.dirty = false;
const whenVisible = draw => { if (visible()) draw(); else S.dirty = true; };
// nouvelle version installée sur le Mac : la page se recharge d'elle-même (au plus une fois par minute)
const BUILD = document.querySelector('meta[name="build"]')?.content;
function checkBuild(b) {
  if (!b || !BUILD || BUILD === "__BUILD__" || b === BUILD) return;
  let last = 0;
  try { last = Number(sessionStorage.getItem("showReloadAt")) || 0; } catch {}
  if (Date.now() - last < 60000) return;
  try { sessionStorage.setItem("showReloadAt", String(Date.now())); } catch {}
  if (visible()) { toast("Nouvelle version installée : la page se recharge…"); setTimeout(() => location.reload(), 1500); } else location.reload();
}
function connect() {
  try { S.es?.close(); } catch {}
  const es = S.es = new EventSource("/api/events");
  // l'état complet ne contient le journal qu'à la connexion : ensuite il arrive ligne par ligne (« log »)
  es.addEventListener("state", e => { const logs = S.st?.logs; S.st = JSON.parse(e.data); checkBuild(S.st.app?.build); if (!S.st.logs) S.st.logs = logs ?? []; else S.logShown = 0; if (visible()) renderAll(); else { S.dirty = true; maybeAnalyze(); } });
  es.addEventListener("remote", e => { if (!S.st) return; S.st.remote = { ...S.st.remote, ...JSON.parse(e.data) }; whenVisible(renderRemote); });
  es.addEventListener("preview", e => { const { changes, fade } = JSON.parse(e.data); Object.assign(S.st.preview, changes); whenVisible(() => paintBulbs(fade, Object.keys(changes))); });
  es.addEventListener("player", e => { S.st.player = JSON.parse(e.data); whenVisible(renderPlayer); });
  es.addEventListener("music", e => { S.st.music = JSON.parse(e.data); if (visible()) renderMusic(); else { S.dirty = true; maybeAnalyze(); } startBeat(); });
  es.addEventListener("shows", e => { S.st.shows = JSON.parse(e.data); whenVisible(renderShowList); });
  es.addEventListener("pending", e => { const n = JSON.parse(e.data); const q = $("#queue"); q.classList.toggle("hidden", n < 4); q.textContent = `${n} commandes en file`; });
  es.addEventListener("log", e => { const l = JSON.parse(e.data); S.st.logs.push(l); if (S.st.logs.length > 150) { S.st.logs.shift(); S.logShown = 0; } whenVisible(renderLog); if (l.level === "error") toast(l.msg, true); if (l.level === "success") toast(l.msg); });
  es.addEventListener("identify", e => { const id = JSON.parse(e.data).id; const b = document.querySelector(`.bulb[data-id="${CSS.escape(id)}"]`); if (b) { b.classList.remove("blink"); void b.offsetWidth; b.classList.add("blink"); } });
  es.onopen = () => { clearTimeout(S.offTimer); $("#offline").classList.add("hidden"); };
  es.onerror = () => {
    $("#status").className = "pill err"; $("#status").textContent = S.local ? "Serveur arrêté ?" : "Mac injoignable ?";
    clearTimeout(S.offTimer);
    S.offTimer = setTimeout(() => $("#offline").classList.remove("hidden"), 2500);
    // accès retiré (clé changée, contrôle téléphone coupé) : on affiche la page de connexion
    if (!S.local) fetch("/api/ping", { cache: "no-store" }).then(r => { if (r.status === 401 || r.status === 403) location.href = "/"; }).catch(() => {});
    if (es.readyState === 2) { clearTimeout(S.retry); S.retry = setTimeout(connect, 3000); }
  };
}
// retour sur la page (téléphone sorti de veille, app rouverte) : on se reconnecte tout de suite si besoin, et on redessine
document.addEventListener("visibilitychange", () => {
  if (visible()) {
    if (!S.es || S.es.readyState === 2) connect();
    if (S.dirty && S.st) { S.dirty = false; renderAll(); }
    startBeat();
  } else if (S.saveTimer && S.show) flushSave();
});

// =====================================================================================
// Rendu général
// =====================================================================================
let lampSig = "";
/** Remplace le contenu d'un élément seulement s'il a changé (pas de travail du navigateur pour rien). */
function setHtml(el, html) {
  if (!el || el.dataset.sig === html) return false;
  el.innerHTML = html; el.dataset.sig = html;
  return true;
}
function renderAll() {
  renderMusic();
  renderStatus(); renderBulbs(); renderShowList(); renderLamps(); renderRooms(); renderNodes(); renderIntegrations(); renderSettings(); renderPower(); renderRemote(); renderNetwork(); renderLog();
  // on ne reconstruit l'éditeur que si nécessaire (pour ne pas perdre la saisie en cours)
  const sig = JSON.stringify([activeLamps().map(l => [l.id, l.name, l.kind, l.virtual]), S.st.settings.rate]);
  if (!S.show || !S.st.shows.find(s => s.id === S.showId)) {
    const id = S.st.shows.find(s => s.id === S.showId)?.id || S.st.shows[0]?.id;
    if (id) openShow(id); else { S.show = null; renderEditor(); }
  } else if (sig !== lampSig) renderEditor();
  else renderPlayer();
  lampSig = sig;
}

function renderStatus() {
  const st = S.st, el = $("#status");
  const real = lamps().filter(l => !l.virtual).length;
  if (st.matter.error) { el.className = "pill err"; el.textContent = "Matter : erreur"; el.title = st.matter.error; }
  else if (!st.matter.ready) { el.className = "pill"; el.textContent = "Matter : démarrage…"; }
  else if (st.matter.pairing) { el.className = "pill"; el.textContent = "Appairage en cours…"; }
  else {
    const mixed = lamps().some(l => l.source && l.source !== "matter");
    el.className = "pill ok"; el.title = "";
    el.textContent = real ? `${mixed ? "" : "Matter · "}${real} lampe${real > 1 ? "s" : ""}` : (st.settings.demo ? "Mode démo" : "Matter prêt · aucune lampe");
  }
}

// éléments « verre » de chaque lampe (bandeau et liste des lampes), pour ne repeindre que les lampes qui changent
const glasses = new Map();
function indexGlasses() {
  glasses.clear();
  document.querySelectorAll(".bulb[data-id], .lamp-row[data-id]").forEach(el => {
    const g = el.querySelector(".glass"); if (!g) return;
    const id = el.dataset.id;
    if (!glasses.has(id)) glasses.set(id, []);
    glasses.get(id).push(g);
  });
}
function renderBulbs() {
  const list = activeLamps();
  const html = list.length ? list.map(l => `
    <div class="bulb" data-id="${esc(l.id)}" title="Cliquer pour faire clignoter « ${esc(l.name)} »">
      <div class="glass"></div><div class="name">${esc(l.name)}</div>
    </div>`).join("") : `<div class="empty-stage">Aucune lampe pour l'instant. Va dans <b>Lampes</b> pour appairer ton pont Hue, ou active le <b>mode démo</b> dans Réglages.</div>`;
  if (setHtml($("#bulbs"), html)) {
    document.querySelectorAll(".bulb").forEach(b => b.onclick = () => api("POST", `/api/lamps/${encodeURIComponent(b.dataset.id)}/identify`).catch(e => toast(e.message, true)));
    indexGlasses();
  }
  paintBulbs(0);
}
function glassStyle(el, p, fade) {
  el.style.transitionDuration = `${Math.max(0.15, fade || 0)}s`;
  if (p?.on) {
    const c = p.display || disp(p.color), a = 0.35 + 0.65 * (p.brightness ?? 100) / 100;
    el.style.backgroundColor = c; el.style.opacity = a; el.style.boxShadow = `0 0 ${10 + 26 * a}px ${c}`; el.style.borderColor = "rgba(255,255,255,.35)";
  } else { el.style.backgroundColor = "#262b37"; el.style.opacity = 1; el.style.boxShadow = "none"; el.style.borderColor = "#323a4d"; }
}
/** Peint les lampes (toutes, ou seulement celles qui viennent de changer). */
function paintBulbs(fade, ids = null) {
  for (const id of ids ?? glasses.keys()) for (const g of glasses.get(id) ?? []) glassStyle(g, S.st.preview[id], fade);
}
