/* ============================================================
   js/charts/musicA.js — 譜面データ: Milky CasWay (musicA.mp3)
   ============================================================

   librosa 構造解析 (tools/extract_chart.py, k=12, chroma_cqt)
   サビ候補一覧:
     0.00s (score=0.651), 1.73s (score=0.674), 3.10s (score=0.491),
     5.01s (score=0.677), 7.17s (score=0.773), 8.94s (score=0.759),
     21.99s (score=0.669), 25.82s (score=0.723), 31.34s (score=0.829),
     38.34s (score=0.882), 42.13s (score=0.828), 53.42s (score=0.887)

   採用: 10487ms (手動調整)
   採用理由: librosa ウィンドウ (10〜14s) 内候補なし → 手動で 10487ms に調整。
             (offsetMs 487 + 10000ms = プレイ開始10.0秒目)
             最近傍候補 8.94s はプレイ経過 8.45s でウィンドウ外のため不採用。
             BPM 実測 130.81 と既知値 (130.8) は一致。

   ms 基準: getAudioClockMs() の値と直接比較できる曲先頭からの絶対時刻。
   ============================================================ */

export const CHART_MUSIC_A = {
  trackId: 'musicA',
  events: [
    // セクション進行
    { ms: 0,    type: 'section', label: 'intro' },
    { ms: 5010, type: 'section', label: 'verse' },
    { ms: 10487, type: 'section', label: 'chorus' },
    // サビ連打ゾーン (2000ms)
    { ms: 10487, type: 'mash',    dur: 2000 },
  ],
};
