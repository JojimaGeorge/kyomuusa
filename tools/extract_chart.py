#!/usr/bin/env python3
"""
extract_chart.py — librosa 構造解析でサビ候補時刻を抽出する。

3曲それぞれについて:
1. chroma 特徴量でセクション境界を検出
2. RMS エネルギーと onset density でピークスコアを算出
3. プレイ開始 10〜14 秒範囲（曲頭からの絶対時刻）に最も近い候補を採用

実行:
    python tools/extract_chart.py

出力:
    コンソールに候補リストと採用根拠を表示（js/charts/*.js コメントに転記）

既知の注意点:
    - librosa.beat.beat_track の global tempo は prior の影響でハーフテンポに
      ロックしやすい。BPM 実測は np.median(np.diff(beat_times)) を使う
      (feedback_librosa_tempo_unreliable)
"""

import numpy as np
import librosa
import os

GAME_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TRACKS = [
    {
        'id':       'musicA',
        'path':     os.path.join(GAME_DIR, 'assets', 'musicA.mp3'),
        'offsetMs': 487,
        'bpm':      130.8,
        'title':    'Milky CasWay',
    },
    {
        'id':       'musicB',
        'path':     os.path.join(GAME_DIR, 'assets', 'musicB.mp3'),
        'offsetMs': 468,
        'bpm':      131.0,
        'title':    'Parallel CasNight',
    },
    {
        'id':       'musicC',
        'path':     os.path.join(GAME_DIR, 'assets', 'musicC.mp3'),
        'offsetMs': 862,
        'bpm':      130.8,
        'title':    'Signals of CasLiver',
    },
]

# プレイ開始 = 曲の offsetMs 時点。そこから 10〜14 秒後が採用ウィンドウ
PLAY_START_RANGE_SEC = (10, 14)


def analyze_track(track):
    """サビ候補時刻を返す (秒単位リスト)。"""
    print(f"\n--- {track['id']} ({track['title']}) ---")
    y, sr = librosa.load(track['path'], sr=None, mono=True)
    duration = librosa.get_duration(y=y, sr=sr)
    print(f"  duration: {duration:.2f}s, sr: {sr}")

    # ---- BPM 実測 (median IBI、global tempo は使わない) ----
    _, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    if len(beat_times) > 1:
        ibi_sec = np.median(np.diff(beat_times))
        measured_bpm = 60.0 / ibi_sec
    else:
        measured_bpm = track['bpm']
    print(f"  measured BPM (median IBI): {measured_bpm:.2f}  (known: {track['bpm']})")

    # ---- セクション境界: chroma CQT → recurrence + 構造セグメント ----
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
    bounds_frames = librosa.segment.agglomerative(chroma, k=8)
    bounds_sec = librosa.frames_to_time(bounds_frames, sr=sr, hop_length=hop)
    print(f"  section boundaries ({len(bounds_sec)} pts): {[f'{t:.2f}' for t in bounds_sec]}")

    # ---- RMS エネルギー (フレーム平均) ----
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    times_rms = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)

    # ---- onset strength / density ----
    onset_strength = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    times_onset = librosa.frames_to_time(np.arange(len(onset_strength)), sr=sr, hop_length=hop)

    # ---- セクション候補ごとにスコア算出 ----
    # セクション境界の直後 1 秒ウィンドウの RMS 中央値 × onset 中央値
    def window_score(t_start, win=1.5):
        t_end = t_start + win
        rms_mask   = (times_rms   >= t_start) & (times_rms   < t_end)
        onset_mask = (times_onset >= t_start) & (times_onset < t_end)
        rms_val   = float(np.median(rms[rms_mask]))   if rms_mask.any()   else 0.0
        onset_val = float(np.median(onset_strength[onset_mask])) if onset_mask.any() else 0.0
        # 正規化して合成スコア (RMS 70% + onset 30%)
        return rms_val, onset_val

    all_rms   = [window_score(t)[0] for t in bounds_sec]
    all_onset = [window_score(t)[1] for t in bounds_sec]
    rms_max   = max(all_rms)   if max(all_rms)   > 0 else 1
    onset_max = max(all_onset) if max(all_onset) > 0 else 1

    candidates = []
    for t in bounds_sec:
        rv, ov = window_score(t)
        score = (rv / rms_max) * 0.7 + (ov / onset_max) * 0.3
        candidates.append({'t': t, 'score': score, 'rms': rv, 'onset': ov})

    # スコア降順
    candidates.sort(key=lambda c: c['score'], reverse=True)
    print("  candidates (sorted by score):")
    for c in candidates:
        print(f"    t={c['t']:.2f}s  score={c['score']:.3f}  rms={c['rms']:.4f}  onset={c['onset']:.2f}")

    # ---- プレイ時間軸ウィンドウでフィルタ ----
    # プレイ開始 = 曲の offsetMs 時点（絶対時刻）
    # 採用ウィンドウ: offsetMs/1000 + 10s 〜 offsetMs/1000 + 14s
    offset_sec = track['offsetMs'] / 1000.0
    win_lo = offset_sec + PLAY_START_RANGE_SEC[0]
    win_hi = offset_sec + PLAY_START_RANGE_SEC[1]
    print(f"  play-window (abs): {win_lo:.2f}s 〜 {win_hi:.2f}s")

    # 採用ウィンドウ内の候補を探す
    in_window = [c for c in candidates if win_lo <= c['t'] <= win_hi]
    if in_window:
        # ウィンドウ内で最高スコア
        chosen = max(in_window, key=lambda c: c['score'])
        reason = f"プレイ開始後{chosen['t'] - offset_sec:.1f}秒目、RMS最高 (ウィンドウ内最高スコア={chosen['score']:.3f})"
    else:
        # ウィンドウ外: 最も近い候補 (abs distance to window center)
        win_center = (win_lo + win_hi) / 2
        closest = min(candidates, key=lambda c: abs(c['t'] - win_center))
        chosen = closest
        reason = f"ウィンドウ外フォールバック（最近傍）: {chosen['t']:.2f}s, score={chosen['score']:.3f}"

    print(f"  ==> CHOSEN: {chosen['t']:.2f}s  ({reason})")

    return {
        'chosen_sec': chosen['t'],
        'chosen_ms':  round(chosen['t'] * 1000),
        'reason':     reason,
        'candidates': candidates,
        'offset_sec': offset_sec,
        'win_lo':     win_lo,
        'win_hi':     win_hi,
    }


def main():
    results = {}
    for track in TRACKS:
        result = analyze_track(track)
        results[track['id']] = result

    print("\n\n========= SUMMARY =========")
    for track in TRACKS:
        r = results[track['id']]
        cands_str = ', '.join(f"{c['t']:.2f}s" for c in sorted(r['candidates'], key=lambda c: c['t']))
        print(f"{track['id']}: candidates=[{cands_str}]")
        print(f"  adopted: {r['chosen_sec']:.2f}s ({r['chosen_ms']}ms)")
        print(f"  reason : {r['reason']}")
    return results


if __name__ == '__main__':
    main()
