/* ============================================================
   きょむうさ猛プッシュ — game.js (rev 2, rhythm tap)
   ============================================================ */

const TUNING = /*EDITMODE-BEGIN*/{
  "beatIntervalMs": 560,
  "beatSpeedupAt100": 0.5,
  "perfectWindowMs": 75,
  "greatWindowMs": 140,
  "goodWindowMs": 220,
  "gainPerfect": 3.85,
  "gainGreat": 2.31,
  "gainGood": 1.31,
  "gainMiss": 0,
  "decayPerSec": 2.0,
  "targetTimeSec": 18,
  "beatLatencyMs": 80,
  "hologramStrength": 0,
  "effectIntensity": 10,
  "shakeEnabled": true,
  "flashEnabled": true,
  "particlesEnabled": false
}/*EDITMODE-END*/;

// Expose for devtools tuning (e.g., window.TUNING.beatLatencyMs = 180)
if (typeof window !== 'undefined') window.TUNING = TUNING;

/* Rabbit stage GIFs — 3-level hype progression with seamless transitions
   A(loop 0-25%) → B(bridge) → C(loop 25-60%) → D(bridge) → E(loop 60-100%) → F(clear kiss, 2.5s)
   Durations measured from the actual GIFs (ms). */
const STAGE_GIFS = {
  A: { src: './assets/kyomuA.webp', dur: 2800, loop: true,  next: 'B' },
  B: { src: './assets/kyomuB.webp', dur: 1200, loop: false, next: 'C' },
  C: { src: './assets/kyomuC.webp', dur: 440,  loop: true,  next: 'D' },
  D: { src: './assets/kyomuD.webp', dur: 1440, loop: false, next: 'E' },
  E: { src: './assets/kyomuE.webp', dur: 1200, loop: true,  next: null },
  F: { src: './assets/kyomuF.webp', dur: 3000, loop: false, next: null },
};
const CLEAR_F_PLAY_MS = 4000;

const state = {
  gauge: 0,
  taps: 0,
  combo: 0,
  maxCombo: 0,
  perfectStreak: 0,
  perfectCount: 0,
  greatCount: 0,
  goodCount: 0,
  missCount: 0,
  decayTotal: 0,
  judgedBeats: new Set(),
  currentBgmMeta: null,
  startAt: 0,
  running: false,
  stage: 'idle',
  rafId: null,
  nextBeatAt: 0,
  beatIndex: 0,
  indicatorScale: 2.0,
  lastTapAt: 0,
  gifStage: null,
  gifStartAt: 0,
  gifAdvanceTimer: null,
  gifPendingAdvance: false,
  activeChar: 'A',
  mashMode: false,
  mashCount: 0,
  mashTarget: 30,
  mashPending: false,
};

const $ = (s) => document.querySelector(s);
const els = {
  scenes: {
    title: $('#scene-title'),
    game:  $('#scene-game'),
    clear: $('#scene-clear'),
    video: $('#scene-video'),
    cta:   $('#scene-cta'),
  },
  startBtn: $('#start-btn'),
  pushBtn: $('#push-btn'),
  retryBtn: $('#retry-btn'),
  yesBtn: $('#yes-btn'),
  noBtn: $('#no-btn'),
  soundBtn: $('#sound-btn'),
  gaugeFill: $('#gauge-fill'),
  gaugeFillStripes: $('#gauge-fill-stripes'),
  gaugeNum: $('#gauge-num'),
  gaugePulse: $('#gauge-pulse'),
  timer: $('#timer-label'),
  tapCount: $('#tap-count'),
  char: $('#character'),
  charB: $('#character-b'),
  comboLayer: $('#combo-layer'),
  particles: $('#particles'),
  flash: $('#flash'),
  phone: $('.phone'),
  screen: $('.screen'),
  confetti: $('#confetti-canvas'),
  rhythmIndicator: $('#rhythm-indicator'),
  rhythmTicks: $('#rhythm-ticks'),
  beatBadge: $('#beat-badge'),
  splashVideo: $('#splash-video'),
  clearWindow: $('#clear-window'),
  clearText: $('#clear-text'),
  typed: $('#typed'),
  clearActions: $('#clear-actions'),
  tweaksPanel: $('#tweaks-panel'),
  countdownOverlay: $('#countdown-overlay'),
  countdownNum: $('#countdown-num'),
  finishOverlay: $('#finish-overlay'),
  nowPlaying: $('#now-playing'),
  sbRowScore: $('#sb-row-score'),
  sbRowCombo: $('#sb-row-combo'),
  sbRowTiming: $('#sb-row-timing'),
  sbRowTime: $('#sb-row-time'),
  sbRowTotal: $('#sb-row-total'),
  sbDivider: $('#sb-divider'),
  sbScore: $('#sb-score'),
  sbCombo: $('#sb-combo'),
  sbTimingBonus: $('#sb-timing-bonus'),
  sbTimeBonus: $('#sb-time-bonus'),
  sbTotal: $('#sb-total'),
  ctaRankBadge: $('#cta-rank-badge'),
  shareX: $('#share-x'),
  shareLine: $('#share-line'),
  shareThreads: $('#share-threads'),
  shareCopy: $('#share-copy'),
  shareToast: $('#cta-share-toast'),
  mashOverlay: $('#mash-overlay'),
  mashCount: $('#mash-count'),
};

/* ---------- BoundingRect cache (avoid forced layout on every tap) ---------- */
let _rectBtn = null, _rectParticles = null, _rectCombo = null;
function updateRectCache() {
  if (!els.pushBtn || !els.particles || !els.comboLayer) return;
  _rectBtn       = els.pushBtn.getBoundingClientRect();
  _rectParticles = els.particles.getBoundingClientRect();
  _rectCombo     = els.comboLayer.getBoundingClientRect();
}
window.addEventListener('resize',            updateRectCache, { passive: true });
window.addEventListener('orientationchange', updateRectCache, { passive: true });

/* Parity toggles — restart CSS animations without void offsetWidth (no forced reflow) */
let _pulseParity = false;
let _badgeParity = false;
let _mashPopParity = false;

/* ============================================================
   Sound Manager — Web Audio (procedural SE + BGM)
   ============================================================ */
