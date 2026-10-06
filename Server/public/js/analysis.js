// Show lumière — Analyse audio dans la page (extrait, pochette) et micro, puis démarrage.
// (Scripts classiques chargés dans l'ordre par index.html : ils partagent leurs noms de haut niveau.)
// =====================================================================================
// Analyse audio (dans la page) : FFT, détection d'attaques, tempo, calage par le micro
// =====================================================================================
const DSP = Analyse.DSP; // FFT, attaques, tempo : voir analyse.js

// Analyses ponctuelles d'un morceau (une fois, résultat gardé en cache par le Mac) :
// tempo + caractère du son sur l'extrait Apple de 30 s, couleurs de la pochette.
const Analyzer = {
  done: new Set(),
  async maybeRun(key, needs) {
    // sur un téléphone, on laisse d'abord la page du Mac s'en charger (elle évite au téléphone de télécharger l'extrait)
    if (!S.local && !this.done.has(key + "|wait")) {
      this.done.add(key + "|wait");
      setTimeout(() => { const sy = S.st?.music?.sync; if (sy?.trackKey === key && sy.needs) this.maybeRun(key, sy.needs); }, 8000);
      return;
    }
    if (needs.audio && !this.done.has(key + "|a")) { this.done.add(key + "|a"); this.previewAudio(key).catch(e => console.warn("analyse extrait", e)); }
    if (needs.palette && !this.done.has(key + "|p")) { this.done.add(key + "|p"); this.coverColors(key).catch(e => console.warn("analyse pochette", e)); }
  },
  async previewAudio(key) {
    const r = await fetch(`/api/music/preview?key=${encodeURIComponent(key)}`);
    if (!r.ok) return;
    const buf = await r.arrayBuffer();
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Ctx(1, 2, 44100);
    const audio = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
    const ch = audio.numberOfChannels, len = audio.length, data = new Float32Array(len);
    for (let c = 0; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < len; i++) data[i] += d[i] / ch; }
    await new Promise(r => setTimeout(r, 0));
    const { bpm, features } = Analyse.analyseAudio(data, audio.sampleRate);
    await api("POST", "/api/music/analysis", { key, bpm, features });
  },
  async coverColors(key) {
    const img = new Image();
    img.src = `/api/music/cover?key=${encodeURIComponent(key)}`;
    await img.decode();
    const S = 128, c = document.createElement("canvas"); c.width = c.height = S;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, S, S);
    const cover = Analyse.coverPalette(g.getImageData(0, 0, S, S).data, S, S);
    await api("POST", "/api/music/analysis", { key, cover });
  },
};

