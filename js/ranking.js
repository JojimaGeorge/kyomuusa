/* ============================================================
   ranking.js — Cloudflare Workers ranking integration:
   submitScore, render top5/YOU panel, name input modal,
   scoreboard⇄ranking swipe carousel.
   ============================================================ */

import { GAME_VERSION, RANKING_API } from './config.js';
import { state } from './state.js';
import { els } from './dom.js';

/* Fire-and-forget POST in triggerClear so the network round-trip overlaps
   with the clear/video/CTA animation (~6-8s) and the result is ready by
   the time the CTA panel needs it. */
export async function submitScore() {
  // state.taps already includes mash-phase taps (handleTap increments it before
  // dispatching to doMashTap), but perfect/great/good/miss counters are NOT
  // incremented during mash. Without compensation the server rejects with
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

export function formatName(name) {
  if (name == null || name === '') return '---';
  return String(name);
}

export function renderRankingPanel(r) {
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

export function hideRankingPanel() {
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

let ctaSwipeBound = false;
export function enableCtaSwipe() {
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

  if (ctaSwipeBound) return; // bind pointer handlers only once
  ctaSwipeBound = true;

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
    // active. So swiping RIGHT on ranking pulls scoreboard in from the left,
    // and swiping LEFT on scoreboard pulls ranking in from the right.
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

export function disableCtaSwipe() {
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

/* ---- Name input modal ---- */
export function showNameInput(submissionId) {
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

export function hideNameInput() {
  if (!els.nameModal) return;
  els.nameModal.classList.remove('show');
  els.nameModal.setAttribute('aria-hidden', 'true');
}

export async function submitName() {
  const id = state.pendingNameSubmission;
  if (!id) { hideNameInput(); return; }
  const raw = (els.nameInput && els.nameInput.value) || '';
  // Codepoint-based slice so surrogate pairs (emoji) count as 1 char,
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
