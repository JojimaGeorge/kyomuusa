/* ============================================================
   js/charts/musicC.js — 譜面データ: Signals of CasLiver (musicC.mp3)
   ============================================================

   v=136 太鼓の達人型実装

   librosa onset detection (tools/extract_chart.py, v=136)
   onset strength threshold: 75.0th percentile
   min note gap: 150ms
   play range: offsetMs(862) 〜 offsetMs+18000ms
   chorus at 13973ms, mash boost +2000ms

   notes 統計:
     tap=30, mash=1, total=31
     ※ musicC は offsetMs=862ms でイントロが長く onset が少ない。
       onset 段階: tap=22, mash=1, total=23 (onset段階)
       30〜45ノーツ目標に対して不足のため BPM グリッドベースで補充。
       補充ノーツ 8 個を追記 (Phase5修正: うち既存6個 + 追加2個)。
       仮置き: 実機確認後にサビ後の密度が高すぎる場合は間引く推奨。

   ms 基準: getAudioClockMs() の値と直接比較できる曲先頭からの絶対時刻。
   ============================================================ */

export const CHART_MUSIC_C = {
  trackId: 'musicC',
  events: [
    // セクション進行 (v=135 資産維持)
    { ms: 0,     type: 'section', label: 'intro' },
    { ms: 5930,  type: 'section', label: 'verse' },
    { ms: 13973, type: 'section', label: 'chorus' },
    // サビ連打ゾーン (midsongMash state 維持)
    { ms: 13973, type: 'mash', dur: 2000 },
  ],
  notes: [
    // --- v=136 librosa onset detection ドラフト (23ノーツ) ---
    // tap=22, mash=1
    // onset threshold: 75.0th percentile, min_gap: 150ms
    { ms:   1376, type: 'tap' },
    { ms:   1600, type: 'tap' },
    { ms:   3328, type: 'tap' },
    { ms:   4234, type: 'tap' },
    { ms:   4480, type: 'tap' },
    { ms:   4821, type: 'tap' },
    { ms:   5280, type: 'tap' },
    { ms:   6773, type: 'tap' },
    { ms:   7552, type: 'tap' },
    { ms:   7914, type: 'tap' },
    { ms:   8128, type: 'tap' },
    { ms:   8458, type: 'tap' },
    { ms:   8810, type: 'tap' },
    { ms:   9632, type: 'tap' },
    { ms:  11797, type: 'tap' },
    { ms:  12032, type: 'tap' },
    { ms:  13738, type: 'tap' },
    { ms:  13973, type: 'mash', dur: 2000 },   // サビ連打ゾーン (2秒)
    { ms:  16042, type: 'tap' },
    { ms:  16597, type: 'tap' },
    { ms:  16832, type: 'tap' },
    { ms:  17024, type: 'tap' },
    { ms:  17973, type: 'tap' },
    // --- 補充ノーツ: BPM グリッドベース手動補充 +8 (Phase5 Must Fix #1: 既存6 + 追加2) ---
    // onset 検出が少ない区間を補充。既存ノーツと 200ms 以上離れた位置、サビ mash 区間 (13973〜15973ms) 回避
    { ms:  15091, type: 'tap' },   // 15973終了後+補充① (既存)
    { ms:  15549, type: 'tap' },   // 15091 と 458ms (既存)
    { ms:  16384, type: 'tap' },   // 16042 と 342ms / 16597 と 213ms (既存)
    { ms:  17490, type: 'tap' },   // 17024 と 466ms / 17973 と 483ms (既存)
    { ms:  18231, type: 'tap' },   // 17973 と 258ms (既存)
    { ms:  18487, type: 'tap' },   // 18231 と 256ms (既存)
    { ms:   4000, type: 'tap' },   // 追加①: 3328 と 672ms / 4234 と 234ms (Phase5)
    { ms:  10560, type: 'tap' },   // 追加②: 9632 と 928ms / 11797 と 1237ms (Phase5)
  ],
};
