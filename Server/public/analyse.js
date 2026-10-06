// Analyses faites dans la page (navigateur) : tempo et caractère du morceau (extrait Apple de 30 s),
// couleurs de la pochette, attaques entendues au micro.
// Fichier « classique » : utilisable par la page (window.Analyse) et par les tests Node (globalThis.Analyse).
(function (root) {
    "use strict";

    // =====================================================================================
    // Couleurs : sRGB <-> OKLab (espace perceptif : les distances y ressemblent à ce que voit l'œil)
    // =====================================================================================
    const LIN = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const c = i / 255;
        LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }
    const delin = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

    /** r, g, b linéaires (0..1) -> [L, a, b] */
    function linToOklab(r, g, b) {
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        return [
            0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
        ];
    }
    /** [L, a, b] -> r, g, b linéaires (peut sortir de 0..1) */
    function oklabToLin(L, a, b) {
        const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
        const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
        const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
        return [
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        ];
    }
    const inGamut = rgb => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4);
    const toHex = rgb => "#" + rgb.map(v => Math.round(Math.max(0, Math.min(1, delin(Math.max(0, v)))) * 255).toString(16).padStart(2, "0")).join("");

    function hexToOklch(hex) {
        const n = parseInt(String(hex).slice(1), 16);
        const [L, a, b] = linToOklab(LIN[(n >> 16) & 255], LIN[(n >> 8) & 255], LIN[n & 255]);
        return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
    }

    function maxChroma(L, h) {
        const ca = Math.cos((h * Math.PI) / 180), sa = Math.sin((h * Math.PI) / 180);
        let lo = 0, hi = 0.4;
        for (let i = 0; i < 18; i++) {
            const mid = (lo + hi) / 2;
            if (inGamut(oklabToLin(L, mid * ca, mid * sa))) lo = mid;
            else hi = mid;
        }
        return lo;
    }

    /** Couleur « pour une lampe » d'une teinte donnée : la plus vive possible (sommet du gamut), un peu adoucie si pastel. */
    function lampColor(h, soft = 0) {
        let bestL = 0.7, bestC = 0;
        for (let L = 0.45; L <= 0.96; L += 0.01) {
            const c = maxChroma(L, h);
            if (c > bestC) { bestC = c; bestL = L; }
        }
        const C = bestC * (0.92 - 0.45 * soft);
        const L = bestL + (0.93 - bestL) * 0.5 * soft;
        const ca = Math.cos((h * Math.PI) / 180), sa = Math.sin((h * Math.PI) / 180);
        let c = C;
        while (c > 0 && !inGamut(oklabToLin(L, c * ca, c * sa))) c -= 0.005;
        return toHex(oklabToLin(L, c * ca, c * sa));
    }

    const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

    /** Nom français d'une teinte OKLCh. */
    function colorName(h) {
        if (h >= 345 || h < 18) return "rose";
        if (h < 42) return "rouge";
        if (h < 78) return "orange";
        if (h < 122) return "jaune";
        if (h < 168) return "vert";
        if (h < 222) return "turquoise";
        if (h < 286) return "bleu";
        if (h < 316) return "violet";
        return "magenta";
    }

    /** Petit générateur pseudo-aléatoire déterministe (même pochette = même résultat). */
    function rng(seed) {
        let s = seed >>> 0 || 1;
        return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    }

    /**
     * Couleurs d'une pochette (pixels RGBA, typiquement 64×64).
     *  - espace OKLab, k-moyennes++ pondérées par la vivacité (les gris, noirs et blancs ne comptent pas) ;
     *  - les tons « peau » (visages, très fréquents sur les pochettes) comptent beaucoup moins ;
     *  - teintes proches fusionnées, petites zones ignorées, couleurs rendues vives pour des ampoules.
     * Renvoie { colors: [{ hex, name, share }], colorful, light, mono }.
     */
    function coverPalette(px, w, h) {
        const n = w * h;
        const A = new Float32Array(n), B = new Float32Array(n), Lz = new Float32Array(n), W = new Float32Array(n), SK = new Uint8Array(n);
        let m = 0, sumL = 0, counted = 0, vivid = 0;
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            if (px[o + 3] < 128) continue;
            const R = px[o], G = px[o + 1], Bb = px[o + 2];
            const [L, a, b] = linToOklab(LIN[R], LIN[G], LIN[Bb]);
            counted++;
            sumL += L;
            const C = Math.hypot(a, b);
            if (L < 0.2 || C < 0.03) continue; // noir, gris, blanc
            const ho = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
            const skin = ho > 33 && ho < 75 && C < 0.11 && L > 0.3; // peau, bois, sable, beige
            let wt = Math.min(3, (C / 0.08) ** 1.4);
            if (skin) wt *= 0.1;
            if (L < 0.32) wt *= (L - 0.2) / 0.12;
            if (C >= 0.06 && !skin) vivid++;
            A[m] = a; B[m] = b; Lz[m] = (L - 0.6) * 0.35; W[m] = wt; SK[m] = skin ? 1 : 0;
            m++;
        }
        const light = counted ? sumL / counted : 0.5;
        const colorful = counted ? vivid / counted : 0;
        let totalW = 0, freeW = 0, free = 0;
        for (let i = 0; i < m; i++) { totalW += W[i]; if (!SK[i]) { freeW += W[i]; free++; } }
        if (m < 12 || totalW / Math.max(1, counted) < 0.02) return { colors: [], colorful, light, mono: true };
        // s'il y a assez de vraies couleurs, on écarte complètement la peau (sinon elle « salit » les autres groupes)
        if (free >= 12 && freeW / Math.max(1, counted) >= 0.015) {
            let j = 0;
            for (let i = 0; i < m; i++) if (!SK[i]) { A[j] = A[i]; B[j] = B[i]; Lz[j] = Lz[i]; W[j] = W[i]; SK[j] = 0; j++; }
            m = j;
            totalW = freeW;
        }

        // k-moyennes++ pondérées
        const K = Math.min(8, m);
        const rand = rng(m * 31 + Math.round(totalW * 1000));
        const cen = [];
        const d2 = new Float64Array(m).fill(Infinity);
        let pick = 0, bw = -1;
        for (let i = 0; i < m; i++) if (W[i] > bw) { bw = W[i]; pick = i; }
        cen.push([A[pick], B[pick], Lz[pick]]);
        while (cen.length < K) {
            const c = cen[cen.length - 1];
            let sum = 0;
            for (let i = 0; i < m; i++) {
                const d = (A[i] - c[0]) ** 2 + (B[i] - c[1]) ** 2 + (Lz[i] - c[2]) ** 2;
                if (d < d2[i]) d2[i] = d;
                sum += d2[i] * W[i];
            }
            if (!(sum > 0)) break;
            let r = rand() * sum, j = 0;
            for (; j < m - 1; j++) { r -= d2[j] * W[j]; if (r <= 0) break; }
            cen.push([A[j], B[j], Lz[j]]);
        }
        const asg = new Int16Array(m);
        for (let it = 0; it < 15; it++) {
            const acc = cen.map(() => [0, 0, 0, 0]);
            for (let i = 0; i < m; i++) {
                let bd = Infinity, bi = 0;
                for (let j = 0; j < cen.length; j++) {
                    const c = cen[j], d = (A[i] - c[0]) ** 2 + (B[i] - c[1]) ** 2 + (Lz[i] - c[2]) ** 2;
                    if (d < bd) { bd = d; bi = j; }
                }
                asg[i] = bi;
                const q = acc[bi];
                q[0] += A[i] * W[i]; q[1] += B[i] * W[i]; q[2] += Lz[i] * W[i]; q[3] += W[i];
            }
            acc.forEach((q, j) => { if (q[3] > 0) cen[j] = [q[0] / q[3], q[1] / q[3], q[2] / q[3]]; });
        }
        const groups = cen.map(() => ({ a: 0, b: 0, w: 0, sk: 0 }));
        for (let i = 0; i < m; i++) { const g = groups[asg[i]]; g.a += A[i] * W[i]; g.b += B[i] * W[i]; g.w += W[i]; if (SK[i]) g.sk += W[i]; }
        let cl = groups.filter(g => g.w > 0).map(g => ({ a: g.a / g.w, b: g.b / g.w, w: g.w, sk: g.sk })).sort((x, y) => y.w - x.w);
        cl.forEach(c => { c.C = Math.hypot(c.a, c.b); c.h = ((Math.atan2(c.b, c.a) * 180) / Math.PI + 360) % 360; });

        // fusion des teintes proches (sur une ampoule elles donneraient la même lumière)
        const merged = [];
        for (const c of cl) {
            const t = merged.find(x => hueDist(x.h, c.h) < 18);
            if (t) {
                const w = t.w + c.w;
                t.a = (t.a * t.w + c.a * c.w) / w; t.b = (t.b * t.w + c.b * c.w) / w; t.w = w; t.sk += c.sk;
                t.C = Math.hypot(t.a, t.b); t.h = ((Math.atan2(t.b, t.a) * 180) / Math.PI + 360) % 360;
            } else merged.push({ ...c });
        }
        const tw = merged.reduce((s, c) => s + c.w, 0);
        merged.forEach(c => {
            c.share = c.w / tw;
            c.score = c.share ** 0.7 * (0.55 + 0.45 * Math.min(1, c.C / 0.2));
        });
        merged.sort((x, y) => y.score - x.score);
        // zones « peau / beige » (visages, bois, sable) : gardées seulement si la pochette n'a rien d'autre
        const isSkin = c => c.sk / c.w > 0.6;
        const out = [];
        for (const c of merged) {
            if (c.share < 0.05 || isSkin(c)) continue;
            if (out.some(o => hueDist(o.h, c.h) < 25)) continue;
            out.push(c);
            if (out.length === 5) break;
        }
        if (!out.length) { const s0 = merged.find(c => c.share >= 0.05); if (s0) out.push(s0); }
        return {
            colors: out.map(c => ({ hex: lampColor(c.h, c.C < 0.06 ? 0.5 : c.C < 0.09 ? 0.25 : 0), name: colorName(c.h), share: Math.round(c.share * 100) / 100 })),
            colorful: Math.round(colorful * 100) / 100,
            light: Math.round(light * 100) / 100,
            mono: false,
        };
    }

    // =====================================================================================
    // Audio : FFT, attaques, tempo, caractère du son
    // =====================================================================================
    const DSP = {
        fft(re, im) {
            const n = re.length;
            for (let i = 1, j = 0; i < n; i++) {
                let bit = n >> 1;
                for (; j & bit; bit >>= 1) j ^= bit;
                j ^= bit;
                if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
            }
            for (let len = 2; len <= n; len <<= 1) {
                const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
                for (let i = 0; i < n; i += len) {
                    let cr = 1, ci = 0;
                    for (let j = 0; j < half; j++) {
                        const a = i + j, b = a + half;
                        const br = re[b] * cr - im[b] * ci, bi = re[b] * ci + im[b] * cr;
                        re[b] = re[a] - br; im[b] = im[a] - bi; re[a] += br; im[a] += bi;
                        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
                    }
                }
            }
        },
        /** f(frame) -> { flux, rms, centroid, low, high } : « flux spectral » (attaques, basses renforcées) + timbre. */
        makeOnset(sampleRate, N) {
            const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
            const re = new Float32Array(N), im = new Float32Array(N), prev = new Float32Array(N / 2);
            const hz = sampleRate / N;
            const maxBin = Math.min(N / 2, Math.round(8000 / hz)), lowBin = Math.max(2, Math.round(180 / hz));
            const bassBin = Math.max(1, Math.round(150 / hz)), highBin = Math.round(5000 / hz), top = Math.min(N / 2, Math.round(16000 / hz));
            return frame => {
                let rms = 0;
                for (let i = 0; i < N; i++) { const v = frame[i] || 0; re[i] = v * win[i]; im[i] = 0; rms += v * v; }
                DSP.fft(re, im);
                let flux = 0, pw = 0, mg = 0, mgf = 0, low = 0, high = 0;
                for (let k = 1; k < top; k++) {
                    const p = re[k] * re[k] + im[k] * im[k], a = Math.sqrt(p);
                    pw += p; mg += a; mgf += a * k * hz;
                    if (k <= bassBin) low += p; else if (k >= highBin) high += p;
                    if (k < maxBin) {
                        const mag = Math.log1p(1000 * a);
                        const d = mag - prev[k];
                        if (d > 0) flux += k <= lowBin ? 3 * d : d;
                        prev[k] = mag;
                    }
                }
                return { flux, rms: Math.sqrt(rms / N), centroid: mg ? mgf / mg : 0, low: pw ? low / pw : 0, high: pw ? high / pw : 0, power: pw };
            };
        },
        /** Retire la moyenne locale (~0,4 s) et garde la partie positive : ne restent que les attaques. */
        clean(env, fps) {
            const w = Math.max(1, Math.round(0.4 * fps)), n = env.length, out = new Float32Array(n), pre = new Float64Array(n + 1);
            for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + env[i];
            for (let i = 0; i < n; i++) { const a = Math.max(0, i - w), b = Math.min(n, i + w + 1); out[i] = Math.max(0, env[i] - (pre[b] - pre[a]) / (b - a)); }
            return out;
        },
        /** Tempo par autocorrélation de l'enveloppe des attaques (préférence douce autour de 120 BPM). */
        tempo(env, fps) {
            const n = env.length, minL = Math.max(2, Math.floor((fps * 60) / 185)), maxL = Math.ceil((fps * 60) / 62);
            const top = Math.min(n - 2, 2 * maxL + 2), ac = new Float64Array(top + 2);
            for (let L = minL - 1; L <= top; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += env[i] * env[i + L]; ac[L] = s / (n - L); }
            let best = -Infinity, bestL = minL;
            for (let L = minL; L <= maxL; L++) {
                const bpm = (60 * fps) / L, w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
                const sc = (ac[L] + 0.5 * (ac[2 * L] || 0)) * w;
                if (sc > best) { best = sc; bestL = L; }
            }
            const y0 = ac[bestL - 1] || 0, y1 = ac[bestL], y2 = ac[bestL + 1] || 0, den = y0 - 2 * y1 + y2;
            const off = den ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
            let bpm = (60 * fps) / (bestL + off);
            while (bpm > 180) bpm /= 2;
            while (bpm < 85) bpm *= 2;
            return Math.round(bpm * 10) / 10;
        },
        /** Affine le tempo (±1,5 BPM, pas de 0,02) : période qui aligne le mieux toutes les attaques. t = instants en s. */
        refine(env, t, bpm) {
            let best = bpm, bestR = -1;
            for (let b = bpm - 1.5; b <= bpm + 1.5; b += 0.02) {
                const w = (2 * Math.PI * b) / 60;
                let sx = 0, sy = 0;
                for (let i = 0; i < env.length; i++) if (env[i]) { sx += env[i] * Math.cos(w * t[i]); sy += env[i] * Math.sin(w * t[i]); }
                const R = sx * sx + sy * sy;
                if (R > bestR) { bestR = R; best = b; }
            }
            if (Math.abs(best - Math.round(best)) < 0.2) best = Math.round(best); // la plupart des morceaux ont un tempo entier
            return Math.round(best * 100) / 100;
        },
    };

    const clamp01 = v => Math.max(0, Math.min(1, v));
    const lin = (v, a, b) => clamp01((v - a) / (b - a));
    const median = arr => { const s = Float64Array.from(arr).sort(); return s.length ? s[s.length >> 1] : 0; };

    /**
     * Analyse de l'extrait (mono, Float32Array) : tempo + caractère du son.
     * Renvoie { bpm, features: { energy, loudness, dynamics, brightness, bass, onsetRate, pulse } }.
     */
    function analyseAudio(data, sampleRate) {
        const N = 1024, H = 512, onset = DSP.makeOnset(sampleRate, N);
        const flux = [], rms = [], cent = [], low = [], high = [];
        for (let i = 0; i + N <= data.length; i += H) {
            const f = onset(data.subarray(i, i + N));
            flux.push(f.flux); rms.push(f.rms);
            if (f.rms > 0.003) { cent.push(f.centroid); low.push(f.low); high.push(f.high); }
        }
        const fps = sampleRate / H;
        const env = DSP.clean(Float32Array.from(flux), fps);
        const times = Array.from(env, (_, i) => i / fps);
        const bpm = DSP.refine(env, times, DSP.tempo(env, fps));

        // netteté de la pulsation : corrélation de l'enveloppe avec elle-même décalée d'un temps
        const lag = Math.round((fps * 60) / bpm);
        let ac0 = 0, acL = 0;
        for (let i = 0; i < env.length; i++) { ac0 += env[i] * env[i]; if (i + lag < env.length) acL += env[i] * env[i + lag]; }
        const pulse = ac0 ? acL / ac0 : 0;
        // attaques par seconde (pics au-dessus de moyenne + écart-type, espacés d'au moins 80 ms)
        let mu = 0, sd = 0;
        env.forEach(v => (mu += v)); mu /= env.length || 1;
        env.forEach(v => (sd += (v - mu) ** 2)); sd = Math.sqrt(sd / (env.length || 1));
        let peaks = 0, last = -1e9;
        for (let i = 1; i < env.length - 1; i++) {
            if (env[i] > mu + sd && env[i] >= env[i - 1] && env[i] > env[i + 1] && i - last >= 0.08 * fps) { peaks++; last = i; }
        }
        const dur = data.length / sampleRate;
        const onsetRate = peaks / Math.max(1, dur);
        const db = rms.filter(v => v > 0.001).map(v => 20 * Math.log10(v));
        const loudness = db.length ? 20 * Math.log10(rms.reduce((a, v) => a + v, 0) / rms.length) : -60;
        const mdb = db.reduce((a, v) => a + v, 0) / (db.length || 1);
        const dynamics = Math.sqrt(db.reduce((a, v) => a + (v - mdb) ** 2, 0) / (db.length || 1));
        const brightness = median(cent);
        const bass = low.reduce((a, v) => a + v, 0) / (low.length || 1);
        const air = high.reduce((a, v) => a + v, 0) / (high.length || 1);
        // énergie ressentie : brillance du son et attaques comptent plus que le volume (qui dépend du décodeur)
        const energy = clamp01(
            0.2 * lin(loudness, -24, -8) + 0.25 * lin(onsetRate, 1.2, 5) + 0.3 * lin(brightness, 900, 3200) + 0.15 * lin(pulse, 0.08, 0.45) + 0.1 * lin(-dynamics, -9, -3),
        );
        const r = (v, k = 100) => Math.round(v * k) / k;
        return {
            bpm,
            features: { energy: r(energy), loudness: r(loudness, 10), dynamics: r(dynamics, 10), brightness: Math.round(brightness), bass: r(bass, 1000), air: r(air, 1000), onsetRate: r(onsetRate, 10), pulse: r(pulse) },
        };
    }

    root.Analyse = { DSP, coverPalette, analyseAudio, lampColor, colorName, hexToOklch, hueDist };
})(typeof window !== "undefined" ? window : globalThis);
