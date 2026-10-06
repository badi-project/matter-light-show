// Show lumière — Onglet Musique : source, morceau, synchro, mes couleurs, cohérence, sorties audio, tempo.
// (Scripts classiques chargés dans l'ordre par index.html : ils partagent leurs noms de haut niveau.)
// =====================================================================================
// Onglet Musique
// =====================================================================================
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---------- source de musique (Apple Music, Spotify, autres apps, compte Spotify)
function renderMusicSource(m) {
  const src = m.source; if (!src) return;
  const sel = $("#musicSource");
  const opts = (src.choices || []).map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join("");
  if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }
  if (document.activeElement !== sel) sel.value = src.choice;
  const st = m.state || {};
  $("#musicSourceInfo").innerHTML = st.track || st.running ? `Suivi : <b>${esc(st.app || src.name)}</b>${src.choice === "auto" ? " <span class=\"muted\">(choisi automatiquement : l'app qui joue)</span>" : ""}` : "";
  const caps = src.caps || {};
  $("#playlistRow").classList.toggle("hidden", !caps.playlists);
  renderSpotifyWeb(src.spotifyWeb);
}
$("#musicSource").onchange = e => api("PATCH", "/api/settings", { musicSource: e.target.value }).then(() => toast("Source de musique enregistrée.")).catch(err => toast(err.message, true));
function renderSpotifyWeb(sw) {
  const box = $("#spotifyWebBody"); if (!sw) return;
  const sig = JSON.stringify(sw);
  if (box.dataset.sig === sig || box.contains(document.activeElement)) return;
  box.dataset.sig = sig;
  if (!sw.configured) box.innerHTML = `
    <p>Pour que les lumières suivent Spotify quand il joue sur ton <b>iPhone</b>, une enceinte ou la TV (pas seulement sur le Mac). Il faut un compte <b>Spotify Premium</b> et 2 minutes :</p>
    <ol class="help">
      <li>Va sur <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener" style="color:var(--accent)">developer.spotify.com/dashboard</a>, connecte-toi et clique <b>Create app</b>.</li>
      <li>Nom : <b>Show lumière</b> · Redirect URI : <code>${esc(sw.redirectUri)}</code> (bouton <b>Add</b>) · coche <b>Web API</b> · enregistre.</li>
      <li>Copie le <b>Client ID</b> de l'app et colle-le ici :</li>
    </ol>
    <div class="row" style="gap:8px"><input class="text" id="spClient" placeholder="Client ID (32 caractères)" style="flex:1;min-width:0" autocomplete="off" spellcheck="false"><button class="btn small" id="spSave">Enregistrer</button></div>`;
  else if (!sw.connected) box.innerHTML = `
    <p>App Spotify enregistrée (${esc(sw.clientId)}). Dernière étape : autorise l'accès à ton compte.</p>
    <div class="row" style="gap:8px"><button class="btn small primary" id="spLogin">Se connecter à Spotify</button><button class="btn small ghost" id="spReset">Changer d'app</button></div>
    ${sw.error ? `<p class="music-err">⚠ ${esc(sw.error)}</p>` : ""}`;
  else box.innerHTML = `
    <p>✓ Connecté à Spotify${sw.user ? ` (compte <b>${esc(sw.user)}</b>)` : ""}. ${sw.device ? `Appareil actif : <b>${esc(sw.device.name)}</b>.` : "Aucun appareil Spotify actif en ce moment."}</p>
    <p class="muted">En source automatique, il est suivi quand rien ne joue sur le Mac. Ou choisis-le comme source ci-dessus.</p>
    ${sw.error ? `<p class="music-err">⚠ ${esc(sw.error)}</p>` : ""}
    <div class="row" style="gap:8px"><button class="btn small ghost" id="spOut">Déconnecter</button></div>`;
  const q = id => box.querySelector(id);
  if (q("#spSave")) q("#spSave").onclick = () => api("PUT", "/api/spotify", { clientId: q("#spClient").value }).then(() => toast("App Spotify enregistrée.")).catch(e => toast(e.message, true));
  if (q("#spLogin")) q("#spLogin").onclick = () => { location.href = "/api/spotify/login"; };
  if (q("#spReset")) q("#spReset").onclick = () => api("PUT", "/api/spotify", { clientId: "" }).catch(e => toast(e.message, true));
  if (q("#spOut")) q("#spOut").onclick = () => { if (confirm("Déconnecter le compte Spotify ?")) api("POST", "/api/spotify/disconnect").catch(e => toast(e.message, true)); };
}
// retour de la page de connexion Spotify
{
  const q = new URLSearchParams(location.search).get("spotify");
  if (q) {
    setTimeout(() => { document.querySelector('.tabs button[data-tab="music"]')?.click(); toast(q === "ok" ? "Spotify connecté !" : "Connexion à Spotify impossible (voir le journal).", q !== "ok"); }, 600);
    history.replaceState(null, "", location.pathname + location.search.replace(/[?&]spotify=[^&]*/, "").replace(/^&/, "?"));
  }
}