const Snd = (() => {
  let ctx = null;
  let master = null;
  let bgmAudio = null;
  let muted = false;
  // Game BGM tracks with beat metadata.
  // BPM uses librosa-measured real values. DO NOT boost BPM to create "anticipatory" feel —
  // boosted BPM accumulates drift every beat (code interval < real interval), which puts
  // taps outside greatWindow by beat 25-50 and outside goodWindow by beat 75+ → miss.
  // For constant "手前で反応" feel, shift offsetMs earlier (drift-free) OR lower
  // TUNING.beatLatencyMs. Do NOT touch bpm.
  // offsetMs is -30ms from the first detected beat to nudge the whole grid
  // a touch earlier in wall-clock time ("手前で反応" request, 2026-04-22).
  const GAME_BGM_TRACKS = [
    { src: './assets/musicA.mp3', bpm: 129.85, offsetMs: 487, title: 'Milkey CasWay' },
    { src: './assets/musicB.mp3', bpm: 130.47, offsetMs: 468, title: 'Parallel CasNight' },
    { src: './assets/musicC.mp3', bpm: 130.94, offsetMs: 862, title: 'Signal CasLiver' },
  ];
  const TITLE_BGM = './assets/music_title.mp3';
  const CTA_BGM = './assets/music_end.mp3';
  const BGM_VOLUME = 0.5;
  const SE_VOLUME = 0.85;
  const SE_FILES = {
    se1:     { src: './assets/SE1.mp3' },
    se2:     { src: './assets/SE2.mp3' },
    se3:     { src: './assets/SE3.mp3',     vol: SE_VOLUME * 0.5 },
    seClear: { src: './assets/SE_clear.mp3' },
  };
  const seCache = {};
  try { muted = localStorage.getItem('kyomuusa_muted') === '1'; } catch (e) {}

  const seLoad = () => {
    Object.entries(SE_FILES).forEach(([k, def]) => {
      if (seCache[k]) return;
      const a = new Audio(def.src);
      a.preload = 'auto';
      seCache[k] = a;
    });
  };
  const playSE = (key, volOverride) => {
    if (muted) return;
    const base = seCache[key];
    if (!base) return;
    const a = base.cloneNode(true);
    const baseVol = (SE_FILES[key] && SE_FILES[key].vol != null) ? SE_FILES[key].vol : SE_VOLUME;
    a.volume = volOverride != null ? volOverride : baseVol;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  };

  const ensure = () => {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);
    return ctx;
  };
  const resume = () => {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
  };
  const setMute = (m) => {
    muted = m;
    try { localStorage.setItem('kyomuusa_muted', m ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = m ? 0 : 0.7;
    if (bgmAudio) bgmAudio.volume = m ? 0 : BGM_VOLUME;
  };
  const toggle = () => { setMute(!muted); return muted; };
  const isMuted = () => muted;

  const tone = ({ freq = 440, type = 'sine', dur = 0.12, gain = 0.15, attack = 0.005, when = 0 }) => {
    const c = ensure(); if (!c || muted) return;
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(master);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0); o.stop(t0 + dur + 0.03);
  };
  const noise = ({ dur = 0.08, gain = 0.08, filterFreq = 4000, when = 0 }) => {
    const c = ensure(); if (!c || muted) return;
    const t0 = c.currentTime + when;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  };

  const tap = () => { resume(); tone({ freq: 880, type: 'square', dur: 0.05, gain: 0.06 }); };
  const hit = (rating) => {
    resume();
    if (rating === 'perfect') {
      tone({ freq: 1047, type: 'sine',     dur: 0.2,  gain: 0.18 });
      tone({ freq: 1568, type: 'sine',     dur: 0.24, gain: 0.12, when: 0.03 });
      tone({ freq: 2093, type: 'triangle', dur: 0.28, gain: 0.08, when: 0.06 });
    } else if (rating === 'great') {
      tone({ freq: 880,  type: 'triangle', dur: 0.14, gain: 0.14 });
      tone({ freq: 1320, type: 'sine',     dur: 0.18, gain: 0.08, when: 0.02 });
    } else if (rating === 'good') {
      tone({ freq: 660,  type: 'triangle', dur: 0.12, gain: 0.11 });
    } else {
      tone({ freq: 220, type: 'sawtooth', dur: 0.2,  gain: 0.1 });
      tone({ freq: 170, type: 'sawtooth', dur: 0.25, gain: 0.08, when: 0.05 });
    }
  };
  const countBeep = (isGo) => {
    resume();
    if (isGo) {
      tone({ freq: 660, type: 'square', dur: 0.3, gain: 0.22 });
      tone({ freq: 988, type: 'square', dur: 0.4, gain: 0.18, when: 0.05 });
      tone({ freq: 1320, type: 'sine', dur: 0.5, gain: 0.1, when: 0.1 });
    } else {
      tone({ freq: 740, type: 'square', dur: 0.15, gain: 0.16 });
    }
  };
  const finish = () => {
    resume();
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.35, gain: 0.2, when: i * 0.08 }));
    tone({ freq: 1568, type: 'sine', dur: 0.9, gain: 0.14, when: 0.34 });
    noise({ dur: 0.3, gain: 0.06, filterFreq: 2500, when: 0 });
  };

  let fadeTimer = null;
  const bgmStop = () => {
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    if (bgmAudio) {
      try { bgmAudio.pause(); } catch (e) {}
      bgmAudio.src = '';
      bgmAudio = null;
    }
  };
  const startBGM = (src) => {
    resume();
    if (bgmAudio && bgmAudio._src === src && !bgmAudio.paused) return;
    bgmStop();
    const a = new Audio(src);
    a.loop = true;
    a.volume = muted ? 0 : BGM_VOLUME;
    a._src = src;
    bgmAudio = a;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  };
  const fadeOutBGM = (durationMs = 1000) => {
    if (!bgmAudio) return;
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    const steps = 20;
    const stepMs = Math.max(16, durationMs / steps);
    const startVol = bgmAudio.volume;
    let step = 0;
    fadeTimer = setInterval(() => {
      if (!bgmAudio) {
        clearInterval(fadeTimer); fadeTimer = null;
        return;
      }
      step++;
      const v = startVol * (1 - step / steps);
      if (step >= steps || v <= 0) {
        clearInterval(fadeTimer); fadeTimer = null;
        bgmStop();
        return;
      }
      bgmAudio.volume = Math.max(0, v);
    }, stepMs);
  };
  const titleBgmStart = () => startBGM(TITLE_BGM);
  const gameBgmStart = () => {
    const track = GAME_BGM_TRACKS[Math.floor(Math.random() * GAME_BGM_TRACKS.length)];
    startBGM(track.src);
    return track;
  };
  const ctaBgmStart = () => startBGM(CTA_BGM);
  const bgmCurrentTime = () => bgmAudio ? bgmAudio.currentTime : 0;
  const retryBgm = () => {
    if (bgmAudio && bgmAudio.paused) {
      const p = bgmAudio.play();
      if (p && p.catch) p.catch(() => {});
    }
  };

  return { tap, hit, countBeep, finish, titleBgmStart, gameBgmStart, ctaBgmStart, bgmStop, fadeOutBGM, retryBgm, bgmCurrentTime, toggle, setMute, isMuted, resume, seLoad, playSE };
})();

function updateSoundBtn() {
  const b = els.soundBtn; if (!b) return;
  const m = Snd.isMuted();
  b.classList.toggle('muted', m);
  b.setAttribute('aria-label', m ? '音声オン' : '音声オフ');
}

function showScene(name) {
  Object.values(els.scenes).forEach(s => s.classList.remove('active'));
  els.scenes[name].classList.add('active');
  if (els.soundBtn) els.soundBtn.classList.toggle('hide-on-cta', name === 'cta');
}
function rand(a, b) { return Math.random() * (b - a) + a; }

