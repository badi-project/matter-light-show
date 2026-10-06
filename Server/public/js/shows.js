// Show lumière — Liste des shows, éditeur de show, sélecteur de couleur.
// (Scripts classiques chargés dans l'ordre par index.html : ils partagent leurs noms de haut niveau.)
// =====================================================================================
// Liste des shows
// =====================================================================================
function renderShowList() {
  const p = S.st.player;
  const html = S.st.shows.map(s => `
    <div class="item ${s.id === S.showId ? "on" : ""}" data-id="${esc(s.id)}">
      <span>${esc(s.name)} <span class="muted small">· ${s.steps} ét.</span></span>
      ${p.playing && p.showId === s.id ? `<span class="playing" title="${p.sync ? "En synchro avec la musique" : "En cours"}"></span>` : ""}
    </div>`).join("") || `<div class="muted small" style="padding:8px">Aucun show.</div>`;
  if (setHtml($("#showList"), html)) document.querySelectorAll("#showList .item").forEach(i => i.onclick = () => openShow(i.dataset.id));
}

async function openShow(id) {
  if (S.saveTimer) await flushSave();
  S.showId = id; localStorage.setItem("showId", id);
  try { S.show = await api("GET", `/api/shows/${encodeURIComponent(id)}`); } catch { S.show = null; }
  renderShowList(); renderEditor();
}

$("#newShow").onclick = async () => {
  try {
    const show = await api("POST", "/api/shows", { name: "Nouveau show", loop: true, speed: 1, steps: [newStep()] });
    await openShow(show.id);
    document.querySelector(".name-input")?.select();
  } catch (e) { toast(e.message, true); }
};
$("#importShow").onclick = () => $("#importFile").click();
$("#importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const data = JSON.parse(await f.text()); delete data.id; const s = await api("POST", "/api/shows", data); await openShow(s.id); toast("Show importé"); }
  catch (err) { toast("Fichier invalide : " + err.message, true); }
  e.target.value = "";
};

// =====================================================================================
// Éditeur de show
// =====================================================================================
function newStep(from) {
  if (from) return JSON.parse(JSON.stringify(from));
  return { name: "Nouvelle étape", duration: 4, fade: 1.5, mode: "all", all: { on: true, color: "#2b50ff", brightness: 80 }, palette: { colors: ["#ff0000", "#00d84a", "#2b50ff"], brightness: 80, shift: 0 }, lamps: {} };
}
function save() {
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(flushSave, 500);
}
async function flushSave() {
  clearTimeout(S.saveTimer); S.saveTimer = null;
  if (!S.show) return;
  try { await api("PUT", `/api/shows/${encodeURIComponent(S.show.id)}`, S.show); } catch (e) { toast("Sauvegarde impossible : " + e.message, true); }
}
const unitSec = sh => (sh?.tempo?.bpm ? 60 / Number(sh.tempo.bpm) : 1); // show musical : durées en temps
const unitLabel = sh => (sh?.tempo?.bpm ? "temps" : "s");
const totalUnits = sh => sh.steps.reduce((a, s) => a + (Number(s.duration) || 0), 0);
const totalDuration = sh => (totalUnits(sh) * unitSec(sh)) / (Number(sh.speed) || 1);
const durationText = sh => sh.tempo?.bpm
  ? `Durée : ${totalUnits(sh)} temps (≈ ${fmtTime(totalDuration(sh))} à ${sh.tempo.bpm} BPM)${sh.loop ? ", en boucle" : ""}`
  : `Durée totale : ${fmtTime(totalDuration(sh))}${sh.loop ? " (en boucle)" : ""}`;