function renderMusic() {
  const m = S.st?.music; if (!m) return;
  const st = m.state, sy = m.sync, tr = st.track;
  const box = $("#musicNow");
  const coverUrl = sy.hasCover && sy.trackKey ? `/api/music/cover?key=${encodeURIComponent(sy.trackKey)}` : null;
  let html = "";
  if (!m.available) html = `<p class="muted">La musique est lue seulement quand ce logiciel tourne sur un Mac.</p>`;
  else if (!tr) html = `<div class="now"><div class="art">♪</div><div><div class="t">${/fermé/i.test(st.status || "") ? (st.status === "Musique fermée" ? "L'app Musique est fermée" : esc(st.status)) : "Rien en lecture"}</div><div class="muted small">Lance de la musique dans Apple Music, Spotify, Deezer…${m.source?.caps?.playlists ? " ou une playlist ci-dessous" : ""}.</div></div></div>`;
  else html = `<div class="now"><div class="art">${coverUrl ? `<img src="${coverUrl}" alt="">` : (st.playing ? "▶" : "❚❚")}</div><div style="min-width:0">
      <div class="t">${esc(tr.name)}</div><div class="muted small">${esc(tr.artist)}${st.playlist ? ` · playlist « ${esc(st.playlist)} »` : ""}${tr.genre ? ` · ${esc(tr.genre)}` : ""}${st.playing ? "" : " · en pause"}</div></div></div>
    <div class="prog"><div id="musicProg"></div></div><div class="times"><span id="musicPos">0:00</span><span>${tr.duration ? mmss(tr.duration) : ""}</span></div>
    <div class="beatline"><span class="beats" id="beatDots"><i></i><i></i><i></i><i></i></span>
      <span>${sy.tempo ? `<b>${Math.round(sy.tempo.bpm)} BPM</b> · ${esc(sy.tempo.source)}` : ""}</span></div>`;
  if (m.error) html += `<p class="music-err">⚠ ${esc(m.error)}</p>`;
  if (tr && m.source?.approx) html += `<p class="small muted">Cette app ne donne pas la position dans le morceau : elle est estimée. Active le <b>micro</b> (synchro) pour caler les lumières sur les temps.</p>`;
  const sig = html;
  if (box.dataset.sig !== sig) { box.innerHTML = html; box.dataset.sig = sig; }

  renderMusicSource(m);
  $("#syncOn").checked = sy.enabled;
  const opts = [
    `<option value="auto">Auto complet : pochette + couleurs d'ambiance (genre, style, tempo)</option>`,
    `<option value="auto-sobre">Auto sobre : pochette + 2 couleurs</option>`,
    `<option value="auto-pochette">Auto pochette : uniquement les couleurs de la pochette</option>`,
    `<option value="auto-nuances">Auto nuances : la pochette en clair, foncé, vif… selon le genre</option>`,
    `<option value="mes-couleurs">Mes couleurs : jusqu'à 6 couleurs que je choisis</option>`,
  ]
    .concat((S.st.shows || []).map(s => `<option value="${esc(s.id)}">Show « ${esc(s.name)} » (rythme de la musique)</option>`));
  const sel = $("#syncChoice");
  if (sel.dataset.sig !== opts.join("")) { sel.innerHTML = opts.join(""); sel.dataset.sig = opts.join(""); }
  // un champ en cours d'utilisation n'est pas remis à jour sous les doigts
  if (document.activeElement !== sel) sel.value = sy.choice;
  if (document.activeElement !== $("#rhythmIntensity")) $("#rhythmIntensity").value = sy.intensity || "auto";
  renderMyColors(sy);
  renderCoherence(sy);

  let status;
  if (!tr) status = "En attente d'un morceau (Apple Music, Spotify, Deezer…).";
  else {
    const sw = list => `<span class="swatches">${list.map(p => `<i style="background:${disp(p.c)}" title="${esc(p.name || "")}"></i>`).join("")}</span>`;
    const groups = [["choisie", "mes couleurs"], ["pochette", "pochette"], ["nuance", "nuances"], ["ambiance", "ambiance"]]
      .map(([src, label]) => [label, (sy.palette || []).filter(p => p.src === src)]).filter(([, l]) => l.length);
    if (sy.auto) {
      status = `Couleurs : ${groups.map(([label, l]) => `${label} ${sw(l)}`).join(" + ")}`;
      if (sy.accent) status += ` · impact ${sw([{ c: sy.accent, name: "impact" }])}`;
      status += `<br><span class="muted">${esc(sy.reason)}</span>`;
    } else status = `Couleurs du show <b>${esc(sy.showName)}</b> <span class="muted">(${esc(sy.reason)})</span>`;
    // genre et caractère
    const g = sy.genre;
    if (g) {
      const src = g.guessed ? "deviné à l'écoute" : (g.sources || []).map(x => x.src === "Deezer" ? `Deezer : ${x.name}` : x.src).join(", ");
      status += `<br>Genre : <b>${esc(g.name)}</b>${src ? ` <span class="muted">(${esc(src)})</span>` : ""}`;
      if (g.label && g.label !== g.name && g.id !== "autre") status += ` · ambiance ${esc(g.label)}`;
    }
    const f = sy.features, e = sy.energy, bits = [];
    if (e) bits.push(`énergie <b>${Math.round(e.value * 100)} %</b>${e.measured ? "" : " (estimée)"}`);
    if (f) {
      if (f.bass > 0.3) bits.push("basses fortes"); else if (f.bass < 0.12) bits.push("peu de basses");
      if (f.brightness > 3000) bits.push("son brillant"); else if (f.brightness < 1200) bits.push("son doux, feutré");
      if (f.pulse >= 0.3) bits.push("pulsation très nette"); else if (f.pulse < 0.06) bits.push("pulsation peu marquée");
    } else if (sy.needs?.audio) bits.push(`<span class="muted">écoute de l'extrait…</span>`);
    if (bits.length) status += `<br>Caractère : ${bits.join(" · ")}`;
    if (sy.tempo) {
      status += `<br>Rythme : <b>${Math.round(sy.tempo.bpm)} BPM</b> <span class="muted">(${esc(sy.tempo.source)})</span>`;
      if (sy.styleLabel) status += ` · style <b>${esc(sy.styleLabel)}</b>`;
      if (sy.rhythm) status += ` · ${esc(sy.rhythm.label)}`;
      if (sy.lampsPerBeat && sy.enabled) status += ` · ${sy.lampsPerBeat} lampe${sy.lampsPerBeat > 1 ? "s" : ""} par temps`;
    }
    const ro = sy.rooms;
    if (ro && (ro.coherence !== "off" || ro.speakerLink) && ro.groups.length) {
      status += `<br>Pièces : ${ro.groups.map(g => `${esc(g.name)} <span class="muted">(${g.lamps})</span>`).join(ro.coherence === "vague" ? " → " : " · ")}`;
      if (ro.inactive) status += ` <span class="muted">· ${ro.inactive} lampe${ro.inactive > 1 ? "s" : ""} hors musique</span>`;
    }
    if (!sy.tempo?.calibrated) status += `<br><span class="muted">Pas encore calé sur les temps : active le micro ci-dessous (ou tape le tempo).</span>`;
    else status += `<br>✓ Calé sur les temps de ce morceau.`;
    if (!sy.enabled) status += `<br><span class="muted">Synchro désactivée : active-la pour que les lumières suivent.</span>`;
  }
  setHtml($("#syncStatus"), status);
  $("#saveAuto").classList.toggle("hidden", !(tr && sy.auto));
  if (document.activeElement !== $("#lead")) { $("#lead").value = m.lead; $("#leadVal").textContent = `${m.lead > 0 ? "+" : ""}${Number(m.lead).toFixed(2)} s`; }
  maybeAnalyze();
}
/** Analyses à faire dans la page pour ce morceau (une fois) : tempo de l'extrait, palette de la pochette. */
function maybeAnalyze() {
  const sy = S.st?.music?.sync;
  if (sy?.trackKey && sy.needs) Analyzer.maybeRun(sy.trackKey, sy.needs);
}

