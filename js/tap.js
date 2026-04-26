/* ============================================================
   tap.js — handleTap dispatcher, mash mode (99% → 30連打).
   ============================================================ */

import { TUNING } from './config.js';
import { state } from './state.js';
import { els, parity } from './dom.js';
import { Snd } from './sound.js';
import { judgeTap } from './rhythm.js';
import { renderGauge } from './stage.js';
import { showBadge, spawnParticles, spawnRipple, doFlash, doShake, spawnCombo } from './effects.js';
import { triggerClear } from './gameloop.js';
import { exitFever } from './fever.js';

export function handleTap(ev) {
  if (!state.running) return;
  if (ev && ev.cancelable) ev.preventDefault();
  if (ev && ev.type === 'touchstart') els.pushBtn._touched = true;
  if (ev && ev.type === 'mousedown' && els.pushBtn._touched) { els.pushBtn._touched = false; return; }

  // iOS Safari opportunistic: if context was suspended mid-game (silent switch,
  // memory pressure, brief interrupt) or source dropped, re-arm BGM. No-op if
  // already playing, so safe to call every tap.
  if (Snd && Snd.ensurePlaying) Snd.ensurePlaying();

  // Ignore overshoot taps after the 30-mash finisher so the gauge can't rebound to 99.
  // mashCount sticky guard also catches the gap right after finishMashMode flips mashMode=false.
  if (state.cleared || state.gauge >= 100 || state.mashCount >= state.mashTarget) return;

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

  // FEVER zone: 1.5x score multiplier on every non-miss tap.
  // Track per-rating fever counts so computeFinalScore can replay the bonus
  // server-side (lock-step). Without separate counters the server can't tell
  // which hits earned the multiplier, so the bonus would get clipped by the
  // hitScore cap and never materialize in the final score.
  if (state.feverActive && rating !== 'miss') {
    if (rating === 'perfect') state.feverPerfectCount++;
    else if (rating === 'great') state.feverGreatCount++;
    else if (rating === 'good') state.feverGoodCount++;
  }
  const baseRatingPts = { perfect: 300, great: 180, good: 90, miss: 0 }[rating];
  const feverMult = (state.feverActive && rating !== 'miss') ? 1.5 : 1;
  const ratingPts = baseRatingPts * feverMult;
  const comboMult = 1 + Math.min(state.combo, 30) * 0.05;
  state.runningScore += Math.round(ratingPts * comboMult);
  els.tapCount.textContent = String(state.runningScore).padStart(6, '0');

  Snd.hit(rating, { streak: state.perfectStreak });

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

  if (TUNING.flashEnabled) doFlash(rating === 'perfect' ? 0.35 : (rating === 'great' ? 0.2 : 0.1));
  if (TUNING.shakeEnabled) doShake(rating === 'perfect' ? 4 : (rating === 'great' ? 3 : 2));

  parity.pulse = !parity.pulse;
  els.gaugePulse.className = 'gauge-pulse ' + (parity.pulse ? 'pulse-a' : 'pulse-b');

  if (window.gsap) gsap.fromTo(els.pushBtn, { scale: 0.92 }, { scale: 1, duration: 0.3, ease: 'elastic.out(1.2,0.4)', overwrite: 'auto' });

  renderGauge();
  // Gauge hitting 99 arms the mash phase; a short delay lets the final tap's
  // flash/shake settle before 「猛プッシュ」overlay crashes in.
  if (state.gauge >= 99 && !state.mashMode && !state.mashPending && !state.cleared) {
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
export function enterMashMode() {
  if (state.mashMode || state.cleared) return;
  exitFever();
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

export function doMashTap() {
  // 最終防衛線: ガードをすり抜けた経路もここで遮断
  if (state.mashCount >= state.mashTarget || state.cleared) return;
  state.mashCount++;
  els.mashCount.textContent = String(state.mashCount);
  parity.mashPop = !parity.mashPop;
  els.mashCount.className = parity.mashPop ? 'pop' : 'pop-b';

  // Gauge creeps 99 → 100 proportionally to mash progress so the bar visibly fills
  state.gauge = Math.min(100, 99 + (state.mashCount / state.mashTarget));
  renderGauge();

  // Running score bonus per mash tap (contributes to final score)
  state.runningScore = (state.runningScore || 0) + 200;
  els.tapCount.textContent = String(state.runningScore).padStart(6, '0');
  state.maxCombo = Math.max(state.maxCombo || 0, state.mashCount);

  // Feedback per tap: particles + ripple + flash + shake (count halved to reduce jank)
  Snd.hit('great');
  const n = Math.round((3 + TUNING.effectIntensity * 0.55));
  spawnParticles(n);
  spawnRipple();
  if (TUNING.flashEnabled) doFlash(0.28);
  if (TUNING.shakeEnabled) doShake(3.5);

  parity.pulse = !parity.pulse;
  els.gaugePulse.className = 'gauge-pulse ' + (parity.pulse ? 'pulse-a' : 'pulse-b');

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

export function finishMashMode() {
  state.mashMode = false;
  // handleTap のstate.runningチェックで、triggerClear待ち300ms中のオーバーシュートを遮断
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