/* ---------- Title PON! (rAF-driven pop with overshoot + bounce-back) ---------- */
function animateTitle() {
  const targets = [
    { el: document.querySelector('#tw-1'),        delay: 60,  dur: 450, peak: 1.35, fromRot: -10, peakRot:  4, toRot: 0 },
    { el: document.querySelector('#tw-2'),        delay: 180, dur: 450, peak: 1.35, fromRot:  10, peakRot: -4, toRot: 0 },
    { el: document.querySelector('#title-kyomu'), delay: 320, dur: 480, peak: 1.45, fromRot:  -6, peakRot:  3, toRot: 0 },
  ].filter(t => t.el);

  // Final visible state applied IMMEDIATELY so tab-backgrounded rAF doesn't hide content
  targets.forEach(t => {
    t.el.style.opacity = '1';
    t.el.style.transform = `scale(1) rotate(${t.toRot}deg)`;
    t.el.style.willChange = 'transform, opacity';
  });

  // Pop curve: 0 → peak (explosive ease-out) → bounce (0.88 * peak) → settle (1.0)
  const popScale = (p, peak) => {
    if (p < 0.32) {
      // fast explode 0 → peak (easeOutQuart)
      const t = p / 0.32;
      return peak * (1 - Math.pow(1 - t, 4));
    } else if (p < 0.62) {
      // bounce back peak → 0.88
      const t = (p - 0.32) / 0.30;
      return peak + (0.88 - peak) * (1 - Math.pow(1 - t, 2));
    } else {
      // settle 0.88 → 1.0
      const t = (p - 0.62) / 0.38;
      return 0.88 + (1 - 0.88) * (1 - Math.pow(1 - t, 2));
    }
  };
  const popRot = (p, from, peakR, to) => {
    if (p < 0.32) {
      const t = p / 0.32;
      return from + (peakR - from) * (1 - Math.pow(1 - t, 4));
    } else {
      const t = (p - 0.32) / 0.68;
      return peakR + (to - peakR) * (1 - Math.pow(1 - t, 2));
    }
  };

  const start = performance.now();
  // Pre-state: invisible + collapsed
  targets.forEach(t => {
    t.el.style.opacity = '0';
    t.el.style.transform = `scale(0) rotate(${t.fromRot}deg)`;
  });

  let lastTick = start;
  function tick(now) {
    lastTick = now;
    const t = now - start;
    let anyRunning = false;
    targets.forEach(tg => {
      const local = t - tg.delay;
      if (local < 0) { anyRunning = true; return; }
      if (local >= tg.dur) {
        tg.el.style.opacity = '1';
        tg.el.style.transform = `scale(1) rotate(${tg.toRot}deg)`;
        return;
      }
      anyRunning = true;
      const p = local / tg.dur;
      const sc = popScale(p, tg.peak);
      const rot = popRot(p, tg.fromRot, tg.peakRot, tg.toRot);
      // opacity ramps in faster than scale so it's visible right as it pops
      tg.el.style.opacity = Math.min(1, p * 5).toFixed(3);
      tg.el.style.transform = `scale(${sc.toFixed(3)}) rotate(${rot.toFixed(2)}deg)`;
    });
    if (anyRunning) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Safety net: if rAF never fires (backgrounded tab), ensure visible after 1.5s via setTimeout
  setTimeout(() => {
    if (performance.now() - lastTick > 1000) {
      targets.forEach(t => {
        t.el.style.opacity = '1';
        t.el.style.transform = `scale(1) rotate(${t.toRot}deg)`;
      });
    }
  }, 1500);
}

/* ---------- Title tagline typewriter ---------- */
let taglineTypeTimer = null;
function typeTagline() {
  const tgt = document.getElementById('tagline-typed');
  if (!tgt) return;
  if (taglineTypeTimer) { clearTimeout(taglineTypeTimer); taglineTypeTimer = null; }
  tgt.textContent = '';
  const text = 'テンポよくタップして、\nきょむうさをノリノリにしよう！';
  let i = 0;
  taglineTypeTimer = setTimeout(function next() {
    if (i >= text.length) { taglineTypeTimer = null; return; }
    tgt.textContent += text[i];
    i++;
    const d = text[i-1] === '\n' ? 180 : (55 + Math.random()*25);
    taglineTypeTimer = setTimeout(next, d);
  }, 1150);
}

/* ---------- Gauge ---------- */
function renderGauge() {
  const pct = Math.max(0, Math.min(100, state.gauge));
  els.gaugeFill.style.transform = `scaleX(${pct/100})`;
  els.gaugeFillStripes.style.clipPath = `inset(0 ${100-pct}% 0 0)`;
  els.gaugeNum.textContent = Math.floor(pct) + '%';
  // Progressive hype stage: A → B → C → D → E. Never reverses.
  if (pct >= 25 && state.gifStage === 'A' && !state.gifPendingAdvance) {
    queueGifAdvance('B');
  } else if (pct >= 60 && state.gifStage === 'C' && !state.gifPendingAdvance) {
    queueGifAdvance('D');
  }
}

/* ---------- Rabbit GIF stage manager ----------
   Double-buffered: load the new GIF into the inactive <img>, await decode(),
   reveal it on top of the current one, then hide the old one one frame later.
   This keeps a frame visible at all times — no blank gap during decode. */
async function setGifStage(key) {
  const gif = STAGE_GIFS[key];
  if (!gif) return;
  if (state.gifAdvanceTimer) { clearTimeout(state.gifAdvanceTimer); state.gifAdvanceTimer = null; }
  state.gifStage = key;
  state.gifPendingAdvance = false;
  const curSlot = state.activeChar;
  const nextSlot = curSlot === 'A' ? 'B' : 'A';
  const curEl = curSlot === 'A' ? els.char : els.charB;
  const nextEl = nextSlot === 'A' ? els.char : els.charB;
  nextEl.src = gif.src;
  try { await nextEl.decode(); } catch (e) { /* ignore — fall through */ }
  if (state.gifStage !== key) return;
  nextEl.className = 'char-img char-gif';
  nextEl.style.visibility = 'visible';
  state.activeChar = nextSlot;
  state.gifStartAt = performance.now();
  // Hide the old one after the new one has been composited (2 rAFs guarantees paint).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (state.activeChar !== nextSlot) return;
    curEl.style.visibility = 'hidden';
    curEl.className = 'char-img';
  }));
  if (!gif.loop && gif.next) {
    state.gifAdvanceTimer = setTimeout(() => {
      state.gifAdvanceTimer = null;
      setGifStage(gif.next);
    }, gif.dur);
  }
}

function queueGifAdvance(nextKey) {
  const cur = STAGE_GIFS[state.gifStage];
  if (!cur || !cur.loop) return;
  state.gifPendingAdvance = true;
  const elapsed = performance.now() - state.gifStartAt;
  const remaining = cur.dur - (elapsed % cur.dur);
  if (state.gifAdvanceTimer) clearTimeout(state.gifAdvanceTimer);
  state.gifAdvanceTimer = setTimeout(() => {
    state.gifAdvanceTimer = null;
    setGifStage(nextKey);
  }, remaining);
}

/* ---------- Rhythm ticks ---------- */
function buildTicks() {
  const n = 12;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const tick = document.createElement('i');
    tick.style.transform = `translate(-50%, 0) rotate(${(360/n)*i}deg)`;
    frag.appendChild(tick);
  }
  els.rhythmTicks.appendChild(frag);
}

/* ---------- Rhythm loop ----------
   Beat scheduling is LOCKED to BGM audio.currentTime. No gauge-based speedup.
   Each beat's wall-clock time derives from audio position so taps align to music. */