// ---------- mes couleurs (jusqu'à 6)
const swHtml = list => `<span class="swatches">${list.map(p => `<i style="background:${disp(p.c ?? p)}" title="${esc(p.name || colorLabel(p.c ?? p))}"></i>`).join("")}</span>`;
function saveMyColors(cols) { return api("PATCH", "/api/settings", { myColors: cols }).catch(e => toast(e.message, true)); }
function renderMyColors(sy) {
  const box = $("#myColorsBox");
  const on = sy.choice === "mes-couleurs";
  box.classList.toggle("hidden", !on);
  if (!on) return;
  const cols = (S.st.settings.myColors?.length ? S.st.settings.myColors : sy.myColors || []).slice(0, 6);
  const sig = JSON.stringify([cols, sy.palette]);
  if (box.dataset.sig === sig) return; box.dataset.sig = sig;
  $("#myColorsList").innerHTML = cols.map((c, i) => `<div class="swatch sm" data-k="${i}" style="background:${disp(c)}" title="${esc(colorLabel(c))} — cliquer pour changer"><span class="x" data-x="${i}">×</span></div>`).join("")
    + (cols.length < 6 ? `<button class="addsw" id="myAdd" title="Ajouter une couleur">+</button>` : "");
  $("#myColorsOrder").innerHTML = sy.auto && sy.palette?.length && sy.palette[0].src === "choisie" ? swHtml(sy.palette) : `<span class="muted">(lance un morceau pour voir le rangement)</span>`;
  $("#myColorsList").querySelectorAll(".swatch[data-k]").forEach(el => el.onclick = ev => {
    const k = Number(el.dataset.k);
    if (ev.target.dataset.x !== undefined) {
      if (cols.length <= 1) return toast("Garde au moins une couleur", true);
      return saveMyColors(cols.filter((_, i) => i !== k));
    }
    openPicker(el, { value: cols[k] }, v => { if (!v || v === "off") return; const next = [...cols]; next[k] = v; saveMyColors(next); });
  });
  const add = $("#myAdd");
  if (add) add.onclick = () => openPicker(add, { value: null }, v => { if (!v || v === "off") return; saveMyColors([...cols, v].slice(0, 6)); });
}
$("#myColorsApply").onclick = () => api("POST", "/api/mycolors/apply").then(() => toast("Couleurs diffusées (la synchro est en pause).")).catch(e => toast(e.message, true));

