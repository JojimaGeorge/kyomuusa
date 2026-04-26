/* ============================================================
   gameloop.js — Main rAF loop, scene start/clear flow, countdown.
   ============================================================ */

import { TUNING, CLEAR_F_PLAY_MS, STAGE_GIFS } from './config.js';
import { state } from './state.js';
import { els, showScene, updateRectCache } from './dom.js';
import { Snd } from './sound.js';
import { scheduleNextBeat, updateIndicator } from './rhythm.js';
import { renderGauge, setGifStage } from './stage.js';
import { doFlash } from './effects.js';
import { computeFinalScore, showClearSequence } from './score.js';
import { submitScore } from './ranking.js';
import { exitFever } from './fever.js';

/* ---------- Main rAF ---------- */
export function loop() {
  if (!state.running) return;
  const now = performance.now();
  const elapsedSec = (now - state.startAt) / 1000;
  els.timer.textContent = elapsedSec.toFixed(1) + 's';
  state.elapsedSec = elapsedSec;

  // beat scheduling (paused during mash phase). scheduleNextBeat is called every
  // frame — the legacy path's internal gate handles redundant calls; the
  // audio-time path needs every-frame re-derivation so the gate isn't applied.
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
export function startGame() {
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
  els.scenes.game.classList.remove('fever');
  els.pushBtn.classList.remove('mash-pulse');
  if (els.mashOverlay) els.mashOverlay.classList.remove('show');
  if (els.feverOverlay) els.feverOverlay.classList.remove('show');
  if (els.mashCount) els.mashCount.textContent = '0';
  state.cleared = false;
  state.feverActive = false;
  state.feverFired = false;
  setGifStage('A');
  renderGauge();
  els.tapCount.textContent = '000000';
  els.timer.textContent = '0.0s';
  if (els.finishOverlay) els.finishOverlay.classList.remove('show');
  els.scenes.game.classList.remove('finishing');
  if (els.nowPlaying) els.nowPlaying.innerHTML = '';
  Snd.resume();

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

/* Lightweight rAF that only runs scheduleNextBeat + updateIndicator (no
   judging, no game state advancement). Used during runCountdown so the ring
   visualises the music's beat phase before tap judgment goes live. */
export function startIndicatorAnimation() {
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

export function stopIndicatorAnimation() {
  state.indicatorActive = false;
  if (state.indicatorRafId) {
    cancelAnimationFrame(state.indicatorRafId);
    state.indicatorRafId = null;
  }
}

export function beginPlay() {
  // BGM already playing + now-playing set up in startGame. Audio-time sync
  // handles drift-free judgment/visuals, so beginPlay just flips running=true.
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

/* READY?/GO!! countdown locked to audio beats. BGM is already playing (see
   startGame), so we land READY? on the next available beat (≥100ms ahead so
   it's visible) and GO!! 2 beats later. Falls back to wall-clock if audio
   fails to advance within 2s. */
export function runCountdown(onDone) {
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
    // near 0, this lands on beat #0 (= offsetMs, the first downbeat).
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

export function triggerClear() {
  if (state.cleared) return;
  state.cleared = true;
  state.running = false;
  exitFever();
  state.clearTime = state.elapsedSec || ((performance.now() - state.startAt) / 1000);
  state.finalScore = computeFinalScore();
  // Fire-and-forget ranking submission so the network round-trip overlaps
  // with the clear → video → CTA animation window.
  state.rankingPromise = submitScore();
  state.rankingResult = null;
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

export function showFinishOverlay() {
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