function scheduleNextBeat(now) {
  const interval = TUNING.beatIntervalMs;
  state.lastBeatInterval = interval;
  const meta = state.currentBgmMeta;
  if (meta) {
    const audioMs = Snd.bgmCurrentTime() * 1000;
    // Detect BGM loop wrap: audio.currentTime jumped back to ~0 because loop=true restarted the track.
    // When that happens, reset beat grid + claim history so new beats can be scheduled/judged.
    if (state.beatIndex >= 0) {
      const expectedAudioMs = meta.offsetMs + state.beatIndex * interval;
      if (audioMs < expectedAudioMs - interval * 3) {
        state.beatIndex = -1;
        state.judgedBeats.clear();
      }
    }
    // Index derivable from audio position (smallest N where offset + N*interval > audioMs)
    const fromAudio = Math.max(0, Math.floor((audioMs - meta.offsetMs) / interval) + 1);
    // Ensure monotonic advance: always > last fired index (avoid re-fire when audio drifts slightly behind wall clock)
    const nextBeatN = Math.max(fromAudio, state.beatIndex + 1);
    const nextBeatAudioMs = meta.offsetMs + nextBeatN * interval;
    const audioDelay = Math.max(0, nextBeatAudioMs - audioMs);
    // Shift wall-clock beat time forward by audio output latency so visual/judgement
    // aligns with when the user actually hears the beat.
    const latency = TUNING.beatLatencyMs || 0;
    state.nextBeatAt = now + audioDelay + latency;
    // Record actual cycle length so updateIndicator can divide by the real window
    // (not the fixed interval). Prevents ring from stalling at start (audioDelay+latency > interval)
    // and from jumping mid-shrink after frame drops (audioDelay < interval).
    state.beatCycleDuration = audioDelay + latency;
    state.beatIndex = nextBeatN;
  } else {
    state.nextBeatAt = now + interval;
    state.beatCycleDuration = interval;
    state.beatIndex++;
  }
}
function updateIndicator(now) {
  // Indicator ring shrinks from 2.2x → 1.0x (matches rhythm-ring size) as the beat approaches.
  // It stays visible at ring-size for ~150ms after the beat ("hit window" pulse), then resets for the next beat.
  const interval = state.lastBeatInterval || TUNING.beatIntervalMs;
  const dt = state.nextBeatAt - now; // ms until next beat (positive before, negative after)

  // Use actual cycle duration (audioDelay + latency) rather than fixed interval.
  // With fixed interval: dt > interval at start → t=0 stalls for latencyMs (ring freezes).
  // After tap jank: scheduleNextBeat fires late → audioDelay shrinks → ring jumps mid-shrink.
  // With cycleDuration: ring always spans exactly from schedule time → nextBeatAt, no freezes/jumps.
  const cycleDuration = Math.max(50, state.beatCycleDuration || interval);
  let scale, opacity, glow;
  if (dt >= 0) {
    // approaching beat
    const t = Math.min(1, Math.max(0, 1 - dt / cycleDuration)); // 0 at schedule, 1 at beat
    scale = 2.2 - t * 1.2;  // 2.2 → 1.0
    opacity = 0.35 + t * 0.65;
  } else {
    // just after beat: brief "hit" flash at scale 1, then fade
    const tAfter = -dt;
    if (tAfter < 180) {
      scale = 1.0 + (tAfter / 180) * 0.15; // slight bloom 1.0 → 1.15
      opacity = 1 - (tAfter / 180) * 0.7;
    } else {
      scale = 2.2;
      opacity = 0.0;
    }
  }

  els.rhythmIndicator.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
  els.rhythmIndicator.style.opacity = opacity.toFixed(2);

  // Always yellow, just brighter near the beat
  if (Math.abs(dt) < TUNING.greatWindowMs) {
    els.rhythmIndicator.style.boxShadow = '0 0 40px 6px rgba(255,230,0,0.95), inset 0 0 18px rgba(255,230,0,0.6)';
  } else {
    els.rhythmIndicator.style.boxShadow = '0 0 16px rgba(255,230,0,0.55), inset 0 0 12px rgba(255,230,0,0.3)';
  }
  els.rhythmIndicator.style.borderColor = '#FFE600';
}

/* ---------- Tap judgment ---------- */
// One-judgement-per-beat: each beat index can be claimed by only one tap. Subsequent
// taps on an already-claimed beat are forced to miss, killing spam-tap strategies.
function judgeTap(now) {
  const interval = state.lastBeatInterval || TUNING.beatIntervalMs;
  const nextIdx = state.beatIndex;
  const prevIdx = state.beatIndex - 1;
  const dtNext = Math.abs(now - state.nextBeatAt);
  const dtPrev = Math.abs(now - (state.nextBeatAt - interval));

  // Pick the nearest unjudged beat (if any). prevIdx<0 is a virtual pre-song beat, skip.
  let bestDt = Infinity;
  let bestIdx = null;
  if (prevIdx >= 0 && !state.judgedBeats.has(prevIdx) && dtPrev < bestDt) { bestDt = dtPrev; bestIdx = prevIdx; }
  if (!state.judgedBeats.has(nextIdx) && dtNext < bestDt) { bestDt = dtNext; bestIdx = nextIdx; }

  // If both neighboring beats already claimed OR nearest is outside good window → miss,
  // and do NOT claim any beat (so future legitimate taps can still land).
  if (bestIdx === null || bestDt > TUNING.goodWindowMs) {
    return { rating: 'miss', gain: TUNING.gainMiss };
  }

  state.judgedBeats.add(bestIdx);
  if (bestDt <= TUNING.perfectWindowMs) return { rating: 'perfect', gain: TUNING.gainPerfect };
  if (bestDt <= TUNING.greatWindowMs)   return { rating: 'great',   gain: TUNING.gainGreat };
  return { rating: 'good', gain: TUNING.gainGood };
}

/* ---------- Effects ---------- */
function showBadge(rating) {
  const b = els.beatBadge;
  b.className = 'beat-badge ' + rating;
  b.textContent = rating.toUpperCase() + (rating === 'perfect' ? '!!' : (rating === 'great' ? '!' : ''));
  _badgeParity = !_badgeParity;
  b.classList.add(_badgeParity ? 'show' : 'show-b');
}

const GOOD_ICONS = [
  './assets/goodicon_01.webp',
  './assets/goodicon_02.webp',
  './assets/goodicon_03.webp',
  './assets/goodicon_04.webp',
  './assets/goodicon_05.webp',
  './assets/goodicon_06.webp',
  './assets/goodicon_07.webp',
];
// Preload and cache natural aspect ratios so particles don't get squashed
const GOOD_ICON_CACHE = {};
GOOD_ICONS.forEach(src => {
  const im = new Image();
  im.src = src;
  GOOD_ICON_CACHE[src] = im;
});

function spawnParticles(n, color) {
  if (!TUNING.particlesEnabled) return;
  const btn   = _rectBtn       || els.pushBtn.getBoundingClientRect();
  const stage = _rectParticles || els.particles.getBoundingClientRect();
  const cx = btn.left + btn.width/2 - stage.left;
  const cy = btn.top + btn.height/2 - stage.top;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('img');
    p.className = 'particle particle-good';
    const src = GOOD_ICONS[Math.floor(Math.random() * GOOD_ICONS.length)];
    p.src = src;
    p.alt = '';
    const size = rand(28, 52);
    const cached = GOOD_ICON_CACHE[src];
    const nw = cached && cached.naturalWidth ? cached.naturalWidth : 1;
    const nh = cached && cached.naturalHeight ? cached.naturalHeight : 1;
    const ratio = nw / nh;
    const w = ratio >= 1 ? size : size * ratio;
    const h = ratio >= 1 ? size / ratio : size;
    p.style.width = w + 'px';
    p.style.height = h + 'px';
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.transform = 'translate(-50%, -50%)';
    els.particles.appendChild(p);
    const angle = rand(-Math.PI, 0) + rand(-0.4, 0.4);
    const dist = rand(80, 200) * (0.7 + TUNING.effectIntensity/20);
    const dx = Math.cos(angle)*dist, dy = Math.sin(angle)*dist - rand(20,50);
    const rot = rand(-360, 360), dur = rand(0.8, 1.3);
    if (window.gsap) {
      gsap.to(p, { x: dx, y: dy, rotation: rot, scale: rand(0.35, 0.7), duration: dur, ease: 'power2.out', onComplete: () => p.remove() });
      gsap.to(p, { opacity: 0, duration: dur * 0.45, delay: dur * 0.55, ease: 'power1.in' });
    } else {
      setTimeout(() => p.remove(), 1000);
    }
  }
}

