/* ============================================================
   notes.js — 太鼓型ノーツレーン: スポーン / 移動 / 判定 (v=136)

   責務:
   - chart.notes 配列を元に DOM ノーツ要素を生成 (spawn)
   - 毎フレーム X 座標を更新 (右→判定線方向に移動)
   - missWindow 超過ノーツを自動除去
   - findBestNote(): rhythm.js の judgeTap から呼ばれ、最近傍未判定ノーツを返す
   - doMashNoteHit(): mash ノーツへの連打カウント加算

   設計方針:
   - クロックソース: getAudioClockMs() = AudioContext.currentTime ベース
     (HTMLAudioElement.currentTime は使わない: feedback_audio_currentTime_mobile_drift)
   - DOM 操作: note-lane#note-lane に動的追加、ゲーム終了時に一括除去
   - getBoundingClientRect: beginPlay 時にキャッシュ、resize で更新
     (feedback_bounding_rect_cache)
   ============================================================ */

import { TUNING, GOOD_ICONS } from './config.js';
import { state } from './state.js';
import { getAudioClockMs } from './sound.js';

/* ---------- 定数 ---------- */
const NOTE_TRAVEL_MS = 2000;   // 右端→判定線の移動時間 (ms)
const JUDGE_X_RATIO  = 0.25;   // 判定線の左端からの比率 (25%)
const MISS_WINDOW_MS = 350;    // この ms を過ぎたら強制 miss 除去
const MASH_WIDTH_PX_PER_MS = 0.06; // mash ノーツの幅 (px/ms)

/* ---------- レーン要素キャッシュ ---------- */
let laneDomEl   = null;   // #note-lane
let laneWidth   = 0;      // レーンの pixel 幅 (resize でリフレッシュ)
let judgeX      = 0;      // 判定線の pixel X 位置 (= laneWidth * JUDGE_X_RATIO)

/** beginPlay / resize 時に呼ぶ。getBoundingClientRect キャッシュを更新。 */
export function updateLaneRect() {
  if (!laneDomEl) laneDomEl = document.getElementById('note-lane');
  if (!laneDomEl) return;
  const r = laneDomEl.getBoundingClientRect();
  laneWidth = r.width || 320;
  judgeX    = laneWidth * JUDGE_X_RATIO;
}

/* ---------- 内部ノーツ管理 ---------- */
// activeNotes: { id, ms, type, dur?, el, spawned, judged, hitRating? }
let activeNotes = [];

/** startGame / retry 時に呼んで全ノーツ DOM を消去 & 配列を初期化 */
export function resetNotes() {
  laneDomEl = document.getElementById('note-lane');
  // DOM クリア (judge-line 以外)
  if (laneDomEl) {
    const judgeLine = laneDomEl.querySelector('.note-judge-line');
    laneDomEl.innerHTML = '';
    if (judgeLine) laneDomEl.appendChild(judgeLine);
  }
  activeNotes = [];
  if (state.spawnedNoteIds) state.spawnedNoteIds.clear();
  if (state.judgedNoteIds)  state.judgedNoteIds.clear();
  updateLaneRect();
}

/** chart が dynamic import で届いたタイミングで notes 配列を初期化 */
export function initNotes(chartNotes) {
  if (!chartNotes) return;
  // ディープコピー (元の chart データを汚さない)
  state.notes = chartNotes.map((n, i) => ({
    id: i,
    ms: n.ms,
    type: n.type,          // 'tap' | 'mash'
    dur: n.dur || 0,
    el: null,              // DOM element (spawn 後にセット)
    spawned: false,
    judged: false,
    hitRating: null,
  }));
  state.spawnedNoteIds = new Set();
  state.judgedNoteIds  = new Set();
}

/* ---------- ノーツ DOM 生成 ---------- */
function createNoteDom(note, inChorus) {
  const wrapper = document.createElement('div');
  wrapper.className = 'note';
  wrapper.dataset.noteId = note.id;

  if (note.type === 'mash') {
    const inner = document.createElement('div');
    inner.className = 'note-mash';
    // mash ノーツの幅 = dur * MASH_WIDTH_PX_PER_MS (最小 60px)
    const w = Math.max(60, Math.round(note.dur * MASH_WIDTH_PX_PER_MS));
    inner.style.width = w + 'px';
    wrapper.appendChild(inner);
  } else if (inChorus) {
    // サビ区間の tap → chorus スタイル (ピンク大)
    const inner = document.createElement('div');
    inner.className = 'note-chorus';
    const img = document.createElement('img');
    img.src = GOOD_ICONS[note.id % GOOD_ICONS.length];
    img.alt = '';
    img.width = 64;
    inner.appendChild(img);
    wrapper.appendChild(inner);
  } else {
    // 通常 tap → goodicon 小 (黄色丸)
    const inner = document.createElement('div');
    inner.className = 'note-tap';
    const img = document.createElement('img');
    img.src = GOOD_ICONS[note.id % GOOD_ICONS.length];
    img.alt = '';
    img.width = 44;
    inner.appendChild(img);
    wrapper.appendChild(inner);
  }

  return wrapper;
}

/* ---------- メインループから毎フレーム呼ぶ ---------- */
/**
 * tickNotes(audioMs)
 * - LOOKAHEAD 範囲のノーツを spawn
 * - spawn 済みノーツの X 座標を更新
 * - missWindow 超過ノーツを miss 処理
 */
