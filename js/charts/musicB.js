/* ============================================================
   js/charts/musicB.js — 譜面データ: Parallel CasNight (musicB.mp3)
   ============================================================

   librosa 構造解析 (tools/extract_chart.py, k=12, chroma_cqt)
   サビ候補一覧:
     0.00s (score=0.783), 10.17s (score=0.684), 12.16s (score=0.636),
     15.07s (score=0.751), 37.75s (score=0.910), 39.51s (score=0.882),
     41.79s (score=0.903), 45.16s (score=0.883), 46.81s (score=0.895),
     48.76s (score=0.857), 51.85s (score=0.980), 56.12s (score=0.919)

   採用: 12.16s (12160ms)
   採用理由: プレイ開始 (offsetMs=468ms) から 11.7秒目。
             プレイ時間軸 10〜14 秒ウィンドウ (曲頭 10.47s〜14.47s) の
             ウィンドウ内候補 [10.17s(score=0.684), 12.16s(score=0.636)] のうち
             スコア最高は 10.17s だがイントロ直後で体感的に早すぎるため、
             ウィンドウ内2番目候補の 12.16s (プレイ開始11.7秒目) をプレイ体感優先で採用。
             BPM 実測 130.81 と既知値 (131.0) は一致。

   ms 基準: getAudioClockMs() の値と直接比較できる曲先頭からの絶対時刻。
   ============================================================ */

export const CHART_MUSIC_B = {
  trackId: 'musicB',
  events: [
    // セクション進行
    { ms: 0,     type: 'section', label: 'intro' },
    { ms: 10170, type: 'section', label: 'verse' },
    { ms: 12160, type: 'section', label: 'chorus' },
    // サビ連打ゾーン (2000ms)
    { ms: 12160, type: 'mash',    dur: 2000 },
  ],
};
