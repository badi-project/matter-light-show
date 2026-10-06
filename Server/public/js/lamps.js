// Show lumière — Onglet Lampes : lampes, pièces, appairage, réseaux, autres systèmes, appareils.
// (Scripts classiques chargés dans l'ordre par index.html : ils partagent leurs noms de haut niveau.)
// =====================================================================================
// Onglet Lampes
// =====================================================================================
function renderLamps() {
  const all = lamps();
  const box = $("#lampList");
  // pas pendant une saisie (renommage, choix de la pièce) : la liste est redessinée au prochain changement
  if (box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const away = allNetLamps().filter(l => l.elsewhere);
  const sig = JSON.stringify([all.map(l => [l.id, l.name, l.matterName, l.hidden, l.kind, l.source, l.virtual, l.reachable, l.room]), S.st.rooms, away.map(l => [l.name, l.network]), (S.st.network?.networks || []).map(n => [n.id, n.name])]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = all.length ? all.map((l, i) => `
    <div class="lamp-row" data-id="${esc(l.id)}" style="${l.hidden ? "opacity:.5" : ""}">
      <div class="glass"></div>
      <div class="info">
        <input class="alias" value="${esc(l.name)}" title="Renommer (nom Matter : ${esc(l.matterName)})">
        <div class="small muted" style="padding-left:7px">
          <span class="badge">${KIND[l.kind] || l.kind}</span>${l.source && l.source !== "matter" ? `<span class="badge">${SOURCE[l.source] || l.source}</span>` : ""}
          ${l.virtual ? '<span class="badge">démo</span>' : ""}
          ${l.reachable === false ? '<span class="badge bad">injoignable</span>' : ""}
          ${l.name !== l.matterName ? `<span>· ${esc(l.matterName)}</span>` : ""}
          <select class="room-sel" title="Pièce"><option value="">Sans pièce</option>${(S.st.rooms || []).map(r => `<option value="${esc(r.id)}" ${r.id === l.room ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
        </div>
      </div>
      <button class="iconbtn" data-a="try" title="Tester une couleur">${ICON.flash}</button>
      <button class="iconbtn" data-a="identify" title="Faire clignoter">${ICON.eye}</button>
      <button class="iconbtn" data-a="up" title="Monter" ${i === 0 ? "disabled" : ""}>${ICON.up}</button>
      <button class="iconbtn" data-a="down" title="Descendre" ${i === all.length - 1 ? "disabled" : ""}>${ICON.down}</button>
      <label class="toggle" title="Inclure dans les shows"><input type="checkbox" ${l.hidden ? "" : "checked"}><span class="sw"></span></label>
    </div>`).join("") : `<p class="muted">${allNetLamps().length ? "Aucune lampe sur ce réseau." : "Aucune lampe."} Appaire ton pont Hue avec le code Matter (à droite).</p>`;
  // lampes des autres réseaux : simple liste (elles reviennent toutes seules quand le Mac retrouve leur réseau)
  if (away.length) {
    const netName = id => (S.st.network?.networks || []).find(n => n.id === id)?.name || "autre réseau";
    const byNet = {};
    for (const l of away) (byNet[netName(l.network)] ??= []).push(l.name);
    $("#lampList").insertAdjacentHTML("beforeend", `<details class="fine"><summary>Sur d'autres réseaux (${away.length})</summary>${Object.entries(byNet).map(([n, names]) => `<p class="small"><b>${esc(n)}</b> : ${names.map(esc).join(", ")}</p>`).join("")}<p class="small muted">Elles réapparaissent toutes seules quand le Mac se connecte à leur réseau.</p></details>`);
  }

  document.querySelectorAll(".lamp-row[data-id]").forEach(row => {
    const id = row.dataset.id, enc = encodeURIComponent(id);
    row.querySelector(".alias").onchange = e => api("PATCH", `/api/lamps/${enc}`, { alias: e.target.value.trim() }).catch(err => toast(err.message, true));
    row.querySelector("input[type=checkbox]").onchange = e => api("PATCH", `/api/lamps/${enc}`, { hidden: !e.target.checked }).catch(err => toast(err.message, true));
    row.querySelector(".room-sel").onchange = e => api("POST", `/api/lamps/${enc}/room`, { room: e.target.value || null }).catch(err => toast(err.message, true));
    row.querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === "identify") return api("POST", `/api/lamps/${enc}/identify`).catch(e => toast(e.message, true));
      if (a === "try") return openPicker(b, { value: null, allowOff: true }, v => api("POST", "/api/direct", { ids: [id], state: v === "off" ? { on: false } : { on: true, color: v, brightness: 90 }, fade: 0.5 }).catch(e => toast(e.message, true)));
      const ids = all.map(l => l.id), i = ids.indexOf(id), j = a === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      api("POST", "/api/lamps/order", { ids }).catch(e => toast(e.message, true));
    });
  });
  indexGlasses();
  paintBulbs(0);
}