// ---------- cohérence par pièce
function renderCoherence(sy) {
  const set = S.st.settings, ro = sy.rooms;
  $("#coherence").value = set.coherence || "off";
  $("#speakerLink").checked = !!set.speakerLink;
  $("#otherRooms").value = set.otherRooms || "blanc";
  $("#otherRoomsRow").classList.toggle("hidden", !set.speakerLink);
  let info = "";
  if (!ro || !ro.defined) info = `Aucune pièce définie : toutes les lampes forment un seul groupe. <a href="#" id="goRooms">Crée tes pièces dans l'onglet Lampes</a>.`;
  else {
    info = `${ro.defined} pièce${ro.defined > 1 ? "s" : ""} définie${ro.defined > 1 ? "s" : ""} (ordre des vagues et enceintes : <a href="#" id="goRooms">onglet Lampes</a>).`;
    if (set.speakerLink) info += ro.linked ? ` Musique dans : <b>${ro.groups.map(g => esc(g.name)).join(", ")}</b>.` : ` Aucune pièce reliée à une enceinte en lecture : le show joue partout.`;
  }
  const box = $("#roomsInfo");
  if (box.dataset.sig !== info) { box.innerHTML = info; box.dataset.sig = info; const a = $("#goRooms"); if (a) a.onclick = e => { e.preventDefault(); document.querySelector('.tabs button[data-tab="lamps"]').click(); }; }
}
$("#coherence").onchange = e => api("PATCH", "/api/settings", { coherence: e.target.value }).catch(err => toast(err.message, true));
$("#speakerLink").onchange = e => api("PATCH", "/api/settings", { speakerLink: e.target.checked }).catch(err => toast(err.message, true));
$("#otherRooms").onchange = e => api("PATCH", "/api/settings", { otherRooms: e.target.value }).catch(err => toast(err.message, true));

