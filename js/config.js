/* ============================================================
   config.js — TUNING constants, version, endpoints, GIF stages
   ============================================================ */

export const GAME_VERSION = 'v133';

/* ---------- Ranking API ---------- */
// Always use the remote Workers endpoint. The localhost fallback is intentionally
// removed — in practice nobody has wrangler dev running locally, so localhost
// would fail-fast with a network error and show "接続できません" even though
// the prod API is up. For local dev, edit this constant temporarily.
export const RANKING_API = 'https://kyomuusa-ranking.kento-nakamura-62a.workers.dev';

export const TUNING = /*EDITMODE-BEGIN*/{
  "beatIntervalMs": 560,
  "beatSpeedupAt100": 0.5,
  "perfectWindowMs": 100,
  "greatWindowMs": 190,
  "goodWindowMs": 290,
  "gainPerfect": 3.85,
  "gainGreat": 2.31,
  "gainGood": 1.31,
  "gainMiss": 0,
  "decayPerSec": 2.0,
  "targetTimeSec": 18,
  "beatLatencyMs": 80,
  "hologramStrength": 0,
  "effectIntensity": 10,
  "shakeEnabled": true,
  "flashEnabled": true,
  "particlesEnabled": true,
  "useAudioTimeSync": true
}/*EDITMODE-END*/;

// Expose for devtools tuning (e.g., window.TUNING.beatLatencyMs = 180)
if (typeof window !== 'undefined') window.TUNING = TUNING;

/* Rabbit stage GIFs — 3-level hype progression with seamless transitions
   A(loop 0-25%) → B(bridge) → C(loop 25-60%) → D(bridge) → E(loop 60-100%) → F(clear kiss, 2.5s)
   Durations measured from the actual GIFs (ms). */
export const STAGE_GIFS = {
  A: { src: './assets/kyomuA.webp', dur: 2800, loop: true,  next: 'B' },
  B: { src: './assets/kyomuB.webp', dur: 1200, loop: false, next: 'C' },
  C: { src: './assets/kyomuC.webp', dur: 440,  loop: true,  next: 'D' },
  D: { src: './assets/kyomuD.webp', dur: 1440, loop: false, next: 'E' },
  E: { src: './assets/kyomuE.webp', dur: 1200, loop: true,  next: null },
  F: { src: './assets/kyomuF.webp', dur: 3000, loop: false, next: null },
};
export const CLEAR_F_PLAY_MS = 4000;

/* Tap-particle assets — same icons used as the in-app "like" button to foreshadow CasLive. */
export const GOOD_ICONS = [
  './assets/goodicon_01.webp',
  './assets/goodicon_02.webp',
  './assets/goodicon_03.webp',
  './assets/goodicon_04.webp',
  './assets/goodicon_05.webp',
  './assets/goodicon_06.webp',
  './assets/goodicon_07.webp',
];

/* SNS share */
export const SHARE_HASHTAGS = '#きょむうさ猛プッシュ #CasLive';
export const SHARE_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.href.split('?')[0]
  : 'https://caslive.jp/';

/* Song picker (debug) */
export const SONG_PICKER_KEY = 'kyomuusa_force_track';
export const SONG_PICKER_TAP_WINDOW = 1500; // ms — taps within window count toward unlock
export const SONG_PICKER_REQUIRED = 5;