// une saisie terminée dans la liste : on la redessine si elle a changé entre-temps
$("#lampList").addEventListener("focusout", () => setTimeout(() => { if (S.st && !$("#lampList").contains(document.activeElement)) renderLamps(); }, 0));

// ---------- pièces
S.speakers = null;
async function loadSpeakers() {
  try { S.speakers = (await api("GET", "/api/audio/outputs")).names || []; } catch { S.speakers = S.speakers || []; }
  renderRooms();
}
function renderRooms() {
  const box = $("#roomList"); if (!box) return;
  const list = S.st.rooms || [], all = lamps();
  const spk = S.speakers ?? [];
  const sig = JSON.stringify([list, all.map(l => [l.id, l.room]), spk]);
  if (box.dataset.sig === sig) return; box.dataset.sig = sig;
  const fromMatter = [...new Set(all.map(l => l.matterRoom).filter(Boolean))];
  $("#roomsSource").innerHTML = fromMatter.length
    ? `Pièces annoncées par le pont en Matter : <b>${fromMatter.map(esc).join(", ")}</b>. « Proposer » les utilise.`
    : `Ton pont n'annonce pas ses pièces en Matter : crée-les ici, ou laisse-les proposer d'après les noms des lampes, puis choisis la pièce de chaque lampe dans la liste à gauche.`;
  const loose = all.filter(l => !l.room).length;
  box.innerHTML = list.length ? list.map((r, i) => {
    const n = all.filter(l => l.room === r.id).length;
    return `<div class="room-row" data-id="${esc(r.id)}">
      <div class="top"><span class="badge">${i + 1}</span><input class="rname" value="${esc(r.name)}" title="Renommer"><span class="small muted">${n} lampe${n > 1 ? "s" : ""}</span>
        <button class="iconbtn" data-a="up" title="Plus tôt dans les vagues" ${i === 0 ? "disabled" : ""}>${ICON.up}</button>
        <button class="iconbtn" data-a="down" title="Plus tard dans les vagues" ${i === list.length - 1 ? "disabled" : ""}>${ICON.down}</button>
        <button class="iconbtn" data-a="del" title="Supprimer la pièce">×</button></div>
      <div class="spk">${spk.length ? spk.map(sp => `<label class="chip ${r.speakers?.includes(sp) ? "on" : ""}"><input type="checkbox" value="${esc(sp)}" ${r.speakers?.includes(sp) ? "checked" : ""}>🔈 ${esc(sp)}</label>`).join("") : `<span class="small muted">Ouvre l'app Musique pour relier des enceintes.</span>`}</div>
    </div>`;
  }).join("") + (loose ? `<p class="small muted" style="margin:8px 0 0">${loose} lampe${loose > 1 ? "s" : ""} sans pièce.</p>` : "")
    : `<p class="small muted">Aucune pièce pour l'instant.</p>`;
  box.querySelectorAll(".room-row").forEach(row => {
    const id = row.dataset.id, enc = encodeURIComponent(id);
    row.querySelector(".rname").onchange = e => api("PATCH", `/api/rooms/${enc}`, { name: e.target.value.trim() }).catch(err => toast(err.message, true));
    row.querySelectorAll(".spk input").forEach(cb => cb.onchange = () => {
      cb.parentElement.classList.toggle("on", cb.checked);
      const speakers = [...row.querySelectorAll(".spk input:checked")].map(x => x.value);
      api("PATCH", `/api/rooms/${enc}`, { speakers }).catch(err => toast(err.message, true));
    });
    row.querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === "del") { if (confirm("Supprimer cette pièce ? (les lampes restent, sans pièce)")) api("DELETE", `/api/rooms/${enc}`).catch(err => toast(err.message, true)); return; }
      const ids = list.map(r => r.id), i = ids.indexOf(id), j = a === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      api("POST", "/api/rooms/order", { ids }).catch(e => toast(e.message, true));
    });
  });
}
$("#roomAdd").onclick = () => {
  const name = $("#roomName").value.trim();
  if (!name) return toast("Donne un nom à la pièce", true);
  api("POST", "/api/rooms", { name }).then(() => { $("#roomName").value = ""; }).catch(e => toast(e.message, true));
};
$("#roomName").addEventListener("keydown", e => { if (e.key === "Enter") $("#roomAdd").click(); });
$("#roomAuto").onclick = () => api("POST", "/api/rooms/auto").then(r => toast(r.assigned ? `${r.assigned} lampe${r.assigned > 1 ? "s" : ""} rangée${r.assigned > 1 ? "s" : ""}${r.created ? `, ${r.created} pièce${r.created > 1 ? "s" : ""} créée${r.created > 1 ? "s" : ""}` : ""} (${r.source === "matter" ? "pièces Matter" : "d'après les noms"}). Vérifie et corrige si besoin.` : "Aucune lampe à ranger (toutes ont une pièce, ou leurs noms ne disent rien).")).catch(e => toast(e.message, true));