// Micro : détecte les attaques en direct, en déduit le calage des temps et l'énergie
const Mic = {
  on: false, env: [], times: [], rms: [], levelPct: 0, good: 0, last: null,
  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    await this.ctx.resume();
    this.stream = stream;
    const N = 1024, src = this.ctx.createMediaStreamSource(stream), proc = this.ctx.createScriptProcessor(N, 1, 1);
    const onset = DSP.makeOnset(this.ctx.sampleRate, N), zero = this.ctx.createGain();
    zero.gain.value = 0;
    const lat = ((this.ctx.baseLatency || 0) + N / this.ctx.sampleRate / 2) * 1000 + 15;
    proc.onaudioprocess = e => {
      const { flux, rms } = onset(e.inputBuffer.getChannelData(0));
      this.env.push(flux); this.times.push(Date.now() - lat); this.rms.push(rms);
      if (this.env.length > 700) { this.env.shift(); this.times.shift(); this.rms.shift(); }
      this.levelPct = Math.min(100, rms * 400);
    };
    src.connect(proc); proc.connect(zero); zero.connect(this.ctx.destination);
    this.nodes = [src, proc, zero];
    this.on = true;
    startBeat();
    this.timer = setInterval(() => this.analyze(), 2000);
    this.etimer = setInterval(() => this.energy(), 500);
    this.setStatus("Écoute en cours… (quelques secondes de musique suffisent)");
  },
  stop() {
    this.on = false; clearInterval(this.timer); clearInterval(this.etimer);
    try { this.stream?.getTracks().forEach(t => t.stop()); this.ctx?.close(); } catch {}
    this.env = []; this.times = []; this.rms = []; this.levelPct = 0;
    this.setStatus("Micro coupé.");
  },
  setStatus(t) { const el = $("#micStatus"); if (el) el.textContent = t; },
  reset() { this.env = []; this.times = []; this.rms = []; this.good = 0; this.last = null; },
  analyze() {
    const m = S.st?.music, st = m?.state, sy = m?.sync;
    if (!st?.playing || !sy?.trackKey) { this.setStatus("Micro prêt : en attente de musique (Apple Music, Spotify, Deezer…)."); return; }
    if (this.key !== sy.trackKey) { this.key = sy.trackKey; this.reset(); this.ref = null; return; }
    // la lecture doit avoir été continue (pas de saut dans le morceau) pendant la fenêtre écoutée
    if (this.ref && this.ref.at !== st.at) {
      const predicted = this.ref.position + (st.at - this.ref.at) / 1000;
      if (Math.abs(predicted - st.position) > 0.8) this.reset();
    }
    this.ref = { position: st.position, at: st.at };
    const posAt = t => st.position + (t - st.at) / 1000;
    const n = this.env.length;
    if (n < 250) { this.setStatus(`Écoute… ${Math.round((n / 700) * 100)} %`); return; }
    const fps = (n - 1) / ((this.times[n - 1] - this.times[0]) / 1000);
    const env = DSP.clean(Float32Array.from(this.env), fps);
    // tempo : celui du serveur s'il est fiable (base, extrait, calage), sinon mesuré au micro
    const bpm = sy.tempo && !/estim|incertain/.test(sy.tempo.source) ? sy.tempo.bpm : DSP.refine(env, this.times.map(posAt), DSP.tempo(env, fps));
    const period = 60 / bpm;
    let sx = 0, syy = 0, se = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * posAt(this.times[i])) / period;
      sx += env[i] * Math.cos(a); syy += env[i] * Math.sin(a); se += env[i];
    }
    if (!se) return;
    const conf = Math.hypot(sx, syy) / se;
    const phase = ((((Math.atan2(syy, sx) / (2 * Math.PI)) * period) % period) + period) % period;
    const near = this.last && Math.abs(this.last.bpm - bpm) < 0.6 && (() => { const d = Math.abs(this.last.phase - phase) % period; return Math.min(d, period - d) < 0.07; })();
    this.good = conf > 0.1 && near ? this.good + 1 : conf > 0.1 ? 1 : 0;
    this.last = { bpm, phase, conf };
    if (this.good >= 2) {
      api("POST", "/api/music/calibrate", { key: sy.trackKey, bpm, phase, confidence: conf }).catch(() => {});
      this.setStatus(`✓ Calé sur les temps : ${Math.round(bpm)} BPM (fiabilité ${Math.round(conf * 100)} %). Le micro continue d'écouter pour rester calé.`);
    } else this.setStatus(conf > 0.1 ? `Presque calé… (${Math.round(bpm)} BPM)` : "Le rythme est difficile à entendre : monte un peu le son ou rapproche le Mac des enceintes.");
  },
  energy() {
    const n = this.rms.length;
    if (n < 100 || !S.st?.music?.sync?.enabled) return;
    const short = this.rms.slice(-47).reduce((a, b) => a + b, 0) / Math.min(47, n);
    const long = this.rms.reduce((a, b) => a + b, 0) / n;
    const level = long ? Math.max(0, Math.min(1, (short / long - 0.6) / 0.8)) : 0.5;
    // envoyé seulement quand l'énergie change vraiment (ou toutes les 2 s, pour qu'elle reste « fraîche » côté Mac)
    if (Math.abs(level - (this.sentLevel ?? -1)) < 0.05 && Date.now() - (this.sentAt ?? 0) < 2000) return;
    this.sentLevel = level; this.sentAt = Date.now();
    fetch("/api/music/energy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level }) }).catch(() => {});
  },
};
$("#micOn").onchange = async e => {
  try {
    if (e.target.checked) await Mic.start();
    else Mic.stop();
  } catch (err) {
    e.target.checked = false;
    Mic.setStatus("Micro refusé ou indisponible : autorise le micro pour cette page dans Safari (Réglages du site web › Micro).");
    toast("Micro indisponible : " + err.message, true);
  }
};

connect();
startBeat();