// animation : position et battement (estimés entre deux lectures de la musique). Elle ne tourne que lorsqu'elle se voit
// (onglet Musique avec un morceau, ou micro allumé) et ne touche la page que si quelque chose change.
let beatRaf = 0;
const beatShown = { prog: -1, mic: -1 };
const beatNeeded = () => visible() && !!S.st?.music && ((S.tab === "music" && !!S.st.music.state.track) || Mic.on);
function startBeat() {
  if (!beatRaf && beatNeeded()) beatRaf = requestAnimationFrame(beatLoop);
}
function beatLoop() {
  beatRaf = 0;
  if (!beatNeeded()) return;
  const m = S.st.music;
  if (S.tab === "music" && m.state.track) {
    const st = m.state, t = m.state.track;
    const pos = st.playing ? st.position + (Date.now() - st.at) / 1000 : st.position;
    const pr = document.getElementById("musicProg");
    if (pr && t.duration) {
      const f = Math.round(Math.min(1, pos / t.duration) * 1000) / 1000;
      if (f !== beatShown.prog || pr.dataset.f !== String(f)) { pr.style.transform = `scaleX(${f})`; pr.dataset.f = String(f); beatShown.prog = f; }
    }
    const pe = document.getElementById("musicPos"), txt = mmss(Math.max(0, pos));
    if (pe && pe.textContent !== txt) pe.textContent = txt;
    const tp = m.sync.tempo, box = document.getElementById("beatDots");
    if (tp && box) {
      const beat = (pos + Number(m.lead || 0) - tp.phase) / (60 / tp.bpm);
      const n = Math.floor(beat), frac = beat - n;
      const on = String(st.playing && frac < 0.35 ? ((n % 4) + 4) % 4 : -1);
      if (box.dataset.on !== on) { box.querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", String(i) === on)); box.dataset.on = on; }
    }
  }
  const lv = document.getElementById("micLevel");
  const level = Mic.on ? Math.round(Math.min(100, Mic.levelPct)) : 0;
  if (lv && level !== beatShown.mic) { lv.style.width = `${level}%`; beatShown.mic = level; }
  beatRaf = requestAnimationFrame(beatLoop);
}

document.querySelectorAll("[data-cmd]").forEach(b => b.onclick = () => api("POST", "/api/music/command", { action: b.dataset.cmd }).catch(e => toast(e.message, true)));
$("#syncOn").onchange = e => api("POST", "/api/music/sync", { enabled: e.target.checked }).catch(err => toast(err.message, true));
$("#syncChoice").onchange = e => api("POST", "/api/music/sync", { choice: e.target.value }).catch(err => toast(err.message, true));
$("#rhythmIntensity").onchange = e => api("PATCH", "/api/settings", { rhythmIntensity: e.target.value }).catch(err => toast(err.message, true));
$("#lead").oninput = e => $("#leadVal").textContent = `${e.target.value > 0 ? "+" : ""}${Number(e.target.value).toFixed(2)} s`;
$("#lead").onchange = e => api("PATCH", "/api/settings", { musicLead: Number(e.target.value) }).then(() => e.target.blur()).catch(err => toast(err.message, true));
$("#resetCalib").onclick = () => api("DELETE", "/api/music/calibration").then(() => toast("Calage oublié pour ce morceau")).catch(e => toast(e.message, true));
$("#saveAuto").onclick = async () => {
  try { const s = await api("POST", "/api/music/save-auto"); toast(`Show « ${s.name} » enregistré`); } catch (e) { toast(e.message, true); }
};

async function loadPlaylists() {
  try {
    const list = await api("GET", "/api/music/playlists");
    const sel = $("#playlistSel"), cur = sel.value;
    sel.innerHTML = `<option value="">Choisir une playlist…</option>` + list.map(n => `<option>${esc(n)}</option>`).join("");
    sel.value = cur;
  } catch {}
}
$("#playPlaylist").onclick = () => {
  const n = $("#playlistSel").value; if (!n) return toast("Choisis d'abord une playlist", true);
  api("POST", "/api/music/command", { action: "playlist", arg: n }).catch(e => toast(e.message, true));
};
// ---------- sorties audio (Mac, Bluetooth, AirPlay, Spotify Connect, Sonos)
const throttles = {};
function throttled(key, fn) { // envoie au plus 4 fois par seconde pendant qu'on glisse un curseur
  const st = throttles[key] ??= { timer: null, last: null, want: null };
  return v => {
    st.want = v;
    if (st.timer) return;
    const go = () => { if (st.want === st.last) { st.timer = null; return; } st.last = st.want; fn(st.want).catch(e => toast(e.message, true)); st.timer = setTimeout(go, 250); };
    go();
  };
}
const OUT_ICON = { mac: "💻", bluetooth: "🔵", usb: "🔌", tv: "📺", airplay: "◎", autre: "🔈" };
const SP_ICON = { Computer: "💻", Smartphone: "📱", Speaker: "🔈", TV: "📺", AVR: "📻", STB: "📺", AudioDongle: "🔌", GameConsole: "🎮", CastAudio: "🔈", CastVideo: "📺", Automobile: "🚗", Tablet: "📱" };
const volRow = (key, v, label = "🔈") => v == null ? "" : `<div class="out-vol"><span>${label}</span><input type="range" min="0" max="100" step="1" value="${v}" data-volkey="${esc(key)}"><b>${v}</b></div>`;
async function loadOutputs() {
  const box = $("#outputsBody");
  let o;
  try { o = await api("GET", "/api/audio/outputs"); } catch (e) { box.innerHTML = `<p class="music-err">${esc(e.message)}</p>`; return; }
  S.speakers = o.names || S.speakers;
  const secs = [];
  // sortie du Mac
  if (o.mac?.available) {
    const list = o.mac.outputs || [];
    secs.push(`<div class="out-sec"><h3>Sortie du Mac</h3>
      <p class="muted" style="margin:0 0 4px">Spotify, Deezer, YouTube… jouent ici, et Apple Music quand « ${esc((o.airplay?.list || []).find(d => /computer/i.test(d.kind || ""))?.name || "Ordinateur")} » est coché en AirPlay.</p>
      ${list.length ? list.map(d => `<div class="out-row"><label class="nm"><input type="radio" name="macOut" value="${esc(d.name)}" ${d.current ? "checked" : ""}> ${OUT_ICON[d.kind] || "🔈"} ${esc(d.name)} <span class="badge">${esc(d.transport)}</span></label></div>${d.current ? volRow("mac", d.volume) : ""}`).join("") : `<p class="muted">Aucune sortie trouvée.</p>`}
      ${o.mac.error ? `<p class="music-err">⚠ ${esc(o.mac.error)}</p>` : ""}</div>`);
  }
  // Bluetooth jumelé
  if (o.mac?.available) {
    const bt = o.bluetooth || {};
    secs.push(`<div class="out-sec"><h3>Bluetooth</h3>
      ${(bt.list || []).length ? bt.list.map(d => `<div class="out-row"><span class="nm">${d.minor === 6 || d.minor === 1 ? "🎧" : "🔵"} ${esc(d.name)} ${d.connected ? '<span class="badge">connecté</span>' : ""}</span>
        <button class="btn small ${d.connected ? "ghost" : ""}" data-bt="${esc(d.address)}" data-btname="${esc(d.name)}" data-connect="${d.connected ? "0" : "1"}">${d.connected ? "Déconnecter" : "Connecter"}</button></div>`).join("")
        : `<p class="muted">${bt.error ? "" : "Aucune enceinte ou casque Bluetooth jumelé. Jumelle-le une fois dans Réglages Système › Bluetooth."}</p>`}
      ${bt.error ? `<p class="music-err">⚠ ${esc(bt.error)}</p>` : ""}
      ${bt.via === "app" && bt.helperAuth !== 3 && (bt.list || []).length ? `<div class="out-row"><span class="muted">${bt.helperAuth === 2
        ? "Bluetooth refusé : Réglages Système › Confidentialité et sécurité › Bluetooth › active « Show lumière Bluetooth »."
        : "Pour connecter d'ici, macOS doit autoriser « Show lumière Bluetooth » (une seule fois)."}</span>
        <button class="btn small" id="btAuth">Autoriser</button></div>` : ""}
      <p class="muted" style="margin:4px 0 0">Une fois connectée, l'enceinte apparaît dans « Sortie du Mac ».</p></div>`);
  }
  // AirPlay (Apple Music)
  if (o.airplay?.available) {
    const list = o.airplay.list || [];
    const icon = k => /homepod/i.test(k) ? "◉" : /computer|ordinateur/i.test(k) ? "▭" : /tv/i.test(k) ? "📺" : "◎";
    secs.push(`<div class="out-sec"><h3>AirPlay · Apple Music</h3>
      ${list.length ? (o.airplay.volume != null ? volRow("apple", o.airplay.volume, "🔊 Général") : "") + list.map(d => `<div class="out-row"><label class="nm"><input type="checkbox" value="${esc(d.name)}" data-airplay ${d.selected ? "checked" : ""} ${d.available ? "" : "disabled"}> ${icon(d.kind)} ${esc(d.name)}</label>${d.available ? "" : '<span class="badge">indisponible</span>'}</div>${d.selected && d.volume != null ? volRow(`ap:${d.name}`, d.volume) : ""}`).join("")
        : `<p class="muted">Ouvre l'app Musique pour voir tes HomePod, Apple TV et enceintes AirPlay.</p>`}</div>`);
  }
  // Spotify Connect
  if (o.spotify) {
    const list = o.spotify.list || [];
    secs.push(`<div class="out-sec"><h3>Spotify Connect</h3>
      ${list.length ? list.map(d => `<div class="out-row"><label class="nm"><input type="radio" name="spDev" value="${esc(d.id)}" data-spname="${esc(d.name)}" ${d.active ? "checked" : ""} ${d.restricted ? "disabled" : ""}> ${SP_ICON[d.type] || "🔈"} ${esc(d.name)}</label>${d.active ? '<span class="badge">joue ici</span>' : ""}</div>${d.active ? volRow(`sp:${d.id}`, d.volume) : ""}`).join("")
        : `<p class="muted">Aucun appareil Spotify en ligne. Ouvre Spotify sur un appareil (téléphone, enceinte, TV) pour le voir ici.</p>`}
      ${o.spotify.error ? `<p class="music-err">⚠ ${esc(o.spotify.error)}</p>` : ""}</div>`);
  }
  // Sonos
  if ((o.sonos?.list || []).length) {
    secs.push(`<div class="out-sec"><h3>Sonos</h3>
      ${o.sonos.list.map(d => `<div class="out-row"><span class="nm">🔈 ${esc(d.name)}${d.group.length > 1 ? ` <span class="muted">(groupe : ${d.group.map(esc).join(" + ")})</span>` : ""}</span>${d.playing ? '<span class="badge">joue</span>' : ""}</div>${volRow(`so:${d.id}`, d.volume)}`).join("")}
      <p class="muted" style="margin:4px 0 0">Ce que jouent tes Sonos peut aussi guider les lumières (Source « Enceintes Sonos » ou automatique).</p></div>`);
  }
  box.innerHTML = secs.join("") || `<p class="muted">Aucune sortie audio trouvée.</p>`;
  // actions
  box.querySelectorAll("input[name=macOut]").forEach(r => r.onchange = () => api("POST", "/api/audio/mac", { name: r.value }).then(() => { toast(`Le Mac joue sur « ${r.value} »`); setTimeout(loadOutputs, 800); }).catch(e => { toast(e.message, true); loadOutputs(); }));
  box.querySelectorAll("[data-bt]").forEach(b => b.onclick = () => {
    b.disabled = true; b.textContent = b.dataset.connect === "1" ? "Connexion…" : "Déconnexion…";
    if (o.bluetooth?.via === "app" && o.bluetooth?.helperAuth !== 3) toast("Si macOS le demande, clique « Autoriser » sur le Mac");
    api("POST", "/api/audio/bluetooth", { address: b.dataset.bt, name: b.dataset.btname, connect: b.dataset.connect === "1" }).then(() => setTimeout(loadOutputs, 1500)).catch(e => { toast(e.message, true); loadOutputs(); });
  });
  const auth = $("#btAuth");
  if (auth) auth.onclick = () => {
    auth.disabled = true; auth.textContent = "Regarde l'écran du Mac…";
    toast("Clique « Autoriser » dans la fenêtre de macOS sur le Mac");
    api("POST", "/api/audio/bluetooth/autoriser").then(r => { toast(r.auth === 3 ? "Bluetooth autorisé ✓" : r.auth === 2 ? "Bluetooth refusé dans les Réglages" : "Pas encore de réponse : réessaie", r.auth !== 3); loadOutputs(); })
      .catch(e => { toast(e.message, true); loadOutputs(); });
  };
  box.querySelectorAll("input[data-airplay]").forEach(i => i.onchange = async () => {
    const names = [...box.querySelectorAll("input[data-airplay]:checked")].map(x => x.value);
    if (!names.length) { i.checked = true; return toast("Garde au moins une sortie", true); }
    try { await api("POST", "/api/music/airplay", { names }); } catch (e) { toast(e.message, true); }
    loadOutputs();
  });
  box.querySelectorAll("input[name=spDev]").forEach(r => r.onchange = () => api("POST", "/api/audio/spotify", { deviceId: r.value, name: r.dataset.spname }).then(() => { toast(`Spotify passe sur « ${r.dataset.spname} »`); setTimeout(loadOutputs, 1500); }).catch(e => { toast(e.message, true); loadOutputs(); }));
  box.querySelectorAll("input[data-volkey]").forEach(r => {
    const k = r.dataset.volkey;
    const send = throttled(k, v =>
      k === "mac" ? api("POST", "/api/audio/mac/volume", { volume: v })
      : k === "apple" ? api("POST", "/api/music/volume", { app: "apple", volume: v })
      : k.startsWith("ap:") ? api("POST", "/api/music/volume", { name: k.slice(3), volume: v })
      : k.startsWith("sp:") ? api("POST", "/api/audio/spotify", { deviceId: k.slice(3), volume: v })
      : api("POST", "/api/audio/sonos/volume", { id: k.slice(3), volume: v }));
    r.oninput = () => { r.nextElementSibling.textContent = r.value; send(Number(r.value)); };
  });
}
$("#outputsRefresh").onclick = loadOutputs;


// taper le tempo
let taps = [], tapTimer;
function tap() {
  taps.push(Date.now());
  const b = $("#tapBtn"); b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 90);
  b.textContent = `${taps.length} temps…`;
  clearTimeout(tapTimer);
  tapTimer = setTimeout(async () => {
    const t = taps; taps = [];
    b.textContent = "Taper le tempo ici";
    if (t.length < 4) return toast("Tape au moins 4 temps (8 c'est mieux)", true);
    try { const r = await api("POST", "/api/music/tap", { taps: t }); toast(`Tempo calé : ${r.bpm} BPM`); }
    catch (e) { toast(e.message, true); }
  }, 1600);
}
$("#tapBtn").addEventListener("pointerdown", e => { e.preventDefault(); tap(); });
document.addEventListener("keydown", e => {
  if (S.tab === "music" && (e.key === "t" || e.key === "T") && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) tap();
});