function spawnRipple() {
  const r = document.createElement('div');
  r.className = 'ripple';
  els.pushBtn.parentElement.appendChild(r);
  setTimeout(() => r.remove(), 620);
}
function doFlash(s=0.2) { els.flash.style.opacity = s; setTimeout(() => els.flash.style.opacity = 0, 80); }
function doShake(mag=2) {
  mag *= TUNING.effectIntensity/9;
  if (window.gsap) gsap.fromTo(els.screen, { x: -mag }, { x: 0, duration: 0.18, ease: 'elastic.out(1.2,0.3)', overwrite: 'auto' });
}

function spawnCombo(text, cls) {
  const t = document.createElement('div');
  t.className = 'combo-pop ' + (cls||'');
  t.textContent = text;
  const btn   = _rectBtn   || els.pushBtn.getBoundingClientRect();
  const stage = _rectCombo || els.comboLayer.getBoundingClientRect();
  const x = btn.left + btn.width * rand(0.2, 0.8) - stage.left;
  const y = btn.top + rand(-30, 20) - stage.top;
  t.style.left = x+'px'; t.style.top = y+'px';
  t.style.transform = `translate(-50%,-50%) rotate(${rand(-12,12)}deg)`;
  els.comboLayer.appendChild(t);
  const dy = -rand(90, 150), dx = rand(-30,30);
  if (window.gsap) {
    gsap.fromTo(t, { scale: 0.2, opacity: 0 }, { scale: 1.15, opacity: 1, duration: 0.12, ease: 'back.out(2)', onComplete: () => {
      gsap.to(t, { x: dx, y: dy, opacity: 0, scale: 0.8, duration: 0.85, ease: 'power2.out', onComplete: () => t.remove() });
    }});
  } else setTimeout(() => t.remove(), 1000);
}

/* ---------- Tap handling ---------- */
function handleTap(ev) {
  if (!state.running) return;
  if (ev && ev.cancelable) ev.preventDefault();
  if (ev && ev.type === 'touchstart') els.pushBtn._touched = true;
  if (ev && ev.type === 'mousedown' && els.pushBtn._touched) { els.pushBtn._touched = false; return; }

  // Ignore overshoot taps after the 30-mash finisher so the gauge can't rebound to 99.
  // mashCountチェックは sticky guard: finishMashModeでmashMode=falseになった直後の隙間にも効く。
  if (cleared || state.gauge >= 100 || state.mashCount >= state.mashTarget) return;

  const now = performance.now();
  if (now - state.lastTapAt < 60) return; // debounce
  state.lastTapAt = now;
  state.taps++;
  els.tapCount.textContent = String(state.runningScore || 0).padStart(6, '0');

  // Mash mode (99% → 30連打) bypasses rhythm judgment entirely.
  if (state.mashMode) {
    if (state.mashCount >= state.mashTarget) return;
    doMashTap();
    return;
  }

  const { rating, gain } = judgeTap(now);
  // Cap at 99 — the final 1% is earned by clearing the 30-tap mash phase.
  state.gauge = Math.min(99, state.gauge + gain);

  // combo logic: perfect/great/good build combo, miss resets
  if (rating === 'miss') {
    state.combo = 0;
    state.perfectStreak = 0;
    state.missCount++;
  } else {
    state.combo++;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    if (rating === 'perfect') { state.perfectStreak++; state.perfectCount++; }
    else { state.perfectStreak = 0; }
    if (rating === 'great') state.greatCount++;
    else if (rating === 'good') state.goodCount++;
  }

  // running score (HUD motivator): miss gives 0 to kill mashing-for-points
  const ratingPts = { perfect: 300, great: 180, good: 90, miss: 0 }[rating];
  const comboMult = 1 + Math.min(state.combo, 30) * 0.05;
  state.runningScore += Math.round(ratingPts * comboMult);
  els.tapCount.textContent = String(state.runningScore).padStart(6, '0');

  Snd.hit(rating);

  els.pushBtn.classList.add('pressed');
  clearTimeout(els.pushBtn._rt);
  els.pushBtn._rt = setTimeout(() => els.pushBtn.classList.remove('pressed'), 90);

  spawnRipple();
  showBadge(rating);

  // effect scaling by rating
  const ratingBoost = { perfect: 2.2, great: 1.4, good: 1.0, miss: 0.5 }[rating];
  const partCount = Math.round((4 + TUNING.effectIntensity * 0.6) * ratingBoost);
  const partColor = rating === 'perfect' ? '#FFE600' : (rating === 'great' ? '#FF4DF6' : null);
  spawnParticles(partCount, partColor);

  // combo popup
  if (rating === 'perfect' && state.perfectStreak >= 3) spawnCombo(`PERFECT × ${state.perfectStreak}`, 'perfect');
  else if (state.combo >= 10 && state.combo % 5 === 0) spawnCombo(`${state.combo} COMBO!`, 'mega');
  else if (rating === 'perfect') spawnCombo('+' + Math.floor(gain), 'big');
  else if (rating === 'great')   spawnCombo('+' + Math.floor(gain), '');
  else if (rating === 'good')    spawnCombo('+' + Math.floor(gain), 'small');
  else                           spawnCombo('miss', 'small');

  if (TUNING.flashEnabled) doFlash(rating==='perfect' ? 0.35 : (rating==='great'?0.2:0.1));
  if (TUNING.shakeEnabled) doShake(rating==='perfect' ? 4 : (rating==='great' ? 3 : 2));

  _pulseParity = !_pulseParity;
  els.gaugePulse.className = 'gauge-pulse ' + (_pulseParity ? 'pulse-a' : 'pulse-b');

  if (window.gsap) gsap.fromTo(els.pushBtn, { scale: 0.92 }, { scale: 1, duration: 0.3, ease: 'elastic.out(1.2,0.4)' });

  renderGauge();
  // Gauge hitting 99 arms the mash phase; a short delay lets the final tap's
  // flash/shake settle before 「猛プッシュ」overlay crashes in.
  if (state.gauge >= 99 && !state.mashMode && !state.mashPending && !cleared) {
    state.mashPending = true;
    // Freeze rhythm-phase clear time here so the mash duration doesn't eat the time bonus.
    state.rhythmClearSec = (now - state.startAt) / 1000;
    setTimeout(() => {
      state.mashPending = false;
      enterMashMode();
    }, 350);
  }
}

/* ---------- Mash phase (99% → 30連打) ---------- */
function enterMashMode() {
  if (state.mashMode || cleared) return;
  state.mashMode = true;
  state.mashCount = 0;
  els.mashCount.textContent = '0';
  els.scenes.game.classList.add('mash-mode');
  els.pushBtn.classList.add('mash-pulse');
  els.mashOverlay.classList.remove('show'); void els.mashOverlay.offsetWidth;
  els.mashOverlay.classList.add('show');
  Snd.playSE('se2');
  if (TUNING.flashEnabled) doFlash(0.55);
  if (TUNING.shakeEnabled) doShake(6);
}

