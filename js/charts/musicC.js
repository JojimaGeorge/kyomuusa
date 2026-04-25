/* ============================================================
   js/charts/musicC.js — 譜面データ: Signals of CasLiver (musicC.mp3)
   ============================================================

   librosa 構造解析 (tools/extract_chart.py, k=12, chroma_cqt)
   サビ候補一覧:
     0.00s (score=0.822), 5.93s (score=0.809), 13.97s (score=0.688),
     15.67s (score=0.937), 21.16s (score=0.869), 21.99s (score=0.917),
     28.33s (score=0.752), 29.77s (score=0.831), 32.20s (score=0.781),
     45.02s (score=0.795), 46.85s (score=0.739), 52.33s (score=0.859)

   採用: 13.97s (13973ms)
   採用理由: プレイ開始 (offsetMs=862ms) から 13.1秒目。
             プレイ時間軸 10〜14 秒ウィンドウ (曲頭 10.86s〜14.86s) の
             ウィンドウ内候補 [13.97s] を採用 (score=0.688)。
             musicC は offsetMs=862ms とイントロが長い（約2拍分）ため
             ウィンドウが他曲より右寄りになる。
             BPM 実測 130.81 と既知値 (130.8) は一致。

   ms 基準: getAudioClockMs() の値と直接比較できる曲先頭からの絶対時刻。
   ============================================================ */

export const CHART_MUSIC_C = {
  trackId: 'musicC',
  events: [
    // セクション進行
    { ms: 0,     type: 'section', label: 'intro' },
    { ms: 5930,  type: 'section', label: 'verse' },
    { ms: 13973, type: 'section', label: 'chorus' },
    // サビ連打ゾーン (2000ms)
    { ms: 13973, type: 'mash',    dur: 2000 },
  ],
};