// ---------- guide d'appairage Matter selon le matériel
const BRAND_HELP = {
  hue: [
    "Sur l'iPhone, app <b>Maison</b> : ouvre les réglages du <b>pont Hue</b> (ou d'une de ses lampes) et touche <b>« Activer le mode de jumelage »</b>, puis copie le code à 11 chiffres.",
    "Si ce bouton n'existe pas (pont ajouté à Maison via HomeKit et non Matter) : app <b>Hue</b> › Réglages › <b>Smart Home / Matter</b> › génère un code d'appairage. Ensuite, tout le pilotage se fait en Matter.",
    "Colle le code ci-dessus dans les 15 minutes.",
  ],
  maison: [
    "N'importe quel appareil <b>Matter</b> déjà ajouté à l'app <b>Maison</b> peut être partagé ici : ouvre ses réglages et touche <b>« Activer le mode de jumelage »</b>.",
    "Copie le code à 11 chiffres et colle-le ci-dessus dans les 15 minutes.",
  ],
  zigbee: [
    "Le plus simple : ajoute ces lampes à ton <b>pont Hue</b> (app Hue › <b>Ajouter une lampe</b> ; pour certaines marques, avec le numéro de série imprimé sur l'ampoule). Elles apparaîtront ici toutes seules, par le pont.",
    "Sinon : une passerelle Zigbee compatible Matter (IKEA DIRIGERA, Aqara, SmartThings…) à appairer ici, ou une clé USB Zigbee avec Zigbee2MQTT / Home Assistant (carte « Autres systèmes »).",
  ],
  ikea: [
    "Dans l'app <b>IKEA Home smart</b>, ouvre les réglages du hub <b>DIRIGERA</b> et cherche l'option <b>Matter</b> (partager / associer à une autre plateforme) : l'app affiche un code d'appairage.",
    "Colle-le ci-dessus : les lampes IKEA (Zigbee) arrivent ici par le hub.",
  ],
  aqara: [
    "Dans l'app <b>Aqara Home</b>, ouvre ton hub (M2, M3…) et cherche le <b>pont Matter</b> (« Matter Bridge » / intégrations Matter) : choisis d'ajouter un autre écosystème pour obtenir un code.",
    "Colle-le ci-dessus : les lampes reliées au hub arrivent ici.",
  ],
  smartthings: [
    "Dans l'app <b>SmartThings</b>, ouvre l'appareil (ou le hub) et cherche le partage <b>Matter</b> avec d'autres services : l'app génère un code d'appairage.",
    "Colle-le ci-dessus.",
  ],
  smartlife: [
    "Seuls les appareils <b>compatibles Matter</b> (logo Matter sur la boîte) ou derrière une passerelle Tuya compatible Matter peuvent venir ici directement.",
    "Dans l'app <b>Smart Life</b>, ouvre l'appareil, puis ses réglages (✎ ou ⋯) et cherche <b>Matter</b> / partage vers un autre écosystème : l'app affiche un code. Colle-le ci-dessus.",
    "Appareils Smart Life sans Matter : passe par <b>Home Assistant</b> (carte « Autres systèmes »).",
  ],
  lampe: [
    "Ampoule ou ruban neuf : le code Matter est imprimé sur l'appareil ou sa notice (11 chiffres, ou QR code « MT:… »).",
    "Déjà installé dans l'app Maison ou l'app du fabricant : active le <b>mode de jumelage</b> (partage Matter) pour obtenir un nouveau code, puis colle-le ci-dessus.",
  ],
};
function renderBrandHelp() {
  const k = $("#brandSel").value;
  $("#brandHelp").innerHTML = (BRAND_HELP[k] ?? BRAND_HELP.hue).map(x => `<li>${x}</li>`).join("");
}
$("#brandSel").onchange = renderBrandHelp;
renderBrandHelp();