function doMashTap() {
  // 最終防衛線: どこかの経路でガードをすり抜けてもここで遮断
  if (state.mashCount >= state.mashTarget || cleared) return;
  state.mashCount++;
  els.mashCount.textContent = String(state.mashCount);
  _mashPopParity = !_mashPopParity;
  els.mashCount.className = _mashPopParity ? 'pop' : 'pop-b';

  // Gauge creeps 99 → 100 proportionally to mash progress so the bar visibly fills
  state.gauge = Math.min(100, 99 + (state.mashCount / state.mashTarget));
  renderGauge();

  // Running score bonus per mash tap (contributes to final score)
  state.runningScore = (state.runningScore || 0) + 200;
  els.tapCount.textContent = String(state.runningScore).padStart(6, '0');
  state.maxCombo = Math.max(state.maxCombo || 0, state.mashCount);

  // Feedback per tap: particles + ripple + flash + shake (count halved vs normal to reduce jank)
  Snd.hit('great');
  const n = Math.round((3 + TUNING.effectIntensity * 0.55));
  spawnParticles(n);
  spawnRipple();
  if (TUNING.flashEnabled) doFlash(0.28);
  if (TUNING.shakeEnabled) doShake(3.5);

  // Gauge pulse for the HUD bar
  _pulseParity = !_pulseParity;
  els.gaugePulse.className = 'gauge-pulse ' + (_pulseParity ? 'pulse-a' : 'pulse-b');

  // Button press feedback (doesn't fight with mash-pulse animation)
  els.pushBtn.classList.add('pressed');
  clearTimeout(els.pushBtn._rt);
  els.pushBtn._rt = setTimeout(() => els.pushBtn.classList.remove('pressed'), 80);

  // Milestone combo popups (every 10 taps, plus the finisher)
  if (state.mashCount === 10 || state.mashCount === 20) {
    spawnCombo(`${state.mashCount} / ${state.mashTarget}`, 'mega');
  } else if (state.mashCount >= state.mashTarget) {
    spawnCombo('BREAKTHROUGH!!', 'perfect');
    finishMashMode();
    return;
  } else if (state.mashCount % 3 === 0) {
    spawnCombo('+200', 'small');
  }
}

function finishMashMode() {
  state.mashMode = false;
  // handleTap冒頭の state.running チェックで、triggerClear待ち300ms中のオーバーシュートタップを確実に遮断
  state.running = false;
  els.pushBtn.classList.remove('mash-pulse');
  els.mashOverlay.classList.remove('show');
  els.scenes.game.classList.remove('mash-mode');
  state.gauge = 100;
  renderGauge();
  if (TUNING.flashEnabled) doFlash(0.7);
  if (TUNING.shakeEnabled) doShake(7);
  setTimeout(triggerClear, 300);
}

/* ---------- Loop ---------- */
function loop() {
  if (!state.running) return;
  const now = performance.now();
  const elapsedSec = (now - state.startAt) / 1000;
  els.timer.textContent = elapsedSec.toFixed(1) + 's';
  state.elapsedSec = elapsedSec;

  // beat scheduling (paused during mash phase)
  if (!state.mashMode) {
    if (now >= state.nextBeatAt) {
      scheduleNextBeat(now);
    }
    updateIndicator(now);
  }

  // decay if no recent tap (tracked for final score penalty).
  // Skipped in mash mode so the gauge stays frozen at 99.
  if (!state.mashMode && now - state.lastTapAt > 300 && state.gauge > 0 && state.gauge < 100) {
    const decayAmt = TUNING.decayPerSec / 60;
    const actualDecay = Math.min(state.gauge, decayAmt);
    state.gauge = Math.max(0, state.gauge - decayAmt);
    state.decayTotal += actualDecay;
    renderGauge();
  }

  state.rafId = requestAnimationFrame(loop);
}

/* ---------- Start / Clear ---------- */
function startGame() {
  showScene('game');
  state.gauge = 0; state.taps = 0; state.combo = 0; state.perfectStreak = 0; state.maxCombo = 0;
  state.perfectCount = 0; state.greatCount = 0; state.goodCount = 0; state.missCount = 0;
  state.decayTotal = 0;
  state.judgedBeats = new Set();
  state.currentBgmMeta = null;
  state.runningScore = 0;
  state.running = false;
  state.lastTapAt = 0;
  state.mashMode = false;
  state.mashCount = 0;
  state.rhythmClearSec = 0;
  state.mashPending = false;
  els.scenes.game.classList.remove('mash-mode');
  els.pushBtn.classList.remove('mash-pulse');
  if (els.mashOverlay) els.mashOverlay.classList.remove('show');
  if (els.mashCount) els.mashCount.textContent = '0';
  cleared = false;
  setGifStage('A');
  renderGauge();
  els.tapCount.textContent = '000000';
  els.timer.textContent = '0.0s';
  if (els.finishOverlay) els.finishOverlay.classList.remove('show');
  els.scenes.game.classList.remove('finishing');
  if (els.nowPlaying) els.nowPlaying.innerHTML = '';
  Snd.resume();
  runCountdown(beginPlay);
}

function beginPlay() {
  // BGM starts here (at GO!!) not during countdown — pre-warming BGM during countdown
  // broke Galaxy Chrome: audio.currentTime drifts against wall clock during the 2.5s warmup,
  // so by the time beginPlay runs, audioDelay perpetually inflates past one interval
  // and the rhythm ring appears slow-motion (or frozen-then-moving after cycleDuration clamp).
  // Starting BGM here means audio.currentTime=0 when scheduleNextBeat first runs, which
  // produces a slightly longer first cycle (~567ms vs 540ms) on PC but stays stable everywhere.
  updateRectCache();
  const track = Snd.gameBgmStart();
  state.currentBgmMeta = track;
  TUNING.beatIntervalMs = Math.round((60000 / track.bpm) * 100) / 100;
  document.documentElement.style.setProperty('--beat-duration', TUNING.beatIntervalMs + 'ms');
  if (els.nowPlaying) {
    els.nowPlaying.innerHTML = '<span class="np-note">♪</span><span class="np-title"></span>';
    const titleSpan = els.nowPlaying.querySelector('.np-title');
    const titleChars = (track.title || '').split('');
    titleChars.forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'np-char';
      s.style.setProperty('--ir', titleChars.length - 1 - i);
      s.textContent = ch === ' ' ? ' ' : ch;
      titleSpan.appendChild(s);
    });
  }
  state.startAt = performance.now();
  state.beatIndex = -1;
  state.running = true;
  state.lastTapAt = 0;
  scheduleNextBeat(state.startAt);
  cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(loop);
}

function runCountdown(onDone) {
  const overlay = els.countdownOverlay;
  const numEl = els.countdownNum;
  if (!overlay || !numEl) { onDone(); return; }
  overlay.classList.add('show');
  // Total 1600ms: short enough that audio hasn't had time to drift on Galaxy Chrome.
  // BGM starts in beginPlay (after this countdown) at audio.currentTime=0.
  const steps = [
    { text: 'READY?', dur: 900, go: false },
    { text: 'GO!!',   dur: 700, go: true  },
  ];
  let i = 0;
  const tick = () => {
    if (i >= steps.length) {
      overlay.classList.remove('show');
      setTimeout(onDone, 140);
      return;
    }
    const s = steps[i];
    numEl.classList.remove('pop', 'go');
    void numEl.offsetWidth;
    numEl.textContent = s.text;
    if (s.go) numEl.classList.add('go');
    numEl.classList.add('pop');
    Snd.playSE(s.go ? 'se2' : 'se1');
    i++;
    setTimeout(tick, s.dur);
  };
  tick();
}

let cleared = false;
function triggerClear() {
  if (cleared) return;
  cleared = true;
  state.running = false;
  state.clearTime = state.elapsedSec || ((performance.now() - state.startAt) / 1000);
  state.finalScore = computeFinalScore();
  cancelAnimationFrame(state.rafId);
  Snd.bgmStop();
  doFlash(0.6);
  // Cancel any pending stage advance; play F only after current loop GIF finishes its cycle
  if (state.gifAdvanceTimer) { clearTimeout(state.gifAdvanceTimer); state.gifAdvanceTimer = null; }
  state.gifPendingAdvance = false;
  els.scenes.game.classList.add('finishing');
  showFinishOverlay();
  const cur = STAGE_GIFS[state.gifStage];
  let waitMs = 0;
  if (cur && state.gifStartAt) {
    const elapsed = performance.now() - state.gifStartAt;
    waitMs = cur.dur - (elapsed % cur.dur);
  }
  setTimeout(() => setGifStage('F'), waitMs);
}

