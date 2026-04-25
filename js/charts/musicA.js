/* ============================================================
   js/charts/musicA.js — 譜面データ: Milky CasWay (musicA.mp3)
   ============================================================

   v=136 太鼓の達人型実装

   librosa onset detection (tools/extract_chart.py, v=136)
   onset strength threshold: 75.0th percentile
   min note gap: 150ms
   play range: offsetMs(487) 〜 offsetMs+18000ms
   chorus at 10487ms, mash boost +2000ms

   notes 統計:
     tap=30, mash=1, total=31
     (合格基準7: 30〜45ノーツ目標 — Phase5修正でBPMグリッド補充+2を追加して30達成)

   ms 基準: getAudioClockMs() の値と直接比較できる曲先頭からの絶対時刻。
   ============================================================ */

export const CHART_MUSIC_A = {
  trackId: 'musicA',
  events: [
    // セクション進行 (v=135 資産維持)
    { ms: 0,     type: 'section', label: 'intro' },
    { ms: 5010,  type: 'section', label: 'verse' },
    { ms: 10487, type: 'section', label: 'chorus' },
    // サビ連打ゾーン (midsongMash state 維持)
    { ms: 10487, type: 'mash', dur: 2000 },
  ],
  notes: [
    // --- v=136 librosa onset detection ドラフト ---
    // tap=28, mash=1, total=29
    // onset threshold: 75.0th percentile, min_gap: 150ms
    { ms:    565, type: 'tap' },
    { ms:   1888, type: 'tap' },
    { ms:   2186, type: 'tap' },
    { ms:   2517, type: 'tap' },
    { ms:   2986, type: 'tap' },
    { ms:   5280, type: 'tap' },
    { ms:   5514, type: 'tap' },
    { ms:   5738, type: 'tap' },
    { ms:   7221, type: 'tap' },
    { ms:   7690, type: 'tap' },
    { ms:   8032, type: 'tap' },
    { ms:   8373, type: 'tap' },
    { ms:   8938, type: 'tap' },
    { ms:   9504, type: 'tap' },
    { ms:   9856, type: 'tap' },
    { ms:  10304, type: 'tap' },
    { ms:  10487, type: 'mash', dur: 2000 },   // サビ連打ゾーン (2秒)
    { ms:  13173, type: 'tap' },
    { ms:  13514, type: 'tap' },
    { ms:  13749, type: 'tap' },
    { ms:  13973, type: 'tap' },
    { ms:  14208, type: 'tap' },
    { ms:  15808, type: 'tap' },
    { ms:  16256, type: 'tap' },
    { ms:  17173, type: 'tap' },
    { ms:  17408, type: 'tap' },
    { ms:  17621, type: 'tap' },
    { ms:  17877, type: 'tap' },
    { ms:  18314, type: 'tap' },
    // --- 補充ノーツ: BPM グリッドベース手動補充 +2 (Phase5 Must Fix #1) ---
    // 既存ノーツと 200ms 以上離れた位置、サビ mash 区間 (10487〜12487ms) 回避
    { ms:  12704, type: 'tap' },   // 12487終了後+217ms: 13173 と 469ms
    { ms:  15360, type: 'tap' },   // 15808 と 448ms / 14208 と 1152ms
  ],
};
