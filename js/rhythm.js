/* ============================================================
   rhythm.js — Beat scheduler, ring indicator, tap judgment.
   ============================================================ */

import { TUNING } from './config.js';
import { state } from './state.js';
import { els } from './dom.js';
import { Snd, getAudioClockMs } from './sound.js';

/* ---------- Rhythm tick decorations ---------- */
export function buildTicks() {
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
export function scheduleNextBeat(now) {
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
    // every frame even without audio progress).
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

export function updateIndicator(now) {
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
      // Math.floor handles negative elapsed correctly (rounds toward -∞).
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

  // FEVER zone: ring switches from yellow to red-leaning hot pink (#FF3370).
  // Same RGB string used in both boxShadow stops to keep the per-frame inline
  // write idempotent (CSS transition on borderColor only fires on the flip).
  const isFever = state.feverActive;
  const glowRGB = isFever ? '255,51,112' : '255,230,0';
  if (dtMin < TUNING.greatWindowMs) {
    els.rhythmIndicator.style.boxShadow = `0 0 40px 6px rgba(${glowRGB},0.95), inset 0 0 18px rgba(${glowRGB},0.6)`;
  } else {
    els.rhythmIndicator.style.boxShadow = `0 0 16px rgba(${glowRGB},0.55), inset 0 0 12px rgba(${glowRGB},0.3)`;
  }
  els.rhythmIndicator.style.borderColor = isFever ? '#FF3370' : '#FFE600';
}

/* ---------- Tap judgment ----------
   One-judgement-per-beat: each beat index can be claimed by only one tap.
   Subsequent taps on an already-claimed beat are forced to miss, killing
   spam-tap strategies. */
export function judgeTap(now) {
  const interval = state.lastBeatInterval || TUNING.beatIntervalMs;
  const meta = state.currentBgmMeta;

  if (TUNING.useAudioTimeSync && meta) {
    // Audio-time path: compare tap moment to beat moments in audio time.
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