const fmtTime = s => s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s * 10) / 10} s`;

function renderEditor() {
  const ed = $("#editor"), sh = S.show;
  if (!sh) { ed.innerHTML = `<div class="panel empty">Crée ton premier show avec <b>+ Nouveau</b>.</div>`; return; }
  const playingThis = S.st.player.playing && S.st.player.showId === sh.id;
  ed.innerHTML = `
    <div class="panel">
      <div class="editor-head">
        <input class="name-input" id="showName" value="${esc(sh.name)}" aria-label="Nom du show">
        <button class="btn primary" id="playBtn">${playingThis ? ICON.stop + " Arrêter" : ICON.play + " Lancer"}</button>
        <label class="toggle" title="Recommencer au début à la fin"><input type="checkbox" id="loop" ${sh.loop ? "checked" : ""}><span class="sw"></span>Boucle</label>
        <span class="field">Vitesse
          <select id="speed">${[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map(v => `<option value="${v}" ${Number(sh.speed || 1) === v ? "selected" : ""}>${String(v).replace(".", ",")}×</option>`).join("")}</select>
        </span>
        <label class="toggle" title="Compter les durées en temps musicaux pour se caler sur la musique (onglet Musique)"><input type="checkbox" id="musical" ${sh.tempo ? "checked" : ""}><span class="sw"></span>♪ Musical</label>
        ${sh.tempo ? `<span class="field" title="Tempo utilisé quand tu lances le show à la main. En synchro musique, c'est le tempo du morceau qui compte.">Tempo <input class="num" id="bpm" type="number" min="40" max="240" step="1" value="${sh.tempo.bpm}"> BPM</span>` : ""}
        <span class="spacer"></span>
        <button class="iconbtn" id="exportShow" title="Exporter (fichier .json)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 11.5v2h11v-2"/></svg></button>
        <button class="iconbtn" id="dupShow" title="Dupliquer ce show">${ICON.dup}</button>
        <button class="iconbtn" id="delShow" title="Supprimer ce show">${ICON.del}</button>
      </div>
      ${sh.tempo ? `<div class="kw-row"><span>♪ Se lance tout seul (synchro musique) sur les playlists, genres ou titres contenant :</span>
        <input id="kw" class="kw" value="${esc((sh.music?.match || []).join(", "))}" placeholder="ex. noël, christmas, jingle"></div>` : ""}
      <div class="timeline" id="timeline"></div>
      <div class="timeline-info"><span>${sh.steps.length} étape${sh.steps.length > 1 ? "s" : ""}</span><span>${durationText(sh)}</span></div>
    </div>
    <div class="steps" id="steps"></div>
    <button class="add-step" id="addStep">+ Ajouter une étape</button>`;

  $("#showName").oninput = e => { sh.name = e.target.value; save(); };
  $("#showName").onchange = () => flushSave().then(() => api("GET", "/api/shows")).then(l => { S.st.shows = l; renderShowList(); }).catch(e => toast(e.message, true));
  $("#loop").onchange = e => { sh.loop = e.target.checked; save(); renderEditorHeadInfo(); };
  $("#speed").onchange = e => { sh.speed = Number(e.target.value); save(); renderEditorHeadInfo(); };
  $("#playBtn").onclick = togglePlay;
  $("#musical").onchange = e => {
    // conversion secondes <-> temps (à 120 BPM par défaut)
    const bpm = sh.tempo?.bpm || 120, k = e.target.checked ? bpm / 60 : 60 / bpm;
    const r = v => Math.max(0, Math.round(v * (e.target.checked ? 2 : 10)) / (e.target.checked ? 2 : 10));
    sh.steps.forEach(st => { st.duration = Math.max(e.target.checked ? 0.5 : 0.2, r((Number(st.duration) || 1) * k)); st.fade = r((Number(st.fade) || 0) * k); });
    if (e.target.checked) { sh.tempo = { bpm }; sh.music ||= { match: [] }; } else delete sh.tempo;
    save(); renderEditor();
  };
  $("#bpm")?.addEventListener("input", e => { const v = Number(e.target.value); if (v >= 40 && v <= 240) { sh.tempo.bpm = v; save(); renderEditorHeadInfo(); document.querySelectorAll(".step").forEach((el, i) => updateFoot(el, sh.steps[i])); } });
  $("#kw")?.addEventListener("input", e => { sh.music = { ...(sh.music || {}), match: e.target.value.split(",").map(x => x.trim()).filter(Boolean) }; save(); });
  $("#exportShow").onclick = () => {
    const blob = new Blob([JSON.stringify({ ...sh, id: undefined }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${sh.name.replace(/[^\w\-]+/g, "_") || "show"}.json`; a.click();
  };
  $("#dupShow").onclick = async () => { try { await flushSave(); const c = await api("POST", "/api/shows", { ...sh, id: undefined, name: sh.name + " (copie)" }); openShow(c.id); } catch (e) { toast(e.message, true); } };
  $("#delShow").onclick = async () => {
    if (!confirm(`Supprimer le show « ${sh.name} » ?`)) return;
    try { await api("DELETE", `/api/shows/${encodeURIComponent(sh.id)}`); S.show = null; S.showId = null; localStorage.removeItem("showId"); } catch (e) { toast(e.message, true); }
  };
  $("#addStep").onclick = () => { sh.steps.push(newStep(sh.steps[sh.steps.length - 1])); if (sh.steps.length > 1) sh.steps[sh.steps.length - 1].name = "Étape " + sh.steps.length; save(); renderEditor(); document.querySelector(".step:last-child")?.scrollIntoView({ behavior: "smooth", block: "center" }); };

  const box = $("#steps");
  sh.steps.forEach((st, i) => box.appendChild(stepCard(st, i)));
  renderTimeline(); renderPlayer();
}
function renderEditorHeadInfo() {
  const sh = S.show; const info = document.querySelector(".timeline-info span:last-child");
  if (info) info.textContent = durationText(sh);
}