// ---------- autres systèmes (WiZ, Home Assistant, Zigbee2MQTT)
const SOURCE = { matter: "Matter", wiz: "WiZ", ha: "Home Assistant", z2m: "Zigbee2MQTT" };
// ---------- réseaux (plusieurs Wi-Fi)
function netSelect(key) {
  const nw = S.st.network; if (!nw || !(nw.networks || []).length) return "";
  const cur = nw.devices?.[key] ?? "";
  const opts = nw.networks.map(n => `<option value="${esc(n.id)}" ${n.id === cur ? "selected" : ""}>${esc(n.name)}${n.here ? " (actuel)" : ""}</option>`).join("")
    + `<option value="*" ${cur === "*" ? "selected" : ""}>Tous les réseaux</option>`;
  return `<label class="small muted net-sel">Réseau <select data-netkey="${esc(key)}">${cur ? "" : `<option value="">—</option>`}${opts}</select></label>`;
}
function bindNetSelects(root) {
  root.querySelectorAll("select[data-netkey]").forEach(sel => sel.onchange = () =>
    api("PUT", "/api/devices/network", { key: sel.dataset.netkey, network: sel.value }).then(() => toast("Réseau de l'appareil enregistré.")).catch(e => toast(e.message, true)));
}
function renderNetwork() {
  const nw = S.st.network, pill = $("#netPill"), box = $("#netBody");
  if (!nw) { pill.classList.add("hidden"); box.innerHTML = ""; return; }
  const cur = (nw.networks || []).find(n => n.here);
  const several = (nw.networks || []).length > 1;
  if (cur) pill.textContent = `📶 ${cur.name}`;
  pill.className = "pill" + (cur && several ? "" : " hidden") + (nw.online ? "" : " err");
  const sig = JSON.stringify([nw, S.st.nodes]);
  if (box.contains(document.activeElement) || box.dataset.sig === sig) return; // pas pendant une saisie
  box.dataset.sig = sig;
  const fmt = t => t ? new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
  const devs = list => list.length ? list.map(d => esc(d.name)).join(", ") : `<span class="muted">aucun appareil</span>`;
  let html = "";
  if (!cur) html += `<p class="warn">Le Mac n'est connecté à aucun réseau pour l'instant.</p>`;
  else {
    html += `<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">Le Mac est sur <input class="text" id="netName" value="${esc(cur.name)}" style="flex:1;min-width:120px;max-width:220px" title="Renommer ce réseau (ex. Maison, Bureau, Chez mes parents)"></div>
      <p class="muted" style="margin:6px 0">${nw.ssid ? `Wi-Fi « ${esc(nw.ssid)} » · ` : (nw.iface && !/^en0$/.test(nw.iface) ? "" : "Nom du Wi-Fi masqué par macOS · ")}box ${esc(nw.gateway || cur.gateway || "?")}${nw.online ? "" : " · <b>déconnecté</b>"}</p>
      <p style="margin:6px 0">Appareils de ce réseau : ${devs(cur.devices)}</p>`;
  }
  if ((nw.everywhere || []).length) html += `<p style="margin:6px 0">Sur tous les réseaux : ${devs(nw.everywhere)}</p>`;
  const others = (nw.networks || []).filter(n => !n.here);
  if (others.length) {
    html += `<h3 style="margin-top:12px">Autres réseaux</h3>` + others.map(n => `<div class="room-row">
      <div class="top"><b style="flex:1">${esc(n.name)}</b><span class="muted">vu le ${fmt(n.lastSeen)}</span></div>
      <div class="muted" style="margin:4px 0">${n.ssids?.length ? `Wi-Fi ${n.ssids.map(esc).join(", ")} · ` : ""}${devs(n.devices)} <span class="muted">(en pause tant que le Mac n'est pas sur ce réseau)</span></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        ${cur ? `<button class="btn small ghost" data-merge="${esc(n.id)}" title="Par exemple après un changement de box : ses appareils passent sur « ${esc(cur.name)} »">C'est le même que « ${esc(cur.name)} »</button>` : ""}
        <button class="btn small ghost danger" data-forget="${esc(n.id)}">Oublier</button>
      </div></div>`).join("");
  } else {
    html += `<p class="muted" style="margin-top:8px">Tu as plusieurs Wi-Fi (maison, bureau, chez tes parents…) ? Chaque appareil est rattaché au réseau où tu l'as ajouté. Quand le Mac change de Wi-Fi, seuls les accessoires présents sur ce réseau apparaissent et sont pilotés ; les autres attendent, en pause. Tu peux changer le réseau d'un appareil dans <b>Appareils appairés</b> (ou « Tous les réseaux »).</p>`;
  }
  box.innerHTML = html;
  const nm = $("#netName");
  if (nm) nm.onchange = () => api("PATCH", `/api/networks/${encodeURIComponent(cur.id)}`, { name: nm.value }).then(() => toast("Réseau renommé.")).catch(e => toast(e.message, true));
  box.querySelectorAll("[data-merge]").forEach(b => b.onclick = () => {
    if (confirm(`Les appareils de « ${others.find(n => n.id === b.dataset.merge)?.name} » passent sur « ${cur.name} » (utile après un changement de box). Continuer ?`))
      api("POST", `/api/networks/${encodeURIComponent(b.dataset.merge)}/merge`).then(r => toast(`${r.moved} appareil(s) rattaché(s) à « ${cur.name} ».`)).catch(e => toast(e.message, true));
  });
  box.querySelectorAll("[data-forget]").forEach(b => b.onclick = () => {
    if (confirm("Oublier ce réseau ? Ses appareils seront utilisés sur tous les réseaux.")) api("DELETE", `/api/networks/${encodeURIComponent(b.dataset.forget)}`).catch(e => toast(e.message, true));
  });
}

function renderIntegrations() {
  const all = S.st.integrations || {};
  for (const [id, cfg] of Object.entries(all)) {
    const box = $(`#integ-${id}`); if (!box) continue;
    const st = cfg.status || {};
    const ok = /connecté/.test(st.state || "");
    let ns = box.querySelector(".integ-net");
    if (!ns) { box.querySelector("[data-save]").parentElement.insertAdjacentHTML("beforebegin", `<div class="integ-net" style="margin:6px 0"></div>`); ns = box.querySelector(".integ-net"); }
    const nsHtml = cfg.enabled ? netSelect(`integ:${id}`) : "";
    if (ns.dataset.sig !== nsHtml) { ns.innerHTML = nsHtml; ns.dataset.sig = nsHtml; bindNetSelects(ns); }
    box.querySelector(".istatus").innerHTML = cfg.enabled
      ? `<span class="badge ${st.error ? "bad" : ""}">${esc(st.state || "")}${ok ? ` · ${st.count} lampe${st.count > 1 ? "s" : ""}` : ""}</span>${st.error ? ` <span class="muted">${esc(st.error)}</span>` : ""}`
      : `<span class="muted">désactivé</span>`;
    box.querySelectorAll("[data-f]").forEach(inp => {
      if (inp.dataset.dirty) return;
      const f = inp.dataset.f, v = cfg[f];
      if (inp.type === "checkbox") inp.checked = !!v;
      else if (document.activeElement !== inp) inp.value = Array.isArray(v) ? v.join(", ") : (v ?? "");
    });
  }
}
document.querySelectorAll("details.integ").forEach(box => {
  const id = box.id.replace("integ-", "");
  box.querySelectorAll("[data-f]").forEach(inp => inp.addEventListener("input", () => (inp.dataset.dirty = "1")));
  const save = () => {
    const body = {};
    box.querySelectorAll("[data-f]").forEach(inp => { body[inp.dataset.f] = inp.type === "checkbox" ? inp.checked : inp.value; delete inp.dataset.dirty; });
    api("PUT", `/api/integrations/${id}`, body).then(r => toast(`${box.querySelector("summary b").textContent} : ${r.status?.state ?? "enregistré"}`)).catch(e => toast(e.message, true));
  };
  box.querySelector("[data-save]").onclick = save;
  box.querySelector("[data-f=enabled]").onchange = save;
  const rf = box.querySelector("[data-refresh]");
  if (rf) rf.onclick = () => api("POST", `/api/integrations/${id}/refresh`).then(() => toast("Recherche lancée…")).catch(e => toast(e.message, true));
});

function renderNodes() {
  const nodes = S.st.nodes;
  const pairing = S.st.matter.pairing;
  $("#pairBtn").disabled = pairing || !S.st.matter.ready;
  $("#pairBtn").textContent = pairing ? "Appairage…" : "Appairer";
  const list = $("#nodeList");
  const sig = JSON.stringify([nodes, S.st.network?.devices, (S.st.network?.networks || []).map(n => [n.id, n.name, n.here]), allNetLamps().map(l => l.nodeId)]);
  if (list.dataset.sig === sig || list.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;
  list.dataset.sig = sig;
  list.innerHTML = nodes.length ? nodes.map(n => {
    const count = allNetLamps().filter(l => l.nodeId === n.id).length;
    return `<div class="node-row"><div style="flex:1"><b>${esc(n.name)}</b><div class="small ${n.state === "connecté" || n.paused ? "muted" : "warn"}">${esc(n.state)} · ${count} lampe${count > 1 ? "s" : ""}</div>${netSelect(`matter:${n.id}`)}</div>
      <button class="btn small danger" data-id="${esc(n.id)}" title="Retire uniquement ce contrôleur ; l'appareil reste dans l'app Maison">Retirer</button></div>`;
  }).join("") : `<p class="muted small">Aucun appareil appairé.</p>`;
  bindNetSelects($("#nodeList"));
  document.querySelectorAll("#nodeList [data-id]").forEach(b => b.onclick = () => {
    const n = nodes.find(x => x.id === b.dataset.id);
    if (!confirm(`Retirer « ${n?.name ?? "cet appareil"} » du show ?\n\nIl reste dans l'app Maison. S'il ne répond pas, il est retiré quand même (nettoyage local) et tu pourras le réappairer ensuite.`)) return;
    api("DELETE", `/api/nodes/${encodeURIComponent(b.dataset.id)}`).then(() => toast("Retrait en cours… (quelques secondes, résultat dans le journal)")).catch(e => toast(e.message, true));
  });
}
$("#pairBtn").onclick = async () => {
  const code = $("#pairCode").value.trim();
  if (!code) return toast("Colle d'abord le code d'appairage", true);
  try { await api("POST", "/api/pair", { code }); toast("Appairage lancé… (jusqu'à une minute)"); $("#pairCode").value = ""; }
  catch (e) { toast(e.message, true); }
};
