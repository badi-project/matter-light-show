// Show lumière — Réglages, marche/arrêt, téléphone, journal, navigation.
// (Scripts classiques chargés dans l'ordre par index.html : ils partagent leurs noms de haut niveau.)
// =====================================================================================
// Réglages & journal
// =====================================================================================
function renderSettings() {
  const s = S.st.settings;
  $("#rate").value = s.rate; $("#rateVal").textContent = s.rate; $("#demo").checked = !!s.demo;
  const a = S.st.app;
  if (a) {
    const date = a.date ? new Date(`${a.date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
    setHtml($("#appVersion"), `<b>Version ${esc(a.version)}</b>${date ? ` · ${esc(date)}` : ""}<br><span class="muted">Node.js ${esc(a.node)}${a.matter ? ` · matter.js ${esc(a.matter)}` : ""}</span>`);
  }
}
$("#rate").oninput = e => $("#rateVal").textContent = e.target.value;
$("#rate").onchange = e => api("PATCH", "/api/settings", { rate: Number(e.target.value) }).catch(err => toast(err.message, true));
$("#demo").onchange = e => api("PATCH", "/api/settings", { demo: e.target.checked }).catch(err => toast(err.message, true));
const restartSoft = () => api("POST", "/api/restart").then(() => toast("Redémarrage… la page se reconnecte toute seule.")).catch(e => toast(e.message, true));
$("#restartSrv").onclick = restartSoft;
$("#restartBtn").onclick = () => { if (confirm("Redémarrer le logiciel ? (quelques secondes)")) restartSoft(); };
$("#powerBtn").onclick = () => api("POST", "/api/power", { action: S.st.settings.standby ? "start" : "stop" }).catch(e => toast(e.message, true));
$("#quitSrv").onclick = () => {
  if (!confirm("Fermer complètement le logiciel ? Les lampes restent dans la couleur d'arrêt. Pour le relancer, ouvre l'app « Show lumière ».")) return;
  api("POST", "/api/power", { action: "quit" }).then(() => toast("Logiciel fermé.")).catch(e => toast(e.message, true));
};
$("#serviceInstall").onclick = () => {
  if (!confirm("Faire tourner le logiciel en arrière-plan ? Il démarrera avec le Mac, sans fenêtre Terminal, et se relancera tout seul en cas de souci. La page se reconnecte dans quelques secondes.")) return;
  api("POST", "/api/service/install").then(() => toast("Passage en arrière-plan… la page se reconnecte toute seule.")).catch(e => toast(e.message, true));
};
$("#serviceUninstall").onclick = () => {
  if (!confirm("Ne plus démarrer avec le Mac ? Le logiciel s'arrête ; tu pourras le relancer avec l'app « Show lumière » ou « Lancer le show ».")) return;
  api("POST", "/api/service/uninstall").then(() => toast("Le logiciel ne démarrera plus avec le Mac.")).catch(e => toast(e.message, true));
};
$("#stopSwatch").onclick = ev => openPicker(ev.currentTarget, { value: S.st.settings.stopColor?.color ?? "2700K", allowOff: true }, v => {
  if (!v) return;
  api("PATCH", "/api/settings", { stopColor: { color: v, brightness: Number($("#stopBright").value) || 60 } }).catch(e => toast(e.message, true));
});
$("#stopBright").oninput = e => $("#stopBrightVal").textContent = e.target.value + " %";
$("#stopBright").onchange = e => api("PATCH", "/api/settings", { stopColor: { color: S.st.settings.stopColor?.color ?? "2700K", brightness: Number(e.target.value) } }).catch(err => toast(err.message, true));
function renderPower() {
  const set = S.st.settings, stb = !!set.standby;
  const b = $("#powerBtn");
  b.textContent = stb ? "▶ Démarrer" : "⏻ Arrêter";
  b.classList.toggle("start", stb);
  b.title = stb ? "Reprendre le show (et la synchro si elle était active)" : "Arrêter le show : toutes les lampes prennent la même couleur";
  $("#standbyPill").classList.toggle("hidden", !stb);
  const c = set.stopColor ?? { color: "2700K", brightness: 60 };
  $("#stopSwatch").style.background = c.color === "off" ? "" : disp(c.color);
  $("#stopSwatch").classList.toggle("off", c.color === "off");
  $("#stopBrightRow").classList.toggle("hidden", c.color === "off");
  if (document.activeElement !== $("#stopBright")) { $("#stopBright").value = c.brightness ?? 60; $("#stopBrightVal").textContent = (c.brightness ?? 60) + " %"; }
  const sv = S.st.service ?? {};
  const txt = sv.mode === "app" ? "✓ Le logiciel est géré par l'app <b>« Show lumière »</b> : il démarre avec l'app (réglage « Ouvrir au démarrage du Mac » dans le menu de la barre des menus), se relance tout seul en cas de souci, et « Quitter complètement » ferme l'app."
    : sv.mode === "service" ? "✓ Le logiciel tourne <b>en arrière-plan</b> : il démarre avec le Mac, sans fenêtre Terminal, et se relance tout seul. Pour ouvrir la page : app <b>« Show lumière »</b> ou ce lien en favori."
    : sv.mode === "terminal" ? "Le logiciel tourne dans une <b>fenêtre Terminal</b>. Passe-le en arrière-plan pour qu'il démarre tout seul avec le Mac (plus besoin de fenêtre)."
    : "Le logiciel a été lancé à la main.";
  $("#serviceInfo").innerHTML = txt + (sv.mac ? "" : " <span class='muted'>(fonctionnement en arrière-plan disponible seulement sur Mac)</span>");
  $("#serviceInstall").classList.toggle("hidden", !sv.mac || sv.mode === "service" || sv.mode === "app");
  $("#serviceUninstall").classList.toggle("hidden", !sv.mac || !sv.installed || sv.mode === "app");
  $("#restartSrv").classList.toggle("hidden", sv.mode === "manuel");
  $("#restartBtn").classList.toggle("hidden", sv.mode === "manuel");
}
// ---------- Téléphone
const remoteState = { sig: null, info: null, useIp: false, loading: false };
async function loadRemoteInfo() {
  if (remoteState.loading) return;
  remoteState.loading = true;
  try { remoteState.info = await api("GET", "/api/remote"); } catch (e) { remoteState.info = null; }
  remoteState.loading = false;
  paintRemote();
}
function renderRemote() {
  const r = S.st.remote ?? {};
  $("#remoteOn").checked = !!r.enabled;
  $("#keepAwake").checked = !!r.keepAwake;
  $("#keepAwakeRow").classList.toggle("hidden", !r.enabled);
  $("#keepAwakeHelp").classList.toggle("hidden", !r.enabled);
  const sig = JSON.stringify([S.local, r.enabled, r.phones]);
  if (sig === remoteState.sig) return;
  remoteState.sig = sig;
  if (S.local && r.enabled) loadRemoteInfo(); else paintRemote();
}
function paintRemote() {
  const r = S.st.remote ?? {}, box = $("#remoteBody");
  const phones = r.phones ? `<p class="phones-on">✓ ${r.phones} téléphone${r.phones > 1 ? "s" : ""} connecté${r.phones > 1 ? "s" : ""} en ce moment.</p>` : "";
  if (!S.local) {
    box.innerHTML = `<p>✓ Tu pilotes le show <b>depuis ce téléphone</b>. Tout fonctionne comme sur le Mac, tant que le Mac est allumé et sur le même Wi-Fi.</p>
      <p class="muted">Astuce : dans Safari, touche <b>Partager</b> puis <b>« Sur l'écran d'accueil »</b> pour avoir l'icône Show lumière comme une app.</p>
      <p class="muted">Pour ajouter un autre téléphone ou changer la clé, va dans ce même réglage sur le Mac.</p>`;
    return;
  }
  if (!r.enabled) {
    box.innerHTML = `<p class="muted">Active cette option pour piloter les lumières, la musique et les shows depuis ton iPhone (ou une tablette) connecté au <b>même Wi-Fi</b> que le Mac. Un QR code s'affichera ici : il suffit de le scanner avec l'appareil photo. Personne d'autre ne peut se connecter sans ce QR code ou le code à 6 chiffres.</p>`;
    return;
  }
  const info = remoteState.info;
  if (!info) { box.innerHTML = `<p class="muted">Préparation du QR code…</p>`; return; }
  const byName = info.links.find(l => l.kind === "nom"), byIp = info.links.find(l => l.kind === "ip");
  const link = (remoteState.useIp && byIp) || byName || byIp;
  if (!link) { box.innerHTML = `<p class="warn">Le Mac n'est connecté à aucun réseau Wi-Fi ou Ethernet pour l'instant.</p>`; return; }
  const other = link === byName ? byIp : byName;
  box.innerHTML = `
    <div class="qr-wrap">
      <div class="qr">${link.qr}</div>
      <div class="qr-side">
        <p style="margin-top:0"><b>1.</b> Ouvre l'<b>appareil photo</b> de ton iPhone et vise ce QR code.<br><b>2.</b> Touche le lien qui apparaît : la page s'ouvre dans Safari.<br><b>3.</b> Partager › <b>« Sur l'écran d'accueil »</b> pour la garder comme une app.</p>
        <p class="muted" style="margin-bottom:4px">Ou tape cette adresse sur le téléphone, puis le code :</p>
        <div class="urlbox">${esc(link.base)}</div>
        <div class="pin" style="margin-top:6px">${esc(info.pin)}</div>
      </div>
    </div>
    ${phones}
    ${other ? `<p class="muted">Le QR code ne s'ouvre pas sur le téléphone ? <a href="#" id="remoteSwap" style="color:var(--accent)">${link === byName ? "Essayer avec l'adresse IP du Mac" : "Revenir à l'adresse par le nom du Mac"}</a>${link === byIp ? " (l'adresse IP peut changer quand la box redémarre)" : ""}.</p>` : ""}
    <p class="muted">Le téléphone doit être sur le <b>même Wi-Fi</b> que le Mac, et le Mac allumé. Si le Mac demande d'autoriser « node » à <b>accepter les connexions entrantes</b>, clique Autoriser.</p>
    <div class="row" style="gap:8px;margin-top:8px"><button class="btn small" id="remoteReset" title="Les téléphones déjà connectés devront rescanner le QR code">Changer la clé (déconnecte les téléphones)</button></div>`;
  const sw = $("#remoteSwap");
  if (sw) sw.onclick = e => { e.preventDefault(); remoteState.useIp = !remoteState.useIp; paintRemote(); };
  $("#remoteReset").onclick = async () => {
    if (!confirm("Changer la clé ? Les téléphones déjà connectés devront rescanner le nouveau QR code.")) return;
    try { remoteState.info = await api("POST", "/api/remote/reset"); paintRemote(); toast("Nouvelle clé : rescanne le QR code sur tes téléphones."); } catch (e) { toast(e.message, true); }
  };
}
$("#remoteOn").onchange = async e => {
  const on = e.target.checked;
  if (!on && !S.local && !confirm("Couper l'accès depuis le téléphone ? Ce téléphone sera déconnecté ; pour le réactiver, il faudra passer par le Mac.")) { e.target.checked = true; return; }
  try { await api("PATCH", "/api/settings", { remote: { enabled: on } }); if (on) toast("Accès téléphone activé : scanne le QR code."); }
  catch (err) { e.target.checked = !on; toast(err.message, true); }
};
$("#keepAwake").onchange = e => api("PATCH", "/api/settings", { remote: { keepAwake: e.target.checked } }).catch(err => toast(err.message, true));

// journal : les nouvelles lignes sont ajoutées à la suite (80 au plus), sans tout redessiner
S.logShown = 0;
function renderLog() {
  const box = $("#log"), logs = S.st.logs;
  const line = l => `<div class="${l.level}">${new Date(l.t).toLocaleTimeString("fr-FR")} ${esc(l.msg)}</div>`;
  if (!S.logShown || S.logShown > logs.length) {
    box.innerHTML = logs.slice(-80).map(line).join("") || '<span class="muted">Rien pour l\'instant.</span>';
  } else if (S.logShown < logs.length) {
    if (box.querySelector("span.muted")) box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", logs.slice(S.logShown).map(line).join(""));
    while (box.childElementCount > 80) box.firstElementChild.remove();
  } else return;
  S.logShown = logs.length;
  box.scrollTop = box.scrollHeight;
}

// =====================================================================================
// Navigation & actions globales
// =====================================================================================
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  S.tab = b.dataset.tab;
  document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x === b));
  ["shows", "lamps", "music", "settings"].forEach(t => $("#tab-" + t).classList.toggle("hidden", t !== S.tab));
  if (S.tab === "music") { loadPlaylists(); loadOutputs(); }
  if (S.tab === "lamps") loadSpeakers();
  startBeat();
});
$("#allOff").onclick = () => api("POST", "/api/direct", { state: { on: false }, fade: 1 }).catch(e => toast(e.message, true));
$("#allWarm").onclick = () => api("POST", "/api/direct", { state: { on: true, color: "2700K", brightness: 70 }, fade: 1 }).catch(e => toast(e.message, true));
document.addEventListener("keydown", e => {
  if (e.code === "Space" && S.tab === "shows" && S.show && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) { e.preventDefault(); togglePlay(); }
});
const saveOnLeave = () => {
  if (S.saveTimer && S.show) { clearTimeout(S.saveTimer); S.saveTimer = null; fetch(`/api/shows/${encodeURIComponent(S.show.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(S.show), keepalive: true }); }
};
window.addEventListener("beforeunload", saveOnLeave);
window.addEventListener("pagehide", saveOnLeave);
