#!/usr/bin/env python3
"""
extract_chart.py — librosa onset detection で太鼓型譜面ドラフトを自動生成する。

v=136 追加機能:
1. librosa.onset.onset_detect で onset 時刻を抽出
2. onset_strength の上位パーセンタイルで間引き → 30〜45 ノーツ/曲に調整
3. 18 秒プレイ範囲 (offsetMs 〜 offsetMs+18000ms) に絞る
4. サビ前後 2000ms は密度 UP (連打ノートとして扱う)
5. notes: [{ms, type}] を JSON 形式でコンソール出力 → 各 charts/*.js に転記

実行:
    python tools/extract_chart.py

出力:
    コンソールに各曲の notes JSON + 統計を表示

既知の注意点:
    - librosa.beat.beat_track の global tempo は prior の影響でハーフテンポに
      ロックしやすい。BPM 実測は np.median(np.diff(beat_times)) を使う
      (feedback_librosa_tempo_unreliable)
    - onset_detect の閾値は density が 30〜45 ノーツに収まるよう動的調整
"""

import numpy as np
import librosa
import json
import os

GAME_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TRACKS = [
    {
        'id':       'musicA',
        'path':     os.path.join(GAME_DIR, 'assets', 'musicA.mp3'),
        'offsetMs': 487,
        'bpm':      130.8,
        'title':    'Milky CasWay',
        'chorusMs': 10487,   # v=135 採用サビ位置
    },
    {
        'id':       'musicB',
        'path':     os.path.join(GAME_DIR, 'assets', 'musicB.mp3'),
        'offsetMs': 468,
        'bpm':      131.0,
        'title':    'Parallel CasNight',
        'chorusMs': 12160,
    },
    {
        'id':       'musicC',
        'path':     os.path.join(GAME_DIR, 'assets', 'musicC.mp3'),
        'offsetMs': 862,
        'bpm':      130.8,
        'title':    'Signals of CasLiver',
        'chorusMs': 13973,
    },
]

PLAY_DURATION_MS = 18000   # プレイ範囲 18 秒
TARGET_NOTES_MIN = 30      # 目標最小ノーツ数 (Phase5 Must Fix #1: 28→30)
TARGET_NOTES_MAX = 45      # 目標最大ノーツ数
CHORUS_BOOST_MS  = 2000    # サビ前後のmash区間 (±ms)
MIN_NOTE_GAP_MS  = 120     # 連続ノーツの最小間隔 (ms) (Phase5 Must Fix #1: 150→120)