function renderTimeline() {
  const sh = S.show, tl = $("#timeline"); if (!tl) return;
  const ls = activeLamps();
  tl.innerHTML = sh.steps.map((st, i) => {
    const pool = ls.length ? ls : [{ id: "x" }];
    const res = resolveStep(st, pool);
    const cols = pool.filter(l => res[l.id]).map(l => res[l.id].on ? shown(l, res[l.id].color) : "#141820");
    const bg = cols.length > 1 ? `linear-gradient(90deg, ${cols.join(",")})` : (cols[0] || "#1d222d");
    return `<div class="blk" data-i="${i}" style="flex:${Math.max(0.2, Number(st.duration) || 1)};background:${bg}" title="${esc((i + 1) + ". " + st.name)} — ${st.duration}s"><div class="prog"></div></div>`;
  }).join("");
  tl.querySelectorAll(".blk").forEach(b => b.onclick = () => document.querySelectorAll(".step")[b.dataset.i]?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function renderPlayer() {
  const p = S.st.player, sh = S.show;
  renderShowList();
  if (!sh) return;
  const mine = p.showId === sh.id;
  const btn = $("#playBtn");
  if (btn) btn.innerHTML = p.playing && mine ? ICON.stop + " Arrêter" : ICON.play + " Lancer";
  document.querySelectorAll(".step").forEach((el, i) => el.classList.toggle("cur", mine && p.step === i && (p.playing || Date.now() - p.stepStartedAt < 60000)));
  document.querySelectorAll(".timeline .blk").forEach((el, i) => {
    const cur = mine && p.playing && p.step === i;
    el.classList.toggle("cur", cur);
    const pr = el.querySelector(".prog");
    pr.style.transition = "none"; pr.style.width = "0";
    if (cur) { void pr.offsetWidth; const left = Math.max(0, p.stepDuration * 1000 - (Date.now() - p.stepStartedAt)); pr.style.transition = `width ${left}ms linear`; pr.style.width = "100%"; }
  });
}

async function togglePlay() {
  const p = S.st.player;
  try {
    if (p.playing && p.showId === S.show.id) await (p.sync ? api("POST", "/api/music/sync", { enabled: false }) : api("POST", "/api/stop"));
    else { await flushSave(); await api("POST", "/api/play", { show: S.show }); }
  } catch (e) { toast(e.message, true); }
}

// ---------- Carte d'une étape ----------
function stepCard(st, i) {
  const sh = S.show;
  st.mode ||= "all"; st.all ||= { on: true, color: "#ffffff", brightness: 80 };
  st.palette ||= { colors: ["#ff0000", "#00d84a", "#2b50ff"], brightness: 80, shift: 0 }; st.lamps ||= {};
  const el = document.createElement("div");
  el.className = "panel step";
  el.innerHTML = `
    <div class="step-head">
      <span class="step-num">${i + 1}</span>
      <input class="step-name" value="${esc(st.name)}" aria-label="Nom de l'étape">
      <span class="field" title="Temps passé sur cette étape avant de passer à la suivante">Durée <input class="num" type="number" min="0.2" step="${sh.tempo ? 0.5 : 0.1}" data-k="duration" value="${st.duration}"> ${unitLabel(sh)}</span>
      <span class="field" title="Temps de transition progressive vers les nouvelles couleurs">Fondu <input class="num" type="number" min="0" step="${sh.tempo ? 0.25 : 0.1}" data-k="fade" value="${st.fade}"> ${unitLabel(sh)}</span>
      <span class="step-tools">
        <button class="iconbtn" data-a="test" title="Tester cette étape sur les lampes">${ICON.eye}</button>
        <button class="iconbtn" data-a="from" title="Lancer le show à partir d'ici">${ICON.play}</button>
        <button class="iconbtn" data-a="dup" title="Dupliquer">${ICON.dup}</button>
        <button class="iconbtn" data-a="up" title="Monter" ${i === 0 ? "disabled" : ""}>${ICON.up}</button>
        <button class="iconbtn" data-a="down" title="Descendre" ${i === sh.steps.length - 1 ? "disabled" : ""}>${ICON.down}</button>
        <button class="iconbtn" data-a="del" title="Supprimer">${ICON.del}</button>
      </span>
    </div>
    <div class="seg">
      <button data-m="all" class="${st.mode === "all" ? "on" : ""}">Toutes pareilles</button>
      <button data-m="palette" class="${st.mode === "palette" ? "on" : ""}">Palette répartie</button>
      <button data-m="custom" class="${st.mode === "custom" ? "on" : ""}">Lampe par lampe</button>
    </div>
    <div class="body"></div>
    <div class="step-foot"><span class="muted small">Résultat :</span><span class="dots"></span><span class="warn"></span></div>`;

  const refresh = () => { const n = stepCard(st, sh.steps.indexOf(st)); el.replaceWith(n); renderTimeline(); renderPlayer(); };
  el.querySelector(".step-name").oninput = e => { st.name = e.target.value; save(); };
  el.querySelectorAll(".num").forEach(inp => inp.oninput = () => { const v = parseFloat(inp.value.replace(",", ".")); if (!isNaN(v)) { st[inp.dataset.k] = Math.max(inp.dataset.k === "duration" ? 0.2 : 0, v); save(); renderTimeline(); renderEditorHeadInfo(); updateFoot(el, st); } });
  el.querySelectorAll(".seg button").forEach(b => b.onclick = () => { st.mode = b.dataset.m; save(); refresh(); });
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
    const idx = sh.steps.indexOf(st), a = b.dataset.a;
    if (a === "test") { await flushSave(); api("POST", "/api/step", { show: sh, index: idx }).catch(e => toast(e.message, true)); return; }
    if (a === "from") { await flushSave(); api("POST", "/api/play", { show: sh, from: idx }).catch(e => toast(e.message, true)); return; }
    if (a === "dup") { const c = newStep(st); c.name = st.name + " (bis)"; sh.steps.splice(idx + 1, 0, c); }
    if (a === "up" && idx > 0) [sh.steps[idx - 1], sh.steps[idx]] = [sh.steps[idx], sh.steps[idx - 1]];
    if (a === "down" && idx < sh.steps.length - 1) [sh.steps[idx + 1], sh.steps[idx]] = [sh.steps[idx], sh.steps[idx + 1]];
    if (a === "del") { if (sh.steps.length > 1 && !confirm(`Supprimer l'étape « ${st.name} » ?`)) return; sh.steps.splice(idx, 1); }
    save(); renderEditor();
  });

  const body = el.querySelector(".body");
  if (st.mode === "all") {
    const a = st.all, on = a.on !== false;
    body.innerHTML = `<div class="row">
      <div class="swatch ${on ? "" : "off"}" style="background:${disp(a.color)}" title="Choisir la couleur"></div>
      <div><div style="font-weight:600">${on ? esc(colorLabel(a.color)) : "Éteintes"}</div><div class="muted small">Toutes les lampes</div></div>
      <label class="slider">Luminosité <input type="range" min="1" max="100" value="${a.brightness ?? 80}" ${on ? "" : "disabled"}> <b>${a.brightness ?? 80}%</b></label>
    </div>`;
    body.querySelector(".swatch").onclick = ev => openPicker(ev.currentTarget, { value: on ? a.color : "off", allowOff: true }, v => { if (v === "off") a.on = false; else { a.on = true; a.color = v; } save(); refresh(); });
    bindRange(body, v => { a.brightness = v; }, st, el);
  } else if (st.mode === "palette") {
    const p = st.palette;
    body.innerHTML = `<div class="row">
      <div class="row" style="gap:8px">${p.colors.map((c, k) => `<div class="swatch sm ${c === "off" ? "off" : ""}" data-k="${k}" style="background:${disp(c)}" title="${esc(colorLabel(c))}"><span class="x" data-x="${k}">×</span></div>`).join("")}<button class="addsw" title="Ajouter une couleur">+</button></div>
      <label class="slider">Luminosité <input type="range" min="1" max="100" value="${p.brightness ?? 80}"> <b>${p.brightness ?? 80}%</b></label>
      <span class="field" title="Décale les couleurs d'une lampe à l'autre — enchaîne plusieurs étapes décalées pour un effet de mouvement">Décalage
        <button class="btn small" data-s="-1">−</button><b>${p.shift || 0}</b><button class="btn small" data-s="1">+</button></span>
      <button class="btn small" data-next title="Ajoute juste après une copie de cette étape décalée d'un cran">Étape suivante décalée →</button>
    </div>
    <p class="muted small" style="margin:8px 0 0">Les couleurs sont distribuées dans l'ordre des lampes (onglet Lampes), puis on recommence. « Éteinte » crée des trous : pratique pour un chenillard.</p>`;
    body.querySelectorAll(".swatch[data-k]").forEach(sw => sw.onclick = ev => {
      if (ev.target.dataset.x !== undefined) { p.colors.splice(Number(ev.target.dataset.x), 1); save(); refresh(); return; }
      const k = Number(sw.dataset.k);
      openPicker(sw, { value: p.colors[k], allowOff: true }, v => { p.colors[k] = v; save(); refresh(); });
    });
    body.querySelector(".addsw").onclick = ev => openPicker(ev.currentTarget, { value: null, allowOff: true }, v => { p.colors.push(v); save(); refresh(); });
    body.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { p.shift = (Number(p.shift) || 0) + Number(b.dataset.s); save(); refresh(); });
    body.querySelector("[data-next]").onclick = () => {
      const idx = sh.steps.indexOf(st), c = newStep(st);
      c.palette.shift = (Number(p.shift) || 0) + 1; c.name = st.name.replace(/\s*\(\+\d+\)$/, "") + ` (+${c.palette.shift})`;
      sh.steps.splice(idx + 1, 0, c); save(); renderEditor();
    };
    bindRange(body, v => { p.brightness = v; }, st, el);
  } else {
    const ls = activeLamps();
    body.innerHTML = ls.length ? `<div class="lamp-grid">${ls.map(l => {
      const s = st.lamps[l.id];
      const label = !s ? "Inchangée" : s.on === false ? "Éteinte" : `${colorLabel(s.color)} · ${s.brightness ?? 100}%`;
      return `<div class="lamp-tile ${s ? "" : "unchanged"}" data-id="${esc(l.id)}">
        <div class="swatch sm ${s && s.on === false ? "off" : ""}" style="background:${s && s.on !== false ? disp(s.color) : "#262b37"}"></div>
        <div class="t"><div class="n">${esc(l.name)}</div><div class="s">${esc(label)}</div></div></div>`;
    }).join("")}</div>
    <div class="row" style="margin-top:10px"><button class="btn small" data-fill>Tout remplir depuis l'étape précédente</button><button class="btn small ghost" data-clear>Tout mettre « inchangée »</button></div>`
    : `<p class="muted">Aucune lampe active. Appaire ton pont dans l'onglet Lampes (ou active le mode démo).</p>`;
    body.querySelectorAll(".lamp-tile").forEach(t => t.onclick = () => {
      const id = t.dataset.id, lamp = ls.find(l => l.id === id), s = st.lamps[id];
      openPicker(t, { value: s ? (s.on === false ? "off" : s.color) : null, allowOff: true, allowUnchanged: true, brightness: s?.brightness ?? 80, lamp }, (v, extra) => {
        if (v === null) delete st.lamps[id];
        else if (v === "off") st.lamps[id] = { on: false };
        else st.lamps[id] = { on: true, color: v, brightness: extra?.brightness ?? s?.brightness ?? 80 };
        save(); refresh();
      });
    });
    body.querySelector("[data-fill]")?.addEventListener("click", () => {
      const idx = sh.steps.indexOf(st); const prev = sh.steps[idx - 1];
      if (!prev) return toast("Pas d'étape précédente");
      const r = resolveStep(prev, ls); st.lamps = {};
      for (const [id, s] of Object.entries(r)) st.lamps[id] = s.on ? { on: true, color: s.color, brightness: s.brightness } : { on: false };
      save(); refresh();
    });
    body.querySelector("[data-clear]")?.addEventListener("click", () => { st.lamps = {}; save(); refresh(); });
  }
  updateFoot(el, st);
  return el;
}

