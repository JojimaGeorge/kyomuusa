/* ============================================================
   fever.js — Fever phase orchestrator.
   Triggered when gauge crosses FEVER_THRESHOLD; ended when mash mode
   begins or the game clears. CSS-driven visuals via #scene-game.fever
   and the .fever-overlay element. JS only handles the one-shot
   text burst + SE; the persistent visuals are pure CSS.
   ============================================================ */

import { state } from './state.js';
import { els } from './dom.js';
import { Snd } from './sound.js';

let feverHideTimer = null;

export function enterFever() {
  // feverFired is the one-shot guard. Without it, finishMashMode() flips
  // state.mashMode back to false BEFORE triggerClear() sets state.cleared=true,
  // and the renderGauge() call inside finishMashMode would re-trigger fever
  // for ~300ms — visible as a "FEVER text leaking into FINISH" flash.
  if (state.feverActive || state.feverFired || state.cleared || state.mashMode) return;
  state.feverActive = true;
  state.feverFired = true;
  if (els.scenes && els.scenes.game) els.scenes.game.classList.add('fever');
  const overlay = els.feverOverlay;
  if (overlay) {
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    if (feverHideTimer) clearTimeout(feverHideTimer);
    feverHideTimer = setTimeout(() => {
      overlay.classList.remove('show');
      feverHideTimer = null;
    }, 1100);
  }
  if (Snd && Snd.feverStart) Snd.feverStart();
}

export function exitFever() {
  if (!state.feverActive) return;
  state.feverActive = false;
  if (els.scenes && els.scenes.game) els.scenes.game.classList.remove('fever');
  if (feverHideTimer) { clearTimeout(feverHideTimer); feverHideTimer = null; }
  if (els.feverOverlay) els.feverOverlay.classList.remove('show');
}