def extract_notes_for_track(track):
    """
    librosa onset detection で 18 秒プレイ範囲のノーツを生成する。

    Returns:
        dict: {
            'notes': list of {ms, type},
            'total': int,
            'tap': int,
            'mash': int,
            'chorus': int,
            'threshold_percentile': float,
            'chorus_ms': int,
        }
    """
    print(f"\n--- {track['id']} ({track['title']}) ---")
    y, sr = librosa.load(track['path'], sr=None, mono=True)
    duration = librosa.get_duration(y=y, sr=sr)
    print(f"  duration: {duration:.2f}s, sr: {sr}")

    offset_ms = track['offsetMs']
    play_start_ms = offset_ms
    play_end_ms   = offset_ms + PLAY_DURATION_MS
    chorus_ms     = track['chorusMs']

    # ---- BPM 実測 ----
    _, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    if len(beat_times) > 1:
        ibi_sec = np.median(np.diff(beat_times))
        measured_bpm = 60.0 / ibi_sec
    else:
        measured_bpm = track['bpm']
    print(f"  measured BPM (median IBI): {measured_bpm:.2f}  (known: {track['bpm']})")

    # ---- onset detection ----
    hop = 512
    onset_strength = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)

    # onset 時刻を取得（units='time' で秒単位）
    onset_frames = librosa.onset.onset_detect(
        y=y, sr=sr, hop_length=hop,
        onset_envelope=onset_strength,
        backtrack=True,
    )
    onset_times_sec = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop)
    onset_times_ms  = (onset_times_sec * 1000).astype(int)

    # onset ごとの強度を取得
    strength_at_onset = np.array([
        float(onset_strength[min(f, len(onset_strength)-1)]) for f in onset_frames
    ])

    # ---- プレイ範囲 (play_start_ms 〜 play_end_ms) でフィルタ ----
    mask = (onset_times_ms >= play_start_ms) & (onset_times_ms <= play_end_ms)
    play_onset_ms  = onset_times_ms[mask]
    play_strength  = strength_at_onset[mask]
    print(f"  onset count in play range: {len(play_onset_ms)}")

    # ---- 強度閾値で間引き → 30〜45 ノーツに調整 ----
    # パーセンタイルを二分探索して密度を TARGET 範囲に収める
    best_percentile = 50.0
    best_notes_ms   = play_onset_ms.copy()

    if len(play_onset_ms) > TARGET_NOTES_MAX:
        lo, hi = 0.0, 100.0
        for _ in range(20):
            mid = (lo + hi) / 2
            thr = np.percentile(play_strength, mid) if len(play_strength) > 0 else 0
            filtered = play_onset_ms[play_strength >= thr]
            n = len(filtered)
            if n > TARGET_NOTES_MAX:
                lo = mid
            elif n < TARGET_NOTES_MIN:
                hi = mid
            else:
                best_percentile = mid
                best_notes_ms   = filtered
                break
        else:
            # 収束しなかった場合、最もTARGET_NOTESに近いパーセンタイルを採用
            thr = np.percentile(play_strength, lo)
            best_notes_ms = play_onset_ms[play_strength >= thr]
            best_percentile = lo
    else:
        best_notes_ms = play_onset_ms
        best_percentile = 0.0

    print(f"  onset strength threshold: {best_percentile:.1f}th percentile → {len(best_notes_ms)} notes")

    # ---- 最小間隔フィルタ (MIN_NOTE_GAP_MS) ----
    filtered_ms = []
    last_ms = -9999
    for ms in sorted(best_notes_ms):
        if ms - last_ms >= MIN_NOTE_GAP_MS:
            filtered_ms.append(int(ms))
            last_ms = ms
    print(f"  after min-gap filter ({MIN_NOTE_GAP_MS}ms): {len(filtered_ms)} notes")

    # ---- サビ前後 CHORUS_BOOST_MS: mash 区間として登録 ----
    # サビ区間 [chorus_ms, chorus_ms + CHORUS_BOOST_MS) は type=mash にする
    # サビ前後の tap ノーツは削除して mash 1件に置き換える
    chorus_start = chorus_ms
    chorus_end   = chorus_ms + CHORUS_BOOST_MS

    notes = []
    tap_count    = 0
    mash_count   = 0
    chorus_count = 0

    mash_inserted = False
    for ms in sorted(filtered_ms):
        if chorus_start <= ms < chorus_end:
            # mash 区間内の tap は最初の1件だけ mash ノートに変換
            if not mash_inserted:
                notes.append({'ms': chorus_start, 'type': 'mash', 'dur': CHORUS_BOOST_MS})
                mash_count += 1
                mash_inserted = True
            # それ以降は捨てる (mash 区間中のノーツは mash が担う)
        else:
            # mash 区間以外: 曲の各セクション内の tap
            notes.append({'ms': ms, 'type': 'tap'})
            tap_count += 1

    total = len(notes)
    print(f"  final notes: {total} (tap={tap_count}, mash={mash_count}, chorus_boost_ms={CHORUS_BOOST_MS})")

    return {
        'notes': notes,
        'total': total,
        'tap': tap_count,
        'mash': mash_count,
        'chorus': chorus_count,
        'threshold_percentile': round(best_percentile, 1),
        'chorus_ms': chorus_ms,
    }


def format_notes_js(notes):
    """notes リストを JS 配列リテラルにフォーマット"""
    lines = []
    for n in notes:
        if n['type'] == 'mash':
            lines.append(f"    {{ ms: {n['ms']:6d}, type: 'mash', dur: {n['dur']} }},")
        else:
            lines.append(f"    {{ ms: {n['ms']:6d}, type: '{n['type']}' }},")
    return '\n'.join(lines)


def main():
    results = {}
    for track in TRACKS:
        result = extract_notes_for_track(track)
        results[track['id']] = result

    print("\n\n========= SUMMARY =========")
    for track in TRACKS:
        r = results[track['id']]
        print(f"\n{track['id']}:")
        print(f"  total={r['total']}, tap={r['tap']}, mash={r['mash']}")
        print(f"  threshold_percentile={r['threshold_percentile']}")
        print(f"  chorus_ms={r['chorus_ms']}")

    print("\n\n========= JS NOTES ARRAYS =========")
    for track in TRACKS:
        r = results[track['id']]
        notes_js = format_notes_js(r['notes'])
        print(f"\n// --- {track['id']} ---")
        print(f"// tap={r['tap']}, mash={r['mash']}, total={r['total']}")
        print(f"// onset threshold: {r['threshold_percentile']}th percentile")
        print(f"// chorus at {r['chorus_ms']}ms, boost +{CHORUS_BOOST_MS}ms")
        print(f"notes: [")
        print(notes_js)
        print(f"],")

    return results


if __name__ == '__main__':
    main()