function bindRange(body, set, st, el) {
  const r = body.querySelector("input[type=range]"); if (!r) return;
  r.oninput = () => { set(Number(r.value)); r.nextElementSibling.textContent = r.value + "%"; save(); updateFoot(el, st); };
  r.onchange = () => renderTimeline();
}

function updateFoot(el, st) {
  const ls = activeLamps(), res = resolveStep(st, ls);
  el.querySelector(".dots").innerHTML = ls.map(l => { const s = res[l.id]; return !s ? `<i class="unch" title="${esc(l.name)} : inchangée"></i>` : `<i style="background:${s.on ? shown(l, s.color) : "#141820"};opacity:${s.on ? 0.4 + 0.6 * s.brightness / 100 : 1}" title="${esc(l.name)}"></i>`; }).join("") || '<span class="muted small">—</span>';
  // estimation : jusqu'à 2 commandes Matter par lampe réelle (luminosité + couleur)
  const real = ls.filter(l => !l.virtual && res[l.id]).length;
  const need = (real * 2) / (S.st.settings.rate || 10);
  const speed = Number(S.show?.speed) || 1;
  el.querySelector(".warn").textContent = real && need > ((Number(st.duration) || 1) * unitSec(S.show)) / speed
    ? `⚠ Étape courte : le pont a besoin d'environ ${need.toFixed(1)} s pour mettre à jour ${real} lampes.` : "";
}

