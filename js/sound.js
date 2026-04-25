/* ============================================================
   sound.js — Web Audio sound manager (BGM via AudioBufferSource,
   SE via decoded buffers, procedural tones for SFX hooks).
   Also exposes a thin getAudioClockMs() wrapper used by rhythm.js.
   ============================================================ */

export const Snd = (() => {
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
  const GAME_BGM_TRACKS = [
    { src: './assets/musicA.mp3', bpm: 130.8, offsetMs: 487, title: 'Milky CasWay' },
    { src: './assets/musicB.mp3', bpm: 131,   offsetMs: 468, title: 'Parallel CasNight' },
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
  // SE migrated to Web Audio (v=100) — HTMLAudio.cloneNode() spam on rapid taps
  // was suspected to starve iOS Safari's audio resources and kill BGM mid-game.
  const seBufferCache = new Map(); // src -> AudioBuffer
  try { muted = localStorage.getItem('kyomuusa_muted') === '1'; } catch (e) {}

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
  // in async continuations (.then of decodeAudioData) silently fail on iPhone.
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
  // suspended, source ended unexpectedly, etc.), restart. Safe to call liberally.
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
    // Unmuting: ALWAYS force-restart BGM. iOS zombie source — a source created
    // while ctx was suspended plays silently forever even after ctx resumes.
    if (!m && bgmIntendedSrc) {
      const src = bgmIntendedSrc;
      setTimeout(() => { if (bgmIntendedSrc === src) startBGM(src); }, 0);
    }
  };
  const toggle = () => { setMute(!muted); return muted; };
  const isMuted = () => muted;

  /* ---- SE buffer load + playback ---- */
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
  const seLoad = () => Promise.all(
    Object.values(SE_FILES).map(def => loadSeBuffer(def.src).catch(() => null))
  );
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

  /* ---- Procedural SFX (count beep, hit feedback, finish chord) ---- */
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
  // Pitch sweep: チュイーン↑系の上昇音作成用。fromFreq→toFreq を sweepDur 秒で
  // 指数カーブ補間し、totalDur 秒で減衰。指数ランプは0より大きい必要があるので
  // fromFreq/toFreq は両方>0で渡すこと。
  const sweep = ({ fromFreq = 440, toFreq = 3520, type = 'sawtooth', sweepDur = 0.10, dur = 0.40, gain = 0.18, attack = 0.005, when = 0 }) => {
    const c = ensure(); if (!c || muted) return;
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(fromFreq, t0);
    o.frequency.exponentialRampToValueAtTime(toFreq, t0 + sweepDur);
    o.connect(g); g.connect(master);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0); o.stop(t0 + dur + 0.03);
  };

  const tap = () => { resume(); tone({ freq: 880, type: 'square', dur: 0.05, gain: 0.06 }); };

  // ---- PERFECT SE candidates ----
  // 切替: localStorage.setItem('kyomuusa_perfect_se', 'A'..'E') または ?se=B URL param
  // 試聴: コンソールで Snd.previewPerfect('B')
  const PERFECT_SE_VARIANTS = {
    // A: 現行のベルトライアド（C6 + G6 + C7）
    A: () => {
      tone({ freq: 1047, type: 'sine',     dur: 0.2,  gain: 0.18 });
      tone({ freq: 1568, type: 'sine',     dur: 0.24, gain: 0.12, when: 0.03 });
      tone({ freq: 2093, type: 'triangle', dur: 0.28, gain: 0.08, when: 0.06 });
    },
    // B: 上昇キラキラ（E6→A6→D7→F7 アルペジオ + 高域シマー）
    B: () => {
      tone({ freq: 1319, type: 'sine',     dur: 0.10, gain: 0.14, when: 0.00 });
      tone({ freq: 1760, type: 'sine',     dur: 0.10, gain: 0.14, when: 0.05 });
      tone({ freq: 2349, type: 'sine',     dur: 0.12, gain: 0.13, when: 0.10 });
      tone({ freq: 2794, type: 'triangle', dur: 0.18, gain: 0.10, when: 0.15 });
      noise({ dur: 0.20, gain: 0.04, filterFreq: 6000, when: 0.05 });
    },
    // C: コインゲット風（E6→E7 速い2音上昇、マリオ系）
    C: () => {
      tone({ freq: 1319, type: 'square', dur: 0.07, gain: 0.16, when: 0.00 });
      tone({ freq: 2637, type: 'square', dur: 0.18, gain: 0.18, when: 0.07 });
    },
    // D: メジャーチャイム（C6+E6+G6+C7 = Cメジャー和音、豊かで明るい）
    D: () => {
      tone({ freq: 1047, type: 'sine',     dur: 0.45, gain: 0.16, when: 0.00 });
      tone({ freq: 1319, type: 'sine',     dur: 0.45, gain: 0.13, when: 0.02 });
      tone({ freq: 1568, type: 'sine',     dur: 0.45, gain: 0.11, when: 0.04 });
      tone({ freq: 2093, type: 'sine',     dur: 0.50, gain: 0.08, when: 0.06 });
    },
    // E: パワーパンチ（C5低音 + C7高音 stack + 短ノイズ、打撃インパクト系）
    E: () => {
      tone({ freq: 523,  type: 'sawtooth', dur: 0.10, gain: 0.16, when: 0.00 });
      tone({ freq: 2093, type: 'square',   dur: 0.08, gain: 0.14, when: 0.00 });
      noise({ dur: 0.06, gain: 0.10, filterFreq: 3000, when: 0.00 });
    },
    // F: チュイーン↑（440→3520Hz急上昇sweep + 上で持続、王道パーフェクト感）
    F: () => {
      sweep({ fromFreq: 440,  toFreq: 3520, type: 'sawtooth', sweepDur: 0.10, dur: 0.45, gain: 0.20 });
      tone({  freq: 5274,     type: 'triangle',                              dur: 0.30, gain: 0.10, when: 0.10 });
      noise({ dur: 0.05, gain: 0.08, filterFreq: 6000 });
    },
    // G: ドン!→キュイーン↑（低音ドン + 上昇sweep + 高音tail、インパクト+チュイーン）
    G: () => {
      tone({  freq: 110,      type: 'square',                                dur: 0.08, gain: 0.22, when: 0.00 });
      noise({ dur: 0.06, gain: 0.14, filterFreq: 800 });
      sweep({ fromFreq: 880,  toFreq: 4400, type: 'sawtooth', sweepDur: 0.10, dur: 0.40, gain: 0.18, when: 0.02 });
      tone({  freq: 4186,     type: 'sine',                                  dur: 0.25, gain: 0.10, when: 0.20 });
    },
    // H: 金属チュイーン（detune重ねでうなり感、刺さる金属系）
    H: () => {
      sweep({ fromFreq: 1320, toFreq: 2637, type: 'square',   sweepDur: 0.08, dur: 0.50, gain: 0.16 });
      sweep({ fromFreq: 1325, toFreq: 2642, type: 'square',   sweepDur: 0.08, dur: 0.50, gain: 0.12, when: 0.005 });
      tone({  freq: 5274,     type: 'sine',                                  dur: 0.30, gain: 0.10, when: 0.06 });
    },
    // I: スーパーヒット（ノイズ衝撃 + sweep + 鐘 + sparkle 多重ヒット）
    I: () => {
      noise({ dur: 0.04, gain: 0.14, filterFreq: 3000 });
      sweep({ fromFreq: 600,  toFreq: 2400, type: 'sawtooth', sweepDur: 0.06, dur: 0.20, gain: 0.18 });
      tone({  freq: 2637,     type: 'sine',                                  dur: 0.35, gain: 0.16, when: 0.03 });
      tone({  freq: 5274,     type: 'triangle',                              dur: 0.25, gain: 0.12, when: 0.10 });
      tone({  freq: 3136,     type: 'sine',                                  dur: 0.40, gain: 0.10, when: 0.06 });
    },
  };
  const getPerfectSeKey = () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = (params.get('se') || '').toUpperCase();
      if (PERFECT_SE_VARIANTS[fromUrl]) return fromUrl;
      const fromLs = (localStorage.getItem('kyomuusa_perfect_se') || '').toUpperCase();
      if (PERFECT_SE_VARIANTS[fromLs]) return fromLs;
    } catch (e) {}
    return 'A';
  };
  const previewPerfect = (key) => {
    resume();
    const k = (key || '').toUpperCase();
    const fn = PERFECT_SE_VARIANTS[k] || PERFECT_SE_VARIANTS.A;
    fn();
  };

  const hit = (rating) => {
    resume();
    if (rating === 'perfect') {
      const fn = PERFECT_SE_VARIANTS[getPerfectSeKey()] || PERFECT_SE_VARIANTS.A;
      fn();
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

  /* ---- BGM buffer load + playback ---- */
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
  const bgmPreload = () => {
    const allSrcs = [TITLE_BGM, CTA_BGM, ...GAME_BGM_TRACKS.map(t => t.src)];
    return Promise.all(allSrcs.map(s => loadBgmBuffer(s).catch(() => null)));
  };
  const teardownBgmSource = () => {
    if (bgmFadeStopTimer) { clearTimeout(bgmFadeStopTimer); bgmFadeStopTimer = null; }
    if (bgmSource) {
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
    // Self-healing: if iOS silently ends our source, restart it. Multiple guards
    // to prevent restart cascades on iPhone SE: _intentionallyStopped flag,
    // ctx.state running check, 500ms rate-limit.
    source.onended = () => {
      if (source._intentionallyStopped) return;
      if (bgmIntendedSrc !== src || bgmSource !== source) return;
      bgmSource = null;
      if (!ctx || ctx.state !== 'running') return;
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
    bgmIntendedSrc = src;
    teardownBgmSource();
    const cached = bgmBufferCache.get(src);
    if (cached) {
      playBufferLoop(c, src, cached);
      return;
    }
    // Async load + play. Race guard for concurrent startBGM calls.
    const tokenSrc = src;
    loadBgmBuffer(src).then((buf) => {
      if (!buf) return;
      if (bgmIntendedSrc !== tokenSrc) return;
      if (bgmSource || bgmCurrentSrc) return;
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
    try { bgmSource.stop(endAt + 0.05); } catch (e) {}
    const srcRef = bgmSource;
    bgmFadeStopTimer = setTimeout(() => {
      bgmFadeStopTimer = null;
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
  // AudioContext-derived playback position (seconds). Sample-accurate and monotonic.
  const bgmCurrentTime = () => {
    if (!ctx || !bgmSource || !bgmBufferDuration) return 0;
    const elapsed = ctx.currentTime - bgmStartCtxTime;
    if (elapsed < 0) return 0;
    return elapsed % bgmBufferDuration;
  };
  const retryBgm = () => {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  };

  return {
    tap, hit, countBeep, finish,
    titleBgmStart, gameBgmStart, ctaBgmStart, bgmStop, fadeOutBGM,
    retryBgm, bgmCurrentTime, bgmPreload,
    toggle, setMute, isMuted, resume,
    seLoad, playSE, getTrackList,
    unlockAudio, ensurePlaying,
    getCtxState, getBgmState, getAudioSessionType,
    previewPerfect,
  };
})();

/* ---------- Audio clock (Web Audio AudioContext-derived, v=98+) ----------
   Snd.bgmCurrentTime() returns AudioContext-derived time (sample-accurate,
   monotonic). This thin wrapper is kept as a choke point in case per-device
   correction becomes needed later. */
export function getAudioClockMs() {
  return Snd.bgmCurrentTime() * 1000;
}