function showFinishOverlay() {
  const overlay = els.finishOverlay;
  if (!overlay) {
    setTimeout(() => { showScene('clear'); showClearSequence(); }, CLEAR_F_PLAY_MS);
    return;
  }
  overlay.classList.remove('show'); void overlay.offsetWidth;
  overlay.classList.add('show');
  Snd.playSE('seClear');
  setTimeout(() => {
    overlay.classList.remove('show');
    showScene('clear');
    showClearSequence();
  }, CLEAR_F_PLAY_MS);
}

/* ---------- Rolling number / Rank ---------- */
function rollNumber(el, from, to, duration = 900, onDone) {
  if (!el) { onDone && onDone(); return; }
  const startTs = performance.now();
  el.classList.add('rolling');
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  function frame(now) {
    const t = Math.min(1, (now - startTs) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = from + (to - from) * eased;
    el.textContent = fmt(val);
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      el.textContent = fmt(to);
      el.classList.remove('rolling');
      el.classList.remove('pop'); void el.offsetWidth;
      el.classList.add('pop');
      onDone && onDone();
    }
  }
  requestAnimationFrame(frame);
}

function computeRank(score) {
  if (score >= 25000) return 'S';
  if (score >= 23000) return 'A';
  if (score >= 21000) return 'B';
  if (score >= 19000) return 'C';
  return 'D';
}

/* Final score: timing-first balance — reward precision + combo + speed, penalize
   hammering and gauge decay.
   - hitScore: runningScore (per-tap rating*combo mult). Miss=0.
   - timeBonus: target=18秒を基準に2段階で算出。マッシュフェーズ時間は除外しリズムクリア時間のみ評価。
     18秒以下: 5000 + (target - rhythmSec) * 1500  （最速17秒で6500、16秒で8000）
     18秒超: Math.max(0, (target + 5 - rhythmSec) * 1000)  （23秒以上は0）
   - accuracyBonus: perfectCount*400 + greatCount*150。タイミング精度を直接報酬。
   - comboBonus: maxCombo * 200。
   - noMissBonus: missCount===0 で +3000 フラット（パーフェクトラン報酬）。
   - decayPenalty: 減衰で失ったゲージ量 * 40 を減点。
   - efficiencyFactor: タップ数超過で減衰、下限 0.3。 */
function computeFinalScore() {
  const hitScore = state.runningScore || 0;
  const target = TUNING.targetTimeSec || 16;
  const rhythmSec = state.rhythmClearSec || state.clearTime;
  const timeBonus = rhythmSec <= target
    ? 5000 + Math.round((target - rhythmSec) * 1500)
    : Math.max(0, Math.round((target + 5 - rhythmSec) * 1000));
  const accuracyBonus = (state.perfectCount || 0) * 400 + (state.greatCount || 0) * 150;
  const comboBonus = (state.maxCombo || 0) * 200;
  const noMissBonus = (state.missCount || 0) === 0 ? 3000 : 0;
  const decayPenalty = Math.round((state.decayTotal || 0) * 40);
  const optimalTaps = 29;
  const efficiencyFactor = Math.max(
    0.3,
    Math.min(1.0, optimalTaps / Math.max(state.taps || optimalTaps, optimalTaps))
  );
  const raw = hitScore + timeBonus + accuracyBonus + comboBonus + noMissBonus - decayPenalty;
  const total = Math.max(0, Math.round(raw * efficiencyFactor));
  state.scoreBreakdown = { hitScore, timeBonus, accuracyBonus, comboBonus, noMissBonus, decayPenalty, efficiencyFactor, total };
  return total;
}
function renderCTAScore() {
  const bd = state.scoreBreakdown || { hitScore: 0, timeBonus: 0, accuracyBonus: 0, comboBonus: 0, noMissBonus: 0, decayPenalty: 0, total: state.finalScore || 0 };
  const total = bd.total || state.finalScore || 0;
  const rank = computeRank(total);
  state.rank = rank;
  // "TIMING BONUS" row bundles accuracy + noMiss - decay (non-negative display)
  const timingVal = Math.max(0, (bd.accuracyBonus || 0) + (bd.noMissBonus || 0) - (bd.decayPenalty || 0));

  // reset rows + rank
  [els.sbRowScore, els.sbRowCombo, els.sbRowTiming, els.sbRowTime, els.sbRowTotal].forEach(r => r && r.classList.remove('show'));
  if (els.sbDivider) els.sbDivider.classList.remove('show');
  if (els.sbScore)       els.sbScore.textContent = '0';
  if (els.sbCombo)       els.sbCombo.textContent = '0';
  if (els.sbTimingBonus) els.sbTimingBonus.textContent = '0';
  if (els.sbTimeBonus)   els.sbTimeBonus.textContent = '0';
  if (els.sbTotal)       els.sbTotal.textContent = '0';
  if (els.ctaRankBadge) {
    els.ctaRankBadge.className = 'cta-rank-badge';
    els.ctaRankBadge.textContent = rank;
  }

  const delays = {
    row1:    300,
    row2:    850,
    row3:   1400,
    row4:   1950,
    divider:2500,
    total:  2700,
    rank:   3950,
  };

  setTimeout(() => {
    if (els.sbRowScore) els.sbRowScore.classList.add('show');
    Snd.countBeep(false);
    rollNumber(els.sbScore, 0, bd.hitScore, 600);
  }, delays.row1);

  setTimeout(() => {
    if (els.sbRowCombo) els.sbRowCombo.classList.add('show');
    Snd.countBeep(false);
    rollNumber(els.sbCombo, 0, state.maxCombo || 0, 500);
  }, delays.row2);

  setTimeout(() => {
    if (els.sbRowTiming) els.sbRowTiming.classList.add('show');
    Snd.countBeep(false);
    rollNumber(els.sbTimingBonus, 0, timingVal, 600);
  }, delays.row3);

  setTimeout(() => {
    if (els.sbRowTime) els.sbRowTime.classList.add('show');
    Snd.countBeep(false);
    rollNumber(els.sbTimeBonus, 0, bd.timeBonus, 600);
  }, delays.row4);

  setTimeout(() => {
    if (els.sbDivider) els.sbDivider.classList.add('show');
  }, delays.divider);

  setTimeout(() => {
    if (els.sbRowTotal) els.sbRowTotal.classList.add('show');
    Snd.countBeep(true);
    rollNumber(els.sbTotal, 0, total, 1100);
  }, delays.total);

  setTimeout(() => {
    if (els.ctaRankBadge) {
      els.ctaRankBadge.classList.add('rank-' + rank, 'show');
      Snd.finish();
    }
  }, delays.rank);
}

/* ---------- SNS share ---------- */
const SHARE_HASHTAGS = '#きょむうさ猛プッシュ #CasLive';
const SHARE_URL = (typeof window !== 'undefined' && window.location) ? window.location.href.split('?')[0] : 'https://caslive.jp/';
function buildShareText() {
  const score = (state.finalScore || 0).toLocaleString('en-US');
  const rank = state.rank || computeRank(state.finalScore || 0);
  return `きょむうさ猛プッシュで ランク ${rank} / スコア ${score} 達成！\n${SHARE_HASHTAGS}`;
}
function shareOnX() {
  const text = buildShareText();
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SHARE_URL)}`;
  window.open(url, '_blank', 'noopener');
}
function shareOnLine() {
  const text = buildShareText() + '\n' + SHARE_URL;
  const url = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(SHARE_URL)}&text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}
function shareOnThreads() {
  const text = buildShareText() + '\n' + SHARE_URL;
  const url = `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}
