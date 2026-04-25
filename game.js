/* ============================================================
   きょむうさ猛プッシュ — game.js (rev 2, rhythm tap)
   ============================================================ */

const GAME_VERSION = 'v109';

/* ---------- Ranking API ---------- */
// Always use the remote Workers endpoint. The localhost fallback is intentionally
// removed — in practice nobody has wrangler dev running locally, so localhost
// would fail-fast with a network error and show "接続できません" even though
// the prod API is up. For local dev, edit this constant temporarily.
const RANKING_API = 'https://kyomuusa-ranking.kento-nakamura-62a.workers.dev';

const TUNING = /*EDITMODE-BEGIN*/{
  "beatIntervalMs": 560,
  "beatSpeedupAt100": 0.5,
  "perfectWindowMs": 100,
  "greatWindowMs": 190,
  "goodWindowMs": 290,
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
  "particlesEnabled": true,
  "useAudioTimeSync": true
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
  indicatorActive: false,
  indicatorRafId: null,
  currentTrackId: null,
  rankingPromise: null,
  rankingResult: null,
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
  songPicker: $('#song-picker'),
  songPickerList: $('#song-picker-list'),
  songPickerVersion: $('#song-picker-version'),
  songPickerClose: $('#song-picker-close'),
  shareCopy: $('#share-copy'),
  shareToast: $('#cta-share-toast'),
  mashOverlay: $('#mash-overlay'),
  mashCount: $('#mash-count'),
  ctaScoreboardWrap: $('#cta-scoreboard-wrap'),
  ctaRanking: $('#cta-ranking'),
  ctaSlideDots: $('#cta-slide-dots'),
  rkList: $('#rk-list'),
  rkYou: $('#rk-you'),
  rkNewBadge: $('#rk-newbadge'),
  rkStatus: $('#rk-status'),
  nameModal: $('#rank-name-modal'),
  nameInput: $('#rank-name-input'),
  nameSubmit: $('#rank-name-submit'),
  nameSkip: $('#rank-name-skip'),
  nameError: $('#rank-name-error'),
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

/* ---------- Audio clock (Web Audio AudioContext-derived, v=98+) ----------
   Snd.bgmCurrentTime() now returns AudioContext-derived time (see v=98 migration
   from HTMLAudioElement to AudioBufferSourceNode). AudioContext.currentTime is
   sample-accurate and monotonic — the chunky-update problem that forced us to
   build wall-clock smoothing/anchor hacks (v=95〜97) is gone upstream.

   This function is retained as a thin wrapper so older call sites compile, but
   it's now equivalent to Snd.bgmCurrentTime() * 1000. Kept as a choke point in
   case per-device correction becomes needed later. */
function getAudioClockMs() {
  return Snd.bgmCurrentTime() * 1000;
}

/* ============================================================
   Sound Manager — Web Audio (procedural SE + BGM)
   ============================================================ */
const Snd = (() => {
  let ctx = null;
  let master = null;
  // Web Audio BGM (v=98+): HTMLAudio was replaced with AudioBufferSourceNode for
  // sample-accurate timing. bgmCurrentTime() now returns AudioContext-derived
  // time, which is monotonic and not subject to the 50-200ms chunky-update
  // problem that plagued mobile HTMLAudio.currentTime readings.
  const bgmBufferCache = new Map(); // src -> AudioBuffer
  let bgmSource = null;             // AudioBufferSourceNode currently playing
  let bgmGain = null;               // GainNode for volume/fade
  let bgmStartCtxTime = 0;          // AudioContext.currentTime at source.start()
  let bgmBufferDuration = 0;        // buffer.duration (for loop modulo)
  let bgmCurrentSrc = null;
  let bgmFadeStopTimer = null;      // setTimeout handle for post-fade stop
  let bgmLastRestartAt = 0;         // rate-limit onended restart cascades
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
    { src: './assets/musicA.mp3', bpm: 130.8, offsetMs: 487, title: 'Milky CasWay' },
    { src: './assets/musicB.mp3', bpm: 131, offsetMs: 468, title: 'Parallel CasNight' },
    { src: './assets/musicC.mp3', bpm: 130.8, offsetMs: 862, title: 'Signals of CasLiver' },
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
  // SE migrated to Web Audio (v=100) — HTMLAudio.cloneNode() spam on rapid
  // taps was suspected to starve iOS Safari's audio resources and kill BGM
  // mid-game. Web Audio buffer sources have no such limit and integrate with
  // the same AudioContext as BGM for a unified pipeline.
  const seBufferCache = new Map(); // src -> AudioBuffer
  try { muted = localStorage.getItem('kyomuusa_muted') === '1'; } catch (e) {}

  const loadSeBuffer = async (src) => {
    if (seBufferCache.has(src)) return seBufferCache.get(src);
    const c = ensure();
    if (!c) throw new Error('No AudioContext');
    const resp = await fetch(src);
    if (!resp.ok) throw new Error('SE fetch failed: ' + src);
    const arrayBuf = await resp.arrayBuffer();
    const audioBuf = await c.decodeAudioData(arrayBuf);
    seBufferCache.set(src, audioBuf);
    return audioBuf;
  };
  const seLoad = () => {
    return Promise.all(
      Object.values(SE_FILES).map(def => loadSeBuffer(def.src).catch(() => null))
    );
  };
  const playSE = (key, volOverride) => {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    const def = SE_FILES[key];
    if (!def) return;
    const buf = seBufferCache.get(def.src);
    if (!buf) return; // not yet decoded — skip silently rather than pop
    const baseVol = def.vol != null ? def.vol : SE_VOLUME;
    const vol = volOverride != null ? volOverride : baseVol;
    try {
      const gain = c.createGain();
      gain.gain.value = vol;
      gain.connect(c.destination);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      src.start(0);
      src.onended = () => {
        try { src.disconnect(); } catch (e) {}
        try { gain.disconnect(); } catch (e) {}
      };
    } catch (e) {}
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
  // iOS Safari unlock: play a 1-sample silent buffer SYNCHRONOUSLY inside the
  // user gesture handler. Without this, subsequent source.start() calls made
  // in async continuations (.then of decodeAudioData) silently fail on iPhone
  // because the gesture context has already expired. Must be called from
  // firstGesture or any user-gesture handler once per session.
  let iosUnlocked = false;
  const unlockAudio = () => {
    if (iosUnlocked) return;
    const c = ensure();
    if (!c) return;
    try {
      if (c.state === 'suspended') c.resume();
      const buf = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
      src.onended = () => { try { src.disconnect(); } catch (e) {} };
      iosUnlocked = true;
    } catch (e) {}
  };
  // ensurePlaying: if we intend BGM to be playing but source is null (iOS
  // suspended, source ended unexpectedly, etc.), restart. Safe to call
  // liberally — no-op if already playing.
  let bgmIntendedSrc = null;
  const ensurePlaying = () => {
    if (!bgmIntendedSrc) return;
    const c = ensure();
    if (!c) return;
    if (c.state === 'suspended') {
      const p = c.resume();
      if (p && p.then) p.then(() => { if (!bgmSource && bgmIntendedSrc) startBGM(bgmIntendedSrc); });
      return;
    }
    if (!bgmSource) startBGM(bgmIntendedSrc);
  };
  const getCtxState = () => ctx ? ctx.state : 'none';
  const getBgmState = () => {
    const src = bgmIntendedSrc ? bgmIntendedSrc.split('/').pop() : '-';
    const playing = bgmSource ? 'yes' : 'no';
    return 'bgm: ' + playing + ' (' + src + ')';
  };
  const getAudioSessionType = () => {
    try { return navigator.audioSession ? navigator.audioSession.type : 'n/a'; }
    catch (e) { return 'err'; }
  };
  const setMute = (m) => {
    muted = m;
    try { localStorage.setItem('kyomuusa_muted', m ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = m ? 0 : 0.7;
    if (bgmGain && ctx) {
      const now = ctx.currentTime;
      try { bgmGain.gain.cancelScheduledValues(now); } catch (e) {}
      bgmGain.gain.setValueAtTime(m ? 0 : BGM_VOLUME, now);
    }
    // Unmuting: ALWAYS force-restart BGM. iOS zombie source problem —
    // a source created while ctx was suspended plays silently forever even
    // after ctx resumes; the gain change alone won't make it audible since
    // the source already ran through its unlock window. New source+new
    // start time is the only reliable path back to audible BGM.
    if (!m && bgmIntendedSrc) {
      const src = bgmIntendedSrc;
      // tiny timeout to let the current event handler finish before restart
      // (avoids fighting the gesture that triggered setMute)
      setTimeout(() => { if (bgmIntendedSrc === src) startBGM(src); }, 0);
    }
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

  // Fetch + decodeAudioData with caching. Each src only decoded once per session.
  const loadBgmBuffer = async (src) => {
    if (bgmBufferCache.has(src)) return bgmBufferCache.get(src);
    const c = ensure();
    if (!c) throw new Error('No AudioContext');
    const resp = await fetch(src);
    if (!resp.ok) throw new Error('BGM fetch failed: ' + src);
    const arrayBuf = await resp.arrayBuffer();
    const audioBuf = await c.decodeAudioData(arrayBuf);
    bgmBufferCache.set(src, audioBuf);
    return audioBuf;
  };
  // Preload all BGM buffers in parallel. Safe to call multiple times — cache hit skips.
  // Should be invoked on first user gesture so subsequent startBGM is instant.
  const bgmPreload = () => {
    const allSrcs = [TITLE_BGM, CTA_BGM, ...GAME_BGM_TRACKS.map(t => t.src)];
    return Promise.all(allSrcs.map(s => loadBgmBuffer(s).catch(() => null)));
  };
  const teardownBgmSource = () => {
    if (bgmFadeStopTimer) { clearTimeout(bgmFadeStopTimer); bgmFadeStopTimer = null; }
    if (bgmSource) {
      // Mark before nulling: iOS Safari sometimes queues onended on the task
      // loop even after onended=null, so the handler itself double-checks this flag.
      try { bgmSource._intentionallyStopped = true; } catch (e) {}
      try { bgmSource.onended = null; } catch (e) {}
      try { bgmSource.stop(0); } catch (e) {}
      try { bgmSource.disconnect(); } catch (e) {}
      bgmSource = null;
    }
    if (bgmGain) {
      try { bgmGain.disconnect(); } catch (e) {}
      bgmGain = null;
    }
    bgmCurrentSrc = null;
    bgmBufferDuration = 0;
    bgmStartCtxTime = 0;
  };
  const bgmStop = () => { bgmIntendedSrc = null; teardownBgmSource(); };
  // Internal: create source+gain, schedule play, record anchor time.
  const playBufferLoop = (c, src, buf) => {
    const gain = c.createGain();
    gain.gain.value = muted ? 0 : BGM_VOLUME;
    gain.connect(c.destination);
    const source = c.createBufferSource();
    source.buffer = buf;
    source.loop = true;
    source.connect(gain);
    const startAt = c.currentTime;
    source.start(startAt);
    // Self-healing: if iOS silently ends our source (hardware interrupt,
    // memory reclaim, suspend→resume edge case), restart it. Multiple guards
    // to prevent restart cascades on iPhone SE where iOS may rapid-fire onended:
    // - _intentionallyStopped: set by teardownBgmSource before stop()
    // - ctx.state === 'suspended': restarting would spawn another zombie
    // - rate-limit: ignore if we already restarted within 500ms
    source.onended = () => {
      if (source._intentionallyStopped) return;
      if (bgmIntendedSrc !== src || bgmSource !== source) return;
      bgmSource = null;
      if (!ctx || ctx.state !== 'running') return; // wait for ensurePlaying on next gesture
      const now = performance.now();
      if (now - (bgmLastRestartAt || 0) < 500) return;
      bgmLastRestartAt = now;
      setTimeout(() => {
        if (bgmIntendedSrc === src && !bgmSource && ctx && ctx.state === 'running') {
          startBGM(src);
        }
      }, 30);
    };
    bgmSource = source;
    bgmGain = gain;
    bgmStartCtxTime = startAt;
    bgmCurrentSrc = src;
    bgmBufferDuration = buf.duration;
  };
  const startBGM = (src) => {
    resume();
    const c = ensure();
    if (!c) return;
    bgmIntendedSrc = src; // track intent so ensurePlaying can recover dropouts
    // Always teardown current source — AudioBufferSourceNode is one-shot, can't
    // be restarted or reused. With cached buffers, recreating is cheap.
    teardownBgmSource();
    const cached = bgmBufferCache.get(src);
    if (cached) {
      playBufferLoop(c, src, cached);
      return;
    }
    // Async load + play. During load window, bgmCurrentTime returns 0.
    // Guard against races: if another startBGM fired while loading, abort.
    const tokenSrc = src;
    loadBgmBuffer(src).then((buf) => {
      if (!buf) return;
      if (bgmIntendedSrc !== tokenSrc) return; // user wanted a different track
      if (bgmSource || bgmCurrentSrc) return;  // something else took over
      playBufferLoop(c, tokenSrc, buf);
    }).catch(() => {});
  };
  const fadeOutBGM = (durationMs = 1000) => {
    const c = ensure();
    if (!c || !bgmGain || !bgmSource) return;
    if (bgmFadeStopTimer) { clearTimeout(bgmFadeStopTimer); bgmFadeStopTimer = null; }
    const now = c.currentTime;
    const endAt = now + durationMs / 1000;
    const currentGain = bgmGain.gain.value;
    try { bgmGain.gain.cancelScheduledValues(now); } catch (e) {}
    bgmGain.gain.setValueAtTime(currentGain, now);
    bgmGain.gain.linearRampToValueAtTime(0, endAt);
    // Schedule hard stop slightly after ramp ends to free the source.
    try { bgmSource.stop(endAt + 0.05); } catch (e) {}
    const srcRef = bgmSource;
    bgmFadeStopTimer = setTimeout(() => {
      bgmFadeStopTimer = null;
      // Only teardown if it's still the same source (no new startBGM intervened)
      if (bgmSource === srcRef) teardownBgmSource();
    }, durationMs + 80);
  };
  const titleBgmStart = () => startBGM(TITLE_BGM);
  const gameBgmStart = () => {
    let track = null;
    try {
      const forced = localStorage.getItem('kyomuusa_force_track');
      if (forced !== null && forced !== '') {
        const idx = parseInt(forced, 10);
        if (!isNaN(idx) && GAME_BGM_TRACKS[idx]) track = GAME_BGM_TRACKS[idx];
      }
    } catch (e) {}
    if (!track) track = GAME_BGM_TRACKS[Math.floor(Math.random() * GAME_BGM_TRACKS.length)];
    startBGM(track.src);
    return track;
  };
  const getTrackList = () => GAME_BGM_TRACKS;
  const ctaBgmStart = () => startBGM(CTA_BGM);
  // AudioContext-derived playback position (seconds). Sample-accurate and
  // monotonic — no chunky-update drift like HTMLAudio.currentTime.
  const bgmCurrentTime = () => {
    if (!ctx || !bgmSource || !bgmBufferDuration) return 0;
    const elapsed = ctx.currentTime - bgmStartCtxTime;
    if (elapsed < 0) return 0;
    return elapsed % bgmBufferDuration;
  };
  const retryBgm = () => {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  };

  return { tap, hit, countBeep, finish, titleBgmStart, gameBgmStart, ctaBgmStart, bgmStop, fadeOutBGM, retryBgm, bgmCurrentTime, bgmPreload, toggle, setMute, isMuted, resume, seLoad, playSE, getTrackList, unlockAudio, ensurePlaying, getCtxState, getBgmState, getAudioSessionType };
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
   Two scheduling modes (toggle via TUNING.useAudioTimeSync):
   - true (default): every-frame audio-time sync — re-derive beat grid from
     audio.currentTime each frame. Eliminates wall-clock drift inside a single
     beat cycle. Use with audio-time judgeTap + updateIndicator.
   - false: legacy per-beat wall-clock scheduling. Re-syncs only when a beat
     passes; drift accumulates until then. Use to revert if new path misbehaves.
   Toggle live: window.TUNING.useAudioTimeSync = false */
function scheduleNextBeat(now) {
  const interval = TUNING.beatIntervalMs;
  state.lastBeatInterval = interval;
  const meta = state.currentBgmMeta;

  if (TUNING.useAudioTimeSync && meta) {
    // EVERY-FRAME audio-derived schedule. Idempotent: same audioMs → same nextBeatN.
    const latency = TUNING.beatLatencyMs || 0;
    const audioMs = getAudioClockMs();
    if (state.beatIndex >= 0) {
      const expectedAudioMs = meta.offsetMs + state.beatIndex * interval;
      if (audioMs < expectedAudioMs - interval * 3) {
        state.beatIndex = -1;
        state.judgedBeats.clear();
      }
    }
    // Pure audio derivation — no `state.beatIndex + 1` (that would advance
    // every frame even without audio progress). Monotonicity is ensured by
    // audio.currentTime itself being monotonic (loop wrap handled above).
    const nextBeatN = Math.max(0, Math.floor((audioMs - meta.offsetMs) / interval) + 1);
    const nextBeatAudioMs = meta.offsetMs + nextBeatN * interval;
    const audioDelay = Math.max(0, nextBeatAudioMs - audioMs);
    state.nextBeatAt = now + audioDelay + latency;
    state.beatCycleDuration = Math.max(50, audioDelay + latency);
    state.beatIndex = nextBeatN;
    return;
  }

  // LEGACY per-beat wall-clock path (gated; runs only when a beat passes)
  if (now < state.nextBeatAt) return;
  if (meta) {
    const audioMs = Snd.bgmCurrentTime() * 1000;
    if (state.beatIndex >= 0) {
      const expectedAudioMs = meta.offsetMs + state.beatIndex * interval;
      if (audioMs < expectedAudioMs - interval * 3) {
        state.beatIndex = -1;
        state.judgedBeats.clear();
      }
    }
    const fromAudio = Math.max(0, Math.floor((audioMs - meta.offsetMs) / interval) + 1);
    const nextBeatN = Math.max(fromAudio, state.beatIndex + 1);
    const nextBeatAudioMs = meta.offsetMs + nextBeatN * interval;
    const audioDelay = Math.max(0, nextBeatAudioMs - audioMs);
    const latency = TUNING.beatLatencyMs || 0;
    state.nextBeatAt = now + audioDelay + latency;
    state.beatCycleDuration = audioDelay + latency;
    state.beatIndex = nextBeatN;
  } else {
    state.nextBeatAt = now + interval;
    state.beatCycleDuration = interval;
    state.beatIndex++;
  }
}
function updateIndicator(now) {
  const startScale = 2.2;
  const targetScale = 0.644;
  const interval = state.lastBeatInterval || TUNING.beatIntervalMs;
  const meta = state.currentBgmMeta;
  let scale, opacity, dtMin;

  if (TUNING.useAudioTimeSync && meta) {
    // Audio-time path: ring phase derived from audio.currentTime so visual stays
    // perfectly synced to the music (no wall-clock drift).
    const latency = TUNING.beatLatencyMs || 0;
    const audioMs = getAudioClockMs();
    const heardMs = audioMs - latency;
    const elapsed = heardMs - meta.offsetMs;
    if (elapsed < -interval) {
      // More than one cycle before first downbeat — idle ring
      scale = startScale;
      opacity = 0.35;
      dtMin = -elapsed;
    } else {
      // Within approach to first beat OR any subsequent cycle. Math.floor handles
      // negative elapsed correctly (rounds toward -∞), so phaseMs ∈ [0, interval).
      const phaseMs = elapsed - Math.floor(elapsed / interval) * interval;
      const t = phaseMs / interval; // 0 at last beat, 1 at next beat
      scale = startScale - t * (startScale - targetScale);
      opacity = 0.35 + t * 0.65;
      dtMin = Math.min(phaseMs, interval - phaseMs);
    }
  } else {
    // Legacy wall-clock path
    const cycleDuration = Math.max(50, state.beatCycleDuration || interval);
    const dt = state.nextBeatAt - now;
    if (dt >= 0) {
      const t = Math.min(1, Math.max(0, 1 - dt / cycleDuration));
      scale = startScale - t * (startScale - targetScale);
      opacity = 0.35 + t * 0.65;
    } else {
      const tAfter = -dt;
      if (tAfter < 180) {
        scale = targetScale + (tAfter / 180) * 0.10;
        opacity = 1 - (tAfter / 180) * 0.7;
      } else {
        scale = startScale;
        opacity = 0.0;
      }
    }
    dtMin = Math.abs(dt);
  }

  els.rhythmIndicator.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
  els.rhythmIndicator.style.opacity = opacity.toFixed(2);

  // Brighter glow near the beat (yellow always)
  if (dtMin < TUNING.greatWindowMs) {
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
  const meta = state.currentBgmMeta;

  if (TUNING.useAudioTimeSync && meta) {
    // Audio-time path: compare tap moment to beat moments in audio time directly.
    // Uses smoothed clock so a momentary audio.currentTime stall on mobile doesn't
    // give the same "elapsed" value for multiple taps in a row.
    const latency = TUNING.beatLatencyMs || 0;
    const audioMs = getAudioClockMs();
    const heardMs = audioMs - latency;
    const nearestN = Math.round((heardMs - meta.offsetMs) / interval);
    let bestDt = Infinity, bestIdx = null;
    for (const n of [nearestN - 1, nearestN, nearestN + 1]) {
      if (n < 0) continue;
      if (state.judgedBeats.has(n)) continue;
      const beatMs = meta.offsetMs + n * interval;
      const dt = Math.abs(heardMs - beatMs);
      if (dt < bestDt) { bestDt = dt; bestIdx = n; }
    }
    if (bestIdx === null || bestDt > TUNING.goodWindowMs) {
      return { rating: 'miss', gain: TUNING.gainMiss };
    }
    state.judgedBeats.add(bestIdx);
    if (bestDt <= TUNING.perfectWindowMs) return { rating: 'perfect', gain: TUNING.gainPerfect };
    if (bestDt <= TUNING.greatWindowMs)   return { rating: 'great',   gain: TUNING.gainGreat };
    return { rating: 'good', gain: TUNING.gainGood };
  }

  // Legacy wall-clock path
  const nextIdx = state.beatIndex;
  const prevIdx = state.beatIndex - 1;
  const dtNext = Math.abs(now - state.nextBeatAt);
  const dtPrev = Math.abs(now - (state.nextBeatAt - interval));

  let bestDt = Infinity;
  let bestIdx = null;
  if (prevIdx >= 0 && !state.judgedBeats.has(prevIdx) && dtPrev < bestDt) { bestDt = dtPrev; bestIdx = prevIdx; }
  if (!state.judgedBeats.has(nextIdx) && dtNext < bestDt) { bestDt = dtNext; bestIdx = nextIdx; }

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

  // iOS Safari opportunistic: if context was suspended mid-game (silent switch,
  // memory pressure, brief interrupt) or source dropped, re-arm BGM. No-op if
  // already playing, so safe to call every tap.
  if (typeof Snd !== 'undefined' && Snd.ensurePlaying) Snd.ensurePlaying();

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

  if (window.gsap) gsap.fromTo(els.pushBtn, { scale: 0.92 }, { scale: 1, duration: 0.3, ease: 'elastic.out(1.2,0.4)', overwrite: 'auto' });

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

  // beat scheduling (paused during mash phase). scheduleNextBeat is called every
  // frame — its internal gate (`now < state.nextBeatAt`) handles the legacy path.
  // The audio-time path needs every-frame re-derivation so the gate isn't applied.
  if (!state.mashMode) {
    scheduleNextBeat(now);
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

  // Warm up the splash video during gameplay. iOS Safari often ignores
  // preload="auto" (especially on cellular / Low Power Mode), so we force a
  // muted play → immediate pause. That makes iOS fetch, decode the first
  // frame, and keep the buffer warm — by the time the user clicks YES the
  // video is ready instantly instead of stalling behind a black #scene-video
  // for up to 5s. Fire-and-forget; failures are caught by the onYes fallback.
  preloadSplashVideo();

  // Pre-start BGM so the user hears the intro and feels the tempo before the
  // 3-2-1-GO! count lands. Safe now thanks to useAudioTimeSync: the Galaxy
  // v=88 failure mode (wall-clock cycleDuration inflating during cold-start
  // warmup) is gone because updateIndicator/judgeTap both run in audio time.
  const track = Snd.gameBgmStart();
  state.currentBgmMeta = track;
  state.currentTrackId = Snd.getTrackList().findIndex(t => t.src === track.src);
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

  // Run the rhythm ring during the countdown so the user can see the tempo
  // before tapping. Stopped at beginPlay before the main loop takes over.
  startIndicatorAnimation();

  runCountdown(beginPlay);
}

// Lightweight rAF that only runs scheduleNextBeat + updateIndicator (no judging,
// no game state advancement). Used during runCountdown so the ring visualises
// the music's beat phase before tap judgment goes live.
function startIndicatorAnimation() {
  if (state.indicatorActive) return;
  state.indicatorActive = true;
  const tick = () => {
    if (!state.indicatorActive) { state.indicatorRafId = null; return; }
    const now = performance.now();
    scheduleNextBeat(now);
    updateIndicator(now);
    state.indicatorRafId = requestAnimationFrame(tick);
  };
  state.indicatorRafId = requestAnimationFrame(tick);
}
function stopIndicatorAnimation() {
  state.indicatorActive = false;
  if (state.indicatorRafId) {
    cancelAnimationFrame(state.indicatorRafId);
    state.indicatorRafId = null;
  }
}

function beginPlay() {
  // BGM already playing + now-playing set up in startGame. Audio-time sync handles
  // drift-free judgment/visuals, so beginPlay just flips running=true.
  stopIndicatorAnimation(); // hand off to the main loop, no double-tick
  updateRectCache();
  state.startAt = performance.now();
  state.beatIndex = -1;
  state.running = true;
  state.lastTapAt = 0;
  scheduleNextBeat(state.startAt);
  cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(loop);
}

// READY?/GO!! countdown locked to audio beats. BGM is already playing (see
// startGame), so we land READY? on the next available beat (≥100ms ahead so
// it's visible) and GO!! 2 beats later. User hears the beat the moment READY?
// appears — minimal wait while still feeling rhythm. Falls back to wall-clock
// if audio fails to advance within 2s.
function runCountdown(onDone) {
  const overlay = els.countdownOverlay;
  const numEl = els.countdownNum;
  if (!overlay || !numEl) { onDone(); return; }
  overlay.classList.add('show');

  const meta = state.currentBgmMeta;
  const interval = TUNING.beatIntervalMs;
  const latency = TUNING.beatLatencyMs || 0;
  const BEATS_BETWEEN = 2;

  const showStep = (text, isGo) => {
    numEl.classList.remove('pop', 'go');
    void numEl.offsetWidth;
    numEl.textContent = text;
    if (isGo) numEl.classList.add('go');
    numEl.classList.add('pop');
    Snd.playSE(isGo ? 'se2' : 'se1');
  };
  const finish = () => {
    overlay.classList.remove('show');
    onDone();
  };

  const fallbackWallCount = () => {
    showStep('READY?', false);
    setTimeout(() => {
      showStep('GO!!', true);
      setTimeout(finish, 200);
    }, (interval || 460) * BEATS_BETWEEN);
  };

  if (!meta || !interval) { fallbackWallCount(); return; }

  const pollStart = performance.now();
  const waitReady = () => {
    const elapsed = performance.now() - pollStart;
    const audioMs = Snd.bgmCurrentTime() * 1000;
    // Just need audio to be advancing — don't wait for past-first-beat anymore
    // (that added unnecessary 1+ beat of dead intro time before READY? appeared).
    if (audioMs < 30) {
      if (elapsed > 2000) { fallbackWallCount(); return; }
      requestAnimationFrame(waitReady);
      return;
    }
    // READY? on the earliest beat at least 100ms ahead. With audio starting
    // near 0, this lands on beat #0 (= offsetMs, the first downbeat) for short
    // offsets, or skips ahead one beat for longer offsets / late-polled cases.
    const minReadyMs = audioMs + 100;
    const readyBeatN = Math.max(0, Math.ceil((minReadyMs - meta.offsetMs) / interval));
    const beats = [
      { audioMs: meta.offsetMs + readyBeatN * interval,                   text: 'READY?', go: false },
      { audioMs: meta.offsetMs + (readyBeatN + BEATS_BETWEEN) * interval, text: 'GO!!',   go: true  },
    ];
    let i = 0;
    const tick = () => {
      if (i >= beats.length) { setTimeout(finish, 200); return; }
      const cur = Snd.bgmCurrentTime() * 1000;
      const b = beats[i];
      if (cur >= b.audioMs + latency) {
        showStep(b.text, b.go);
        i++;
      }
      requestAnimationFrame(tick);
    };
    tick();
  };
  waitReady();
}

let cleared = false;
function triggerClear() {
  if (cleared) return;
  cleared = true;
  state.running = false;
  state.clearTime = state.elapsedSec || ((performance.now() - state.startAt) / 1000);
  state.finalScore = computeFinalScore();
  // Fire-and-forget ranking submission so the network round-trip overlaps
  // with the clear → video → CTA animation window. Result is picked up later
  // in renderCTAScore via state.rankingPromise.
  state.rankingPromise = submitScore();
  state.rankingResult = null;
  // Capture the result so renderCTAScore can read it synchronously if the
  // network resolved before the scoreboard animation catches up.
  state.rankingPromise.then(r => { state.rankingResult = r; }).catch(() => {});
  cancelAnimationFrame(state.rafId);
  stopIndicatorAnimation(); // safety: kill countdown rAF if it somehow leaked
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

/* ============================================================
   Ranking — submit + panel + name input
   Backend: Cloudflare Workers + KV (see LP/game-api/)
   Fire-and-forget POST in triggerClear so the network round-trip
   overlaps with the clear/video/CTA animation (~6-8s) and the
   result is ready by the time the CTA panel needs it.
   ============================================================ */
async function submitScore() {
  // state.taps already includes mash-phase taps (handleTap increments it before
  // dispatching to doMashTap), but perfect/great/good/miss counters are NOT
  // incremented during mash. Without compensation the server rejects us with
  // counts_do_not_sum. maxCombo is also bumped to mashCount(=mashTarget 30)
  // during mash, so we need hits >= maxCombo. Solution: attribute mashCount
  // taps to greatCount for the payload only — state itself stays untouched
  // so HUD / CTA scoreboard keep showing the real numbers. Also clamp
  // hitScore because combo-multiplied runningScore can exceed the server's
  // per-tap cap (200).
  const mashTaps = state.mashCount | 0;
  const tapsTotal = state.taps | 0; // already includes mashTaps
  const HIT_SCORE_PER_TAP_CAP = 200; // must match SANITY.hitScorePerTap in game-api/src/index.js
  const hitScore = Math.min(state.runningScore | 0, HIT_SCORE_PER_TAP_CAP * tapsTotal);
  const payload = {
    version: GAME_VERSION,
    trackId: (state.currentTrackId != null && state.currentTrackId >= 0) ? state.currentTrackId : null,
    stats: {
      taps: tapsTotal,
      clearTime: Number(state.rhythmClearSec || state.clearTime || 0),
      maxCombo: state.maxCombo | 0,
      perfectCount: state.perfectCount | 0,
      greatCount: (state.greatCount | 0) + mashTaps,
      goodCount: state.goodCount | 0,
      missCount: state.missCount | 0,
      hitScore,
      decayTotal: Number(state.decayTotal || 0),
    },
  };
  try {
    const res = await fetch(RANKING_API + '/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      try {
        const err = await res.json();
        console.warn('[ranking] submit rejected', res.status, err);
      } catch { console.warn('[ranking] submit rejected', res.status); }
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[ranking] submit failed', e);
    return null;
  }
}

function formatName(name) {
  if (name == null || name === '') return '---';
  return String(name);
}

function renderRankingPanel(r) {
  if (!els.ctaRanking) return;
  if (!r || !Array.isArray(r.top)) {
    if (els.rkStatus) els.rkStatus.textContent = 'ランキングに接続できません';
    els.ctaRanking.classList.add('show');
    els.ctaRanking.setAttribute('aria-hidden', 'false');
    return;
  }

  // Build top rows
  els.rkList.innerHTML = '';
  r.top.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'rk-row' + (entry.you ? ' rk-you-row' : '');
    row.innerHTML =
      '<span class="rk-pos">' + (i + 1) + '</span>' +
      '<span class="rk-name">' + formatName(entry.name) + '</span>' +
      '<span class="rk-score">' + Number(entry.score || 0).toLocaleString('en-US') + '</span>';
    els.rkList.appendChild(row);
  });

  // YOU row at bottom (only if not already in top5)
  const youInTop = r.top.some(e => e.you);
  if (!youInTop && r.you) {
    els.rkYou.innerHTML =
      '<span class="rk-pos">' + (r.you.position || '-') + '</span>' +
      '<span class="rk-name">YOU</span>' +
      '<span class="rk-score">' + Number(r.you.score || 0).toLocaleString('en-US') + '</span>';
    els.rkYou.classList.add('show');
  } else {
    els.rkYou.innerHTML = '';
    els.rkYou.classList.remove('show');
  }

  // NEW badge only when in top5
  if (els.rkNewBadge) els.rkNewBadge.classList.toggle('show', !!r.isTop5);
  if (els.rkStatus) els.rkStatus.textContent = '';

  els.ctaRanking.classList.add('show');
  els.ctaRanking.setAttribute('aria-hidden', 'false');

  // Once ranking is shown and name input isn't pending, allow the user to
  // swipe back to the scoreboard. Wait for the slide-in transition (0.6s) to
  // finish before showing the bounce hint.
  if (!r.needsName) {
    setTimeout(() => enableCtaSwipe(), 700);
  }
}

function hideRankingPanel() {
  if (!els.ctaRanking) return;
  els.ctaRanking.classList.remove('show');
  els.ctaRanking.setAttribute('aria-hidden', 'true');
}

/* ---- CTA scoreboard ⇄ ranking carousel ---- */
const CTA_SLIDE_RANKING = 'ranking';
const CTA_SLIDE_SCOREBOARD = 'scoreboard';

function updateCtaDots(slide) {
  if (!els.ctaSlideDots) return;
  els.ctaSlideDots.querySelectorAll('.cta-dot').forEach(dot => {
    dot.classList.toggle('is-active', dot.dataset.slide === slide);
  });
}

function setCtaSlide(slide) {
  const wrap = els.ctaScoreboardWrap;
  if (!wrap || !wrap.classList.contains('swipeable')) return;
  if (slide !== CTA_SLIDE_RANKING && slide !== CTA_SLIDE_SCOREBOARD) return;
  wrap.dataset.slide = slide;
  updateCtaDots(slide);
}

let _ctaSwipeBound = false;
function enableCtaSwipe() {
  const wrap = els.ctaScoreboardWrap;
  if (!wrap) return;
  if (wrap.classList.contains('swipeable')) return; // idempotent
  wrap.classList.add('swipeable');
  wrap.dataset.slide = CTA_SLIDE_RANKING;
  if (els.ctaSlideDots) {
    els.ctaSlideDots.classList.add('show');
    els.ctaSlideDots.setAttribute('aria-hidden', 'false');
  }
  updateCtaDots(CTA_SLIDE_RANKING);

  // First-time hint: let scoreboard peek from the left, then retract.
  setTimeout(() => {
    wrap.classList.add('bounce-hint');
    setTimeout(() => wrap.classList.remove('bounce-hint'), 980);
  }, 350);

  if (_ctaSwipeBound) return; // bind pointer handlers only once
  _ctaSwipeBound = true;

  let startX = 0, startY = 0, dragging = false, pointerActive = false;
  const THRESHOLD = 40;

  const onStart = (ev) => {
    const t = ev.touches ? ev.touches[0] : ev;
    startX = t.clientX; startY = t.clientY;
    dragging = false; pointerActive = true;
  };
  const onMove = (ev) => {
    if (!pointerActive) return;
    const t = ev.touches ? ev.touches[0] : ev;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (!dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      dragging = true;
    }
    if (dragging && ev.cancelable) ev.preventDefault();
  };
  const onEnd = (ev) => {
    if (!pointerActive) return;
    pointerActive = false;
    if (!dragging) return;
    const t = ev.changedTouches ? ev.changedTouches[0] : ev;
    const dx = (t.clientX || 0) - startX;
    const current = wrap.dataset.slide;
    // scoreboard is parked off-screen to the LEFT (translateX(-110%)) when ranking
    // is active, and ranking is parked off-screen to the RIGHT when scoreboard is
    // active. So swiping RIGHT on ranking should pull scoreboard in from the left,
    // and swiping LEFT on scoreboard should pull ranking in from the right.
    if (dx > THRESHOLD && current === CTA_SLIDE_RANKING) setCtaSlide(CTA_SLIDE_SCOREBOARD);
    else if (dx < -THRESHOLD && current === CTA_SLIDE_SCOREBOARD) setCtaSlide(CTA_SLIDE_RANKING);
    dragging = false;
  };
  const onCancel = () => { pointerActive = false; dragging = false; };

  wrap.addEventListener('touchstart', onStart, { passive: true });
  wrap.addEventListener('touchmove', onMove, { passive: false });
  wrap.addEventListener('touchend', onEnd);
  wrap.addEventListener('touchcancel', onCancel);
  wrap.addEventListener('mousedown', onStart);
  wrap.addEventListener('mousemove', onMove);
  wrap.addEventListener('mouseup', onEnd);
  wrap.addEventListener('mouseleave', onCancel);

  if (els.ctaSlideDots) {
    els.ctaSlideDots.querySelectorAll('.cta-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        setCtaSlide(dot.dataset.slide);
      });
    });
  }
}

function disableCtaSwipe() {
  const wrap = els.ctaScoreboardWrap;
  if (wrap) {
    wrap.classList.remove('swipeable', 'bounce-hint');
    delete wrap.dataset.slide;
  }
  if (els.ctaSlideDots) {
    els.ctaSlideDots.classList.remove('show');
    els.ctaSlideDots.setAttribute('aria-hidden', 'true');
  }
}

function showNameInput(submissionId) {
  if (!els.nameModal) return;
  state.pendingNameSubmission = submissionId;
  if (els.nameInput) els.nameInput.value = '';
  if (els.nameError) els.nameError.textContent = '';
  if (els.nameSubmit) els.nameSubmit.disabled = false;
  els.nameModal.classList.add('show');
  els.nameModal.setAttribute('aria-hidden', 'false');
  // Focus the input on open (iOS may still not open the keyboard without a
  // direct gesture, but at least we try)
  setTimeout(() => { try { els.nameInput && els.nameInput.focus(); } catch (e) {} }, 120);
}

function hideNameInput() {
  if (!els.nameModal) return;
  els.nameModal.classList.remove('show');
  els.nameModal.setAttribute('aria-hidden', 'true');
}

async function submitName() {
  const id = state.pendingNameSubmission;
  if (!id) { hideNameInput(); return; }
  const raw = (els.nameInput && els.nameInput.value) || '';
  // Use codepoint-based slice so surrogate pairs (emoji etc.) count as 1 char,
  // matching the server's Array.from(name).length validation.
  const clipped = Array.from(raw).slice(0, 5).join('');
  const name = clipped.trim();
  if (!name) {
    if (els.nameError) els.nameError.textContent = '名前を入れてな';
    return;
  }
  if (els.nameSubmit) els.nameSubmit.disabled = true;
  try {
    const res = await fetch(RANKING_API + '/api/score/' + encodeURIComponent(id) + '/name', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      let msg = 'エラーが発生しました';
      if (res.status === 409) msg = '既に登録済みやで';
      else if (res.status === 410) msg = '他のプレイヤーに先越されたわ...';
      else if (res.status === 400) msg = '名前に使えへん文字が入ってるで';
      if (els.nameError) els.nameError.textContent = msg;
      if (els.nameSubmit) els.nameSubmit.disabled = false;
      return;
    }
    const data = await res.json();
    // Merge into current ranking result + re-render
    if (state.rankingResult) {
      state.rankingResult.top = data.top || state.rankingResult.top;
      state.rankingResult.you = data.you || state.rankingResult.you;
      state.rankingResult.needsName = false; // ensures renderRankingPanel enables swipe
    }
    state.pendingNameSubmission = null;
    hideNameInput();
    renderRankingPanel(state.rankingResult);
  } catch (e) {
    console.warn('[ranking] name submit failed', e);
    if (els.nameError) els.nameError.textContent = 'ネットワークエラー';
    if (els.nameSubmit) els.nameSubmit.disabled = false;
  }
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
  // Must stay in lock-step with server recomputeScore (game-api/src/index.js):
  //   - hitScore clamped to 200 * taps (so combo-mult runningScore can't outrun server)
  //   - mash taps are counted as 'great' for accuracyBonus (matches payload we POST,
  //     where greatCount is inflated by mashCount to satisfy counts_do_not_sum)
  // Without these, scoreboard (client total) and ranking row (server total) disagree.
  const taps = state.taps || 0;
  const HIT_SCORE_PER_TAP_CAP = 200;
  const hitScore = Math.min(state.runningScore || 0, HIT_SCORE_PER_TAP_CAP * taps);
  const target = TUNING.targetTimeSec || 16;
  const rhythmSec = state.rhythmClearSec || state.clearTime;
  const timeBonus = rhythmSec <= target
    ? 5000 + Math.round((target - rhythmSec) * 1500)
    : Math.max(0, Math.round((target + 5 - rhythmSec) * 1000));
  const greatForScore = (state.greatCount || 0) + (state.mashCount || 0);
  const accuracyBonus = (state.perfectCount || 0) * 400 + greatForScore * 150;
  const comboBonus = (state.maxCombo || 0) * 200;
  const noMissBonus = (state.missCount || 0) === 0 ? 3000 : 0;
  const decayPenalty = Math.round((state.decayTotal || 0) * 40);
  const optimalTaps = 29;
  const efficiencyFactor = Math.max(
    0.3,
    Math.min(1.0, optimalTaps / Math.max(taps || optimalTaps, optimalTaps))
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
  hideRankingPanel();
  hideNameInput();
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

  // Ranking panel slides in after rank badge. If the fetch is still in flight,
  // show as soon as it resolves. On network failure renderRankingPanel shows a
  // connect-error status.
  const RANKING_SHOW_DELAY = delays.rank + 900;
  const showRanking = () => {
    if (!state.rankingResult && !state.rankingPromise) {
      renderRankingPanel(null);
      return;
    }
    if (state.rankingResult) {
      renderRankingPanel(state.rankingResult);
      if (state.rankingResult.needsName) showNameInput(state.rankingResult.submissionId);
      return;
    }
    // Still in flight — wait for promise
    state.rankingPromise.then(r => {
      state.rankingResult = r;
      renderRankingPanel(r);
      if (r && r.needsName) showNameInput(r.submissionId);
    });
  };
  setTimeout(showRanking, RANKING_SHOW_DELAY);
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

// Muted play+pause trick: forces iOS Safari to decode the first frame and
// keep the media buffered, so onYes() can resume playback instantly. Called
// from startGame() so we get the full game duration (~15s+) as headroom.
let _splashVideoWarmed = false;
async function preloadSplashVideo() {
  const v = els.splashVideo;
  if (!v || _splashVideoWarmed) return;
  if (v.readyState >= 3) { _splashVideoWarmed = true; return; } // HAVE_FUTURE_DATA
  try {
    v.muted = true;
    v.playsInline = true;
    try { v.load(); } catch (e) {}
    const p = v.play();
    if (p && typeof p.then === 'function') {
      await p;
      v.pause();
      try { v.currentTime = 0; } catch (e) {}
      _splashVideoWarmed = true;
    }
  } catch (e) {
    // Autoplay rejected — onYes() still has its 700ms skip-to-CTA fallback.
  }
}

function onYes() {
  Snd.playSE('se3');
  const v = els.splashVideo;
  try { v.currentTime = 0; } catch(e){}

  let done = false;
  const goToCTA = () => {
    if (done) return;
    done = true;
    try { v.pause(); } catch(e){}
    showScene('cta');
    renderCTAScore();
    Snd.ctaBgmStart();
  };

  // Defer showing scene-video until playback actually starts. iPhone Safari can
  // take seconds to begin playback (preload=auto is only a hint), during which
  // time the user would see scene-video's #000 background. If playback doesn't
  // start within VIDEO_WAIT_MS we skip the video entirely and go to CTA so the
  // user never stares at a black screen.
  const VIDEO_WAIT_MS = 700;
  let shown = false;
  const onPlaying = () => {
    v.removeEventListener('playing', onPlaying);
    if (!shown && !done) { shown = true; showScene('video'); }
  };
  v.addEventListener('playing', onPlaying);
  v.onended = goToCTA;

  const p = v.play();
  if (p && typeof p.catch === 'function') p.catch(goToCTA);

  // If playback hasn't kicked in quickly, skip the video.
  setTimeout(() => {
    if (!shown && !done) {
      v.removeEventListener('playing', onPlaying);
      goToCTA();
    }
  }, VIDEO_WAIT_MS);

  // Safety net: if the 'ended' event never fires (e.g. stuck decode), bail.
  setTimeout(() => {
    if (!done && els.scenes.video.classList.contains('active') &&
        (v.paused || v.ended || v.readyState < 2)) {
      goToCTA();
    }
  }, 5000);
}

function onNo(ev) {
  const b = ev.currentTarget;
  b.classList.remove('shake'); void b.offsetWidth;
  b.classList.add('shake');
  doShake(5);
}

/* ---------- Debug: Song picker (5連タップで起動) ---------- */
const SONG_PICKER_KEY = 'kyomuusa_force_track';
const SONG_PICKER_TAP_WINDOW = 1500; // 前タップから1.5秒以内で連続判定
const SONG_PICKER_REQUIRED = 5;
const songTapTimes = [];

function getForcedTrackIdx() {
  try {
    const v = localStorage.getItem(SONG_PICKER_KEY);
    if (v === null || v === '') return null;
    const idx = parseInt(v, 10);
    return isNaN(idx) ? null : idx;
  } catch (e) { return null; }
}
function setForcedTrackIdx(idx) {
  try {
    if (idx === null || idx === undefined) localStorage.removeItem(SONG_PICKER_KEY);
    else localStorage.setItem(SONG_PICKER_KEY, String(idx));
  } catch (e) {}
}
function buildSongPicker() {
  if (!els.songPickerList) return;
  const list = Snd.getTrackList();
  const current = getForcedTrackIdx();
  const items = [
    { idx: null, label: 'RANDOM', tag: 'default' },
    ...list.map((t, i) => ({ idx: i, label: t.title, tag: 'BPM ' + t.bpm })),
  ];
  els.songPickerList.innerHTML = '';
  items.forEach((it) => {
    const btn = document.createElement('button');
    btn.className = 'song-picker-btn' + ((current === it.idx || (current === null && it.idx === null)) ? ' selected' : '');
    btn.innerHTML = '<span class="sp-label">' + it.label + '</span><span class="sp-tag">' + it.tag + '</span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setForcedTrackIdx(it.idx);
      buildSongPicker();
      closeSongPicker();
    });
    els.songPickerList.appendChild(btn);
  });
}
function openSongPicker() {
  if (!els.songPicker) return;
  buildSongPicker();
  if (els.songPickerVersion) {
    const ctxState = (Snd.getCtxState && Snd.getCtxState()) || 'none';
    const bgmInfo = (Snd.getBgmState && Snd.getBgmState()) || '';
    const session = (Snd.getAudioSessionType && Snd.getAudioSessionType()) || 'n/a';
    els.songPickerVersion.textContent = GAME_VERSION + ' / ctx: ' + ctxState + ' / sess: ' + session + (bgmInfo ? ' / ' + bgmInfo : '');
  }
  els.songPicker.classList.add('show');
  els.songPicker.setAttribute('aria-hidden', 'false');
}
function closeSongPicker() {
  if (!els.songPicker) return;
  els.songPicker.classList.remove('show');
  els.songPicker.setAttribute('aria-hidden', 'true');
}
function handleTitleTap(ev) {
  if (!els.scenes.title || !els.scenes.title.classList.contains('active')) return;
  if (els.songPicker && els.songPicker.classList.contains('show')) return;
  // 除外: GAME START / sound toggle / picker自身
  if (ev.target && ev.target.closest && ev.target.closest('.start-btn, .sound-toggle, .song-picker')) return;
  const now = performance.now();
  // 窓切れ判定
  if (songTapTimes.length && now - songTapTimes[songTapTimes.length - 1] > SONG_PICKER_TAP_WINDOW) {
    songTapTimes.length = 0;
  }
  songTapTimes.push(now);
  if (songTapTimes.length >= SONG_PICKER_REQUIRED) {
    songTapTimes.length = 0;
    openSongPicker();
  }
}

/* ---------- Wire up ---------- */
function bind() {
  // Title BGM is swapped to game BGM inside startGame (Snd reuses a single Audio
  // element now, so the swap is fast and reliable). SE3 masks the brief cut.
  const startFn = (e) => { e && e.preventDefault && e.preventDefault(); Snd.resume(); Snd.playSE('se3', 0.21); startGame(); };
  const on = (el, ev, fn, opts) => { if (el) el.addEventListener(ev, fn, opts); };
  on(els.startBtn, 'click', startFn);
  on(els.startBtn, 'touchstart', startFn, { passive: false });

  on(els.pushBtn, 'touchstart', handleTap, { passive: false });
  on(els.pushBtn, 'mousedown', handleTap);
  on(els.pushBtn, 'contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => { if (e.code==='Space' && state.running) { e.preventDefault(); handleTap(e); } });

  // Whole-screen tap → PUSH (skip interactive UI like sound toggle / push-btn itself).
  // push-btn is excluded so its own handler stays the source of truth (avoids double-fire).
  const sceneTap = (ev) => {
    if (!state.running) return;
    if (ev.target && ev.target.closest && ev.target.closest('.sound-toggle, .push-btn, .now-playing, .gauge-container')) return;
    handleTap(ev);
  };
  on(els.scenes.game, 'touchstart', sceneTap, { passive: false });
  on(els.scenes.game, 'mousedown', sceneTap);

  on(els.yesBtn, 'click', onYes);
  on(els.noBtn, 'click', onNo);
  on(els.shareX, 'click', shareOnX);
  on(els.shareLine, 'click', shareOnLine);
  on(els.shareThreads, 'click', shareOnThreads);
  on(els.shareCopy, 'click', shareCopy);
  on(els.retryBtn, 'click', () => {
    cleared = false;
    state.running = false;
    state.rankingResult = null;
    state.rankingPromise = null;
    state.pendingNameSubmission = null;
    hideRankingPanel();
    hideNameInput();
    disableCtaSwipe();
    Snd.titleBgmStart();
    showScene('title');
    animateTitle();
    typeTagline();
  });

  // Ranking name input modal
  on(els.nameSubmit, 'click', (e) => { e.preventDefault(); submitName(); });
  on(els.nameSkip, 'click', (e) => {
    e.preventDefault();
    state.pendingNameSubmission = null;
    if (state.rankingResult) state.rankingResult.needsName = false;
    hideNameInput();
    // User opted out of name entry — let them swipe between panels anyway.
    setTimeout(() => enableCtaSwipe(), 250);
  });
  on(els.nameInput, 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitName(); }
  });

  on(els.soundBtn, 'click', (e) => {
    e && e.preventDefault && e.preventDefault();
    Snd.resume();
    Snd.toggle();
    updateSoundBtn();
    if (els.scenes.title.classList.contains('active')) Snd.titleBgmStart();
    else Snd.retryBgm();
  });

  // Title BGM bootstrap. Skips when the gesture is on GAME START — startFn
  // already handles BGM via gameBgmStart there, and stomping with titleBgmStart
  // would destroy the freshly-created game Audio (mobile pointerdown fires
  // AFTER touchstart; capture-phase pointerdown would override the game BGM
  // initiated in touchstart).
  let firstGestureFired = false;
  const firstGesture = (ev) => {
    if (firstGestureFired) return;
    if (ev && ev.target && ev.target.closest && ev.target.closest('.start-btn')) {
      // Don't consume — game BGM pipeline owns this gesture
      return;
    }
    firstGestureFired = true;
    // iOS Safari: play a silent buffer synchronously inside this gesture handler
    // to fully unlock AudioContext. Without this, source.start() called later
    // from decodeAudioData.then() is silent on iPhone even though the context
    // is technically 'running' — the gesture context has expired.
    if (Snd.unlockAudio) Snd.unlockAudio();
    // Kick off all BGM + SE decodes in parallel so GAME START / CTA switches
    // are instant and taps make sound the moment judgment fires.
    if (Snd.bgmPreload) Snd.bgmPreload();
    if (Snd.seLoad) Snd.seLoad();
    if (els.scenes.title.classList.contains('active')) Snd.titleBgmStart();
    else Snd.retryBgm();
  };
  document.addEventListener('pointerdown', firstGesture, { capture: true });
  document.addEventListener('keydown', firstGesture, { capture: true });

  // iOS: audio context often suspends when page goes to background (tab switch,
  // phone call, silent switch). When visibility returns, resume + restart BGM
  // so users don't come back to a silent game.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Snd.ensurePlaying) Snd.ensurePlaying();
  });

  // Debug: 5連タップで曲選択
  on(els.scenes.title, 'pointerdown', handleTitleTap);
  on(els.songPickerClose, 'click', (e) => { e.preventDefault(); closeSongPicker(); });
  // 背景タップで閉じない（CLOSEボタンのみで閉じる）
  on(els.songPicker, 'pointerdown', (e) => { e.stopPropagation(); });
  on(els.songPicker, 'click', (e) => { e.stopPropagation(); });
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
  // Set audioSession type to 'playback' FIRST — overrides the physical silent
  // switch on iPhone (SE/8/etc. still have it; 16 Pro replaced it with Action
  // Button). Without this, Web Audio is entirely silent when the ring switch
  // is on Mute, regardless of how perfectly we unlock AudioContext. iOS 17+,
  // no-op elsewhere.
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch (e) {}
  // preload all stage GIFs
  Object.values(STAGE_GIFS).forEach(g => { new Image().src = g.src; });
  // Pre-gesture audio init: some iOS builds stabilize with ctx created early
  // (still suspended until firstGesture unlocks it). If v=101 style deferred
  // init breaks SE, this is the workaround that preserved v=100 behavior.
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
