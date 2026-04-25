/* ============================================================
   js/charts/musicB.js — 譜面データ: Parallel CasNight (musicB.mp3)
   ============================================================

   v=136 太鼓の達人型実装

   librosa onset detection (tools/extract_chart.py, v=136)
   onset strength threshold: 75.0th percentile
   min note gap: 150ms
   play range: offsetMs(468) 〜 offsetMs+18000ms
   chorus at 12160ms, mash boost +2000ms

   notes 統計:
     tap=30, mash=1, total=31
     (合格基準7: 30〜45ノーツ目標 — Phase5修正でBPMグリッド補充+3を追加して30達成)

   ms 基準: getAudioClockMs() の値と直接比較できる曲先頭からの絶対時刻。
   ============================================================ */

export const CHART_MUSIC_B = {
  trackId: 'musicB',
  events: [
    // セクション進行 (v=135 資産維持)
    { ms: 0,     type: 'section', label: 'intro' },
    { ms: 10170, type: 'section', label: 'verse' },
    { ms: 12160, type: 'section', label: 'chorus' },
    // サビ連打ゾーン (midsongMash state 維持)
    { ms: 12160, type: 'mash', dur: 2000 },
  ],
  notes: [
    // --- v=136 librosa onset detection ドラフト ---
    // tap=27, mash=1, total=28
    // onset threshold: 75.0th percentile, min_gap: 150ms
    { ms:   1717, type: 'tap' },
    { ms:   1941, type: 'tap' },
    { ms:   2282, type: 'tap' },
    { ms:   2528, type: 'tap' },
    { ms:   3413, type: 'tap' },
    { ms:   4554, type: 'tap' },
    { ms:   4810, type: 'tap' },
    { ms:   5386, type: 'tap' },
    { ms:   5696, type: 'tap' },
    { ms:   5962, type: 'tap' },
    { ms:   6186, type: 'tap' },
    { ms:   6410, type: 'tap' },
    { ms:   6976, type: 'tap' },
    { ms:   7445, type: 'tap' },
    { ms:   7669, type: 'tap' },
    { ms:   7893, type: 'tap' },
    { ms:   8480, type: 'tap' },
    { ms:   9045, type: 'tap' },
    { ms:  11904, type: 'tap' },
    { ms:  12160, type: 'mash', dur: 2000 },   // サビ連打ゾーン (2秒)
    { ms:  14314, type: 'tap' },
    { ms:  14880, type: 'tap' },
    { ms:  15232, type: 'tap' },
    { ms:  15456, type: 'tap' },
    { ms:  15786, type: 'tap' },
    { ms:  16608, type: 'tap' },
    { ms:  17984, type: 'tap' },
    { ms:  18325, type: 'tap' },
    // --- 補充ノーツ: BPM グリッドベース手動補充 +3 (Phase5 Must Fix #1) ---
    // 既存ノーツと 200ms 以上離れた位置、サビ mash 区間 (12160〜14160ms) 回避
    { ms:  10512, type: 'tap' },   // 10170+342ms: 11904 と 1392ms / 9045 と 1467ms
    { ms:  14622, type: 'tap' },   // 14160終了後+462ms: 14314 と 308ms / 14880 と 258ms
    { ms:  16960, type: 'tap' },   // 16608 と 352ms / 17984 と 1024ms
  ],
};