export function tickNotes(audioMs) {
  if (!laneDomEl) { laneDomEl = document.getElementById('note-lane'); }
  if (!laneDomEl || !state.notes || state.notes.length === 0) return;
  if (!laneWidth) updateLaneRect();

  const chart = state.currentChart;
  // chorus 区間判定: section-chorus class が rhythm-indicator に付いているかで判定
  // events から chorus 開始時刻を取得
  let chorusStartMs = Infinity;
  if (chart && chart.events) {
    const chorusEv = chart.events.find(e => e.type === 'section' && e.label === 'chorus');
    if (chorusEv) chorusStartMs = chorusEv.ms;
  }

  for (let i = 0; i < state.notes.length; i++) {
    const note = state.notes[i];
    if (note.judged) continue;

    const dt = note.ms - audioMs;   // 正: まだ来ていない / 負: 過ぎた

    // ---- Spawn ----
    if (!note.spawned && dt <= NOTE_TRAVEL_MS && dt > -MISS_WINDOW_MS) {
      const inChorus = note.ms >= chorusStartMs;
      note.el = createNoteDom(note, inChorus);
      // spawn と同フレームで初期 x をセット（チラつき防止: left 未設定のまま left:0 に表示されるのを回避）
      const initX = judgeX + (dt / NOTE_TRAVEL_MS) * (laneWidth - judgeX);
      note.el.style.left = initX + 'px';
      laneDomEl.appendChild(note.el);
      note.spawned = true;
      state.spawnedNoteIds.add(note.id);
    }

    if (!note.spawned) continue;

    // ---- Miss: 判定窓を超えた ----
    if (dt < -MISS_WINDOW_MS) {
      // mash は連打ゾーンなので hit なしで除去しない (midsongMash が管理)
      if (note.type !== 'mash') {
        markNoteRemoved(note, 'miss');
      }
      continue;
    }

    // ---- X 座標更新 ----
    // dt=NOTE_TRAVEL_MS → x=右端(laneWidth), dt=0 → x=judgeX
    const x = judgeX + (dt / NOTE_TRAVEL_MS) * (laneWidth - judgeX);
    note.el.style.left = x + 'px';

    // ---- 判定枠グロウ (±goodWindow 以内) ----
    const absDt = Math.abs(dt);
    if (absDt <= TUNING.goodWindowMs) {
      note.el.classList.add('judge-zone');
    } else {
      note.el.classList.remove('judge-zone');
    }
  }
}

/** ノーツを判定済みにして DOM 除去 */
function markNoteRemoved(note, rating) {
  note.judged = true;
  note.hitRating = rating;
  state.judgedNoteIds.add(note.id);
  if (note.el && note.el.parentNode) {
    note.el.parentNode.removeChild(note.el);
  }
  note.el = null;
}

/* ---------- rhythm.js から呼ばれる判定 API ---------- */

/**
 * findBestNote(audioMs)
 * タップ時刻 audioMs に最も近い未判定ノーツを返す。
 * mash ノーツは返さない (doMashNoteHit で別処理)。
 *
 * @returns {{ note, dt }} | null
 */
export function findBestNote(audioMs) {
  if (!state.notes || state.notes.length === 0) return null;

  let bestDt   = Infinity;
  let bestNote = null;

  for (let i = 0; i < state.notes.length; i++) {
    const note = state.notes[i];
    if (note.judged) continue;
    if (note.type === 'mash') continue;   // mash は別処理

    const dt = Math.abs(note.ms - audioMs);
    if (dt < bestDt) {
      bestDt   = dt;
      bestNote = note;
    }
  }

  // goodWindow を超えていれば null (miss 扱いは呼び出し側が決める)
  if (!bestNote || bestDt > TUNING.goodWindowMs) return null;
  return { note: bestNote, dt: bestDt };
}

/**
 * hitNote(note)
 * 判定確定: DOM 除去 + judged フラグ
 */
export function hitNote(note, rating) {
  markNoteRemoved(note, rating);
}

/**
 * checkMashNote(audioMs)
 * 現在 audioMs が mash ノーツの区間内かどうか判定する。
 * midsongMash 中に連打が来たとき、mash ノーツに対して hit として記録。
 * @returns {boolean} mash 区間内なら true
 */
export function checkMashNote(audioMs) {
  if (!state.notes) return false;
  for (let i = 0; i < state.notes.length; i++) {
    const note = state.notes[i];
    if (note.type !== 'mash') continue;
    if (note.judged) continue;
    if (audioMs >= note.ms && audioMs <= note.ms + note.dur) {
      return true;
    }
  }
  return false;
}

/**
 * finishMashNote()
 * mash ノーツ区間終了時に DOM 除去する (gameloop.js の finishMidsongMash から呼ぶ)
 */
export function finishMashNote() {
  if (!state.notes) return;
  for (let i = 0; i < state.notes.length; i++) {
    const note = state.notes[i];
    if (note.type === 'mash' && !note.judged) {
      markNoteRemoved(note, 'mash-complete');
    }
  }
}

/** ゲーム終了 / クリア時に全ノーツを除去 */
export function clearAllNotes() {
  if (!state.notes) return;
  for (let i = 0; i < state.notes.length; i++) {
    const note = state.notes[i];
    if (note.el && note.el.parentNode) {
      note.el.parentNode.removeChild(note.el);
    }
    note.el = null;
  }
  state.notes = [];
  if (state.spawnedNoteIds) state.spawnedNoteIds.clear();
  if (state.judgedNoteIds)  state.judgedNoteIds.clear();
}