// =====================================================================================
// Sélecteur de couleur (popover)
// =====================================================================================
let popClose = null;
function openPicker(anchor, opts, onPick) {
  const pop = $("#pop");
  let bright = opts.brightness ?? 80;
  const lamp = opts.lamp;
  const kindNote = lamp && lamp.kind !== "color" ? `<p class="muted small" style="margin:0 0 8px">« ${esc(lamp.name)} » est une lampe ${KIND[lamp.kind].toLowerCase()} : ${lamp.kind === "white" ? "seuls les blancs et la luminosité" : "seule la luminosité"} seront appliqués.</p>` : "";
  pop.innerHTML = `
    ${kindNote}
    ${opts.allowUnchanged || opts.allowOff ? `<div class="state">
      ${opts.allowOff ? `<button class="btn small ${opts.value === "off" ? "sel" : ""}" data-v="off">Éteinte</button>` : ""}
      ${opts.allowUnchanged ? `<button class="btn small ${opts.value === null ? "sel" : ""}" data-v="__unch">Inchangée</button>` : ""}
    </div>` : ""}
    <h4>Couleurs</h4>
    <div class="grid">${PRESETS.map(c => `<div class="swatch ${c === opts.value ? "sel" : ""}" data-v="${c}" style="background:${c}" title="${c}"></div>`).join("")}</div>
    <h4>Pastels</h4>
    <div class="grid">${PASTELS.map(c => `<div class="swatch ${c === opts.value ? "sel" : ""}" data-v="${c}" style="background:${c}" title="${c}"></div>`).join("")}</div>
    <h4>Blancs</h4>
    <div class="whites">${WHITES.map(([k, n]) => `<button data-v="${k}" class="${k === opts.value ? "sel" : ""}" style="background:${kelvinToHex(k)}">${n}<br>${k}</button>`).join("")}</div>
    <div class="custom"><input type="color" value="${opts.value && !isK(opts.value) && opts.value !== "off" ? opts.value : "#ff7a00"}"><span class="muted small">Couleur perso</span>
      <span class="spacer"></span><button class="btn small primary" data-custom>OK</button></div>
    ${opts.allowUnchanged ? `<div class="slider" style="margin-top:10px">Luminosité <input type="range" min="1" max="100" value="${bright}"> <b>${bright}%</b></div>` : ""}`;
  pop.classList.remove("hidden");
  const r = anchor.getBoundingClientRect(), w = 292, h = pop.offsetHeight;
  let left = Math.min(window.innerWidth - w - 10, Math.max(10, r.left));
  let top = r.bottom + 8; if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 8);
  pop.style.left = left + "px"; pop.style.top = top + "px";
  const done = (v) => { close(); onPick(v, { brightness: bright }); };
  pop.querySelectorAll("[data-v]").forEach(b => b.onclick = () => done(b.dataset.v === "__unch" ? null : b.dataset.v));
  pop.querySelector("[data-custom]").onclick = () => done(pop.querySelector("input[type=color]").value);
  const rg = pop.querySelector("input[type=range]");
  if (rg) rg.oninput = () => { bright = Number(rg.value); rg.nextElementSibling.textContent = bright + "%"; };
  function close() { pop.classList.add("hidden"); document.removeEventListener("mousedown", outside, true); document.removeEventListener("keydown", onKey); popClose = null; }
  function outside(e) { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); }
  function onKey(e) { if (e.key === "Escape") close(); }
  popClose?.(); popClose = close;
  setTimeout(() => { document.addEventListener("mousedown", outside, true); document.addEventListener("keydown", onKey); });
}
