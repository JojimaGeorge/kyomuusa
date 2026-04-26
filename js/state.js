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

  // Mash phase
  mashMode: false,
  mashCount: 0,
  mashTarget: 30,
  mashPending: false,

  // Fever (gauge >= FEVER_THRESHOLD until mash entry)
  feverActive: false,
  feverFired: false,  // one-shot guard: once fever fired this game, never re-fire
  feverPerfectCount: 0,  // perfects landed during fever zone (1.5x score bonus)
  feverGreatCount: 0,
  feverGoodCount: 0,

  // Indicator-only animation (during countdown)
  indicatorActive: false,
  indicatorRafId: null,

  // Ranking
  rankingPromise: null,
  rankingResult: null,
  pendingNameSubmission: null,
};
