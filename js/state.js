/* ============================================================
   state.js — single mutable state object shared across modules.
   Keep all mutables that need to outlive a single function call here.
   ============================================================ */

export const state = {
  // gauge / progress
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

  // BGM / track
  currentBgmMeta: null,
  currentTrackId: null,

  // timing / rhythm
  startAt: 0,
  running: false,
  cleared: false,
  stage: 'idle',
  rafId: null,
  nextBeatAt: 0,
  beatIndex: 0,
  beatCycleDuration: 0,
  lastBeatInterval: 0,
  indicatorScale: 2.0,
  lastTapAt: 0,
  elapsedSec: 0,
  rhythmClearSec: 0,
  clearTime: 0,

  // Score breakdown (filled by computeFinalScore)
  runningScore: 0,
  finalScore: 0,
  scoreBreakdown: null,
  rank: '',

  // GIF state machine
  gifStage: null,
  gifStartAt: 0,
  gifAdvanceTimer: null,
  gifPendingAdvance: false,
  activeChar: 'A',

  // Mash phase (gauge 99% → 30連打クリア)
  mashMode: false,
  mashCount: 0,
  mashTarget: 30,
  mashPending: false,

  // Chart (譜面イベント駆動)
  currentChart: null,       // CHART_MUSIC_* オブジェクト (曲選択時にセット)
  firedEventIds: null,      // Set<number> — 発火済みイベントのインデックス (重複防止)
  midsongMash: false,       // 曲中 mash-zone フェーズ中フラグ (クリア後 mashMode と排他)
  midsongMashEndMs: 0,      // 曲中 mash 終了予定の audioMs

  // Indicator-only animation (during countdown)
  indicatorActive: false,
  indicatorRafId: null,

  // Ranking
  rankingPromise: null,
  rankingResult: null,
  pendingNameSubmission: null,
};
