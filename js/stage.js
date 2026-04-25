/* ============================================================
   stage.js — Gauge HUD update + GIF stage state machine.
   ============================================================ */

import { STAGE_GIFS } from './config.js';
import { state } from './state.js';
import { els } from './dom.js';

/* ---------- Gauge ---------- */
export function renderGauge() {
  const pct = Math.max(0, Math.min(100, state.gauge));
  els.gaugeFill.style.transform = `scaleX(${pct/100})`;
  els.gaugeFillStripes.style.clipPath = `inset(0 ${100-pct}% 0 0)`;
  els.gaugeNum.textContent = Math.floor(pct) + '%';
  // Progressive hype stage: A → B → C → D → E. Never reverses.
  // A→B: queue待ちだとAループ終端まで最大2.8s遅延し実視で~40%まで上がってから切替に
  // 見える。25%で即座にBへ切替（gifAdvanceTimerはsetGifStage内でクリアされる）。
  if (pct >= 25 && state.gifStage === 'A') {
    setGifStage('B');
  } else if (pct >= 60 && state.gifStage === 'C' && !state.gifPendingAdvance) {
    queueGifAdvance('D');
  }
}

/* ---------- Rabbit GIF stage manager ----------
   Double-buffered: load the new GIF into the inactive <img>, await decode(),
   reveal it on top of the current one, then hide the old one one frame later.
   This keeps a frame visible at all times — no blank gap during decode. */
export async function setGifStage(key) {
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

export function queueGifAdvance(nextKey) {
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