function shareCopy() {
  const text = buildShareText() + '\n' + SHARE_URL;
  const done = () => {
    if (els.shareToast) {
      els.shareToast.classList.remove('show'); void els.shareToast.offsetWidth;
      els.shareToast.classList.add('show');
      setTimeout(() => els.shareToast.classList.remove('show'), 1800);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(done);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
    done();
  }
}

/* ---------- Clear scene sequence ---------- */
function showClearSequence() {
  els.clearWindow.classList.remove('show'); void els.clearWindow.offsetWidth;
  els.clearWindow.classList.add('show');
  els.typed.textContent = '';
  els.clearActions.classList.remove('show');
  // type "他の人より\nもう一歩、\nキョリが近づいた。"
  const text = '他の人より\nもう一歩、\nキョリが近づいた。';
  let i = 0;
  setTimeout(function typeNext() {
    if (i >= text.length) {
      setTimeout(() => els.clearActions.classList.add('show'), 260);
      return;
    }
    els.typed.textContent += text[i];
    // typewriter sfx hook: document.getElementById('se-type')?.play()
    i++;
    const d = text[i-1] === '\n' ? 220 : (50 + Math.random()*40);
    setTimeout(typeNext, d);
  }, 650);
}

function onYes() {
  Snd.playSE('se3');
  showScene('video');
  const v = els.splashVideo;
  try { v.currentTime = 0; } catch(e){}
  v.play().catch(()=>{});
  v.onended = () => { showScene('cta'); renderCTAScore(); Snd.ctaBgmStart(); };
  // safety fallback in case video can't play
  setTimeout(() => {
    if (els.scenes.video.classList.contains('active') && (v.paused || v.ended || v.readyState < 2)) {
      showScene('cta');
      renderCTAScore();
      Snd.ctaBgmStart();
    }
  }, 5000);
}

function onNo(ev) {
  const b = ev.currentTarget;
  b.classList.remove('shake'); void b.offsetWidth;
  b.classList.add('shake');
  doShake(5);
}

/* ---------- Wire up ---------- */
function bind() {
  const startFn = (e) => { e && e.preventDefault && e.preventDefault(); Snd.resume(); Snd.playSE('se3', 0.21); Snd.fadeOutBGM(1000); startGame(); };
  const on = (el, ev, fn, opts) => { if (el) el.addEventListener(ev, fn, opts); };
  on(els.startBtn, 'click', startFn);
  on(els.startBtn, 'touchstart', startFn, { passive: false });

  on(els.pushBtn, 'touchstart', handleTap, { passive: false });
  on(els.pushBtn, 'mousedown', handleTap);
  on(els.pushBtn, 'contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => { if (e.code==='Space' && state.running) { e.preventDefault(); handleTap(e); } });

  on(els.yesBtn, 'click', onYes);
  on(els.noBtn, 'click', onNo);
  on(els.shareX, 'click', shareOnX);
  on(els.shareLine, 'click', shareOnLine);
  on(els.shareThreads, 'click', shareOnThreads);
  on(els.shareCopy, 'click', shareCopy);
  on(els.retryBtn, 'click', () => {
    cleared = false;
    state.running = false;
    Snd.titleBgmStart();
    showScene('title');
    animateTitle();
    typeTagline();
  });

  on(els.soundBtn, 'click', (e) => {
    e && e.preventDefault && e.preventDefault();
    Snd.resume();
    Snd.toggle();
    updateSoundBtn();
    if (els.scenes.title.classList.contains('active')) Snd.titleBgmStart();
    else Snd.retryBgm();
  });

  const firstGesture = () => {
    if (els.scenes.title.classList.contains('active')) Snd.titleBgmStart();
    else Snd.retryBgm();
  };
  document.addEventListener('pointerdown', firstGesture, { once: true, capture: true });
  document.addEventListener('keydown', firstGesture, { once: true, capture: true });
}

/* ---------- Tweaks ---------- */
function applyTweaks() {
  document.documentElement.style.setProperty('--holo-strength', (TUNING.hologramStrength/10).toFixed(2));
}
function setupTweaks() {
  window.addEventListener('message', (ev) => {
    const d = ev.data || {};
    if (d.type === '__activate_edit_mode') els.tweaksPanel.classList.add('open');
    else if (d.type === '__deactivate_edit_mode') els.tweaksPanel.classList.remove('open');
  });
  try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch(e){}
  const panel = els.tweaksPanel;
  panel.innerHTML = `
    <h3>TWEAKS</h3>
    <div class="tweak-row"><label>ビート間隔(ms) <span class="val" id="t-bi-v">${TUNING.beatIntervalMs}</span></label>
      <input type="range" id="t-bi" min="300" max="900" step="20" value="${TUNING.beatIntervalMs}"/></div>
    <div class="tweak-row"><label>PERFECT窓(ms) <span class="val" id="t-pw-v">${TUNING.perfectWindowMs}</span></label>
      <input type="range" id="t-pw" min="40" max="180" step="10" value="${TUNING.perfectWindowMs}"/></div>
    <div class="tweak-row"><label>エフェクト派手さ <span class="val" id="t-ef-v">${TUNING.effectIntensity}</span></label>
      <input type="range" id="t-ef" min="0" max="10" step="1" value="${TUNING.effectIntensity}"/></div>
    <div class="tweak-row"><label>ホログラム <span class="val" id="t-ho-v">${TUNING.hologramStrength}</span></label>
      <input type="range" id="t-ho" min="0" max="10" step="1" value="${TUNING.hologramStrength}"/></div>
    <div class="tweak-row"><label>減衰量 <span class="val" id="t-dc-v">${TUNING.decayPerSec}</span></label>
      <input type="range" id="t-dc" min="0" max="6" step="0.2" value="${TUNING.decayPerSec}"/></div>
    <div class="tweak-row"><label>SHAKE / FLASH</label>
      <div class="chips">
        <button class="chip ${TUNING.shakeEnabled?'active':''}" data-t="shake">SHAKE</button>
        <button class="chip ${TUNING.flashEnabled?'active':''}" data-t="flash">FLASH</button>
      </div></div>
  `;
  const post = (k, v) => { TUNING[k] = v; try { window.parent.postMessage({ type:'__edit_mode_set_keys', edits:{[k]:v} }, '*'); } catch(e){} };
  const bindR = (id, key, fmt) => {
    const el = panel.querySelector('#'+id);
    const vEl = panel.querySelector('#'+id+'-v');
    el.oninput = (e) => {
      const v = +e.target.value;
      post(key, v); vEl.textContent = fmt ? fmt(v) : v;
      if (key === 'hologramStrength') applyTweaks();
    };
  };
  bindR('t-bi', 'beatIntervalMs');
  bindR('t-pw', 'perfectWindowMs');
  bindR('t-ef', 'effectIntensity');
  bindR('t-ho', 'hologramStrength');
  bindR('t-dc', 'decayPerSec');
  panel.querySelectorAll('.chip').forEach(c => {
    c.onclick = () => {
      const k = c.dataset.t === 'shake' ? 'shakeEnabled' : 'flashEnabled';
      TUNING[k] = !TUNING[k];
      c.classList.toggle('active', TUNING[k]);
      post(k, TUNING[k]);
    };
  });
}

/* ---------- Init ---------- */
function init() {
  // preload all stage GIFs
  Object.values(STAGE_GIFS).forEach(g => { new Image().src = g.src; });
  Snd.seLoad();
  buildTicks();
  applyTweaks();
  bind();
  setupTweaks();
  updateSoundBtn();
  animateTitle();
  typeTagline();
  showScene('title');
  Snd.titleBgmStart();
}
init();
