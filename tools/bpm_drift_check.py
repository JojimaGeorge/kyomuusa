#!/usr/bin/env python3
"""全曲の拍位置を検出して、テンポが途中で変動しているか確認する。
各ビート間隔 (IBI) を出力し、我々の一定 interval (= 60000/bpm) 仮定がどれくらい破れるか見る。
"""
import sys
import numpy as np
import librosa

def check_drift(path, assumed_bpm=129.20):
    print(f"\n=== {path} ===")
    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = len(y) / sr
    print(f"duration: {duration:.2f}s")

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)
    _, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    ibi_ms = np.diff(beat_times) * 1000

    print(f"\ntotal beats detected: {len(beat_times)}")
    print(f"IBI stats (ms): min={ibi_ms.min():.1f} max={ibi_ms.max():.1f} mean={ibi_ms.mean():.2f} std={ibi_ms.std():.2f}")

    # Expected IBI from assumed BPM
    expected_ibi = 60000 / assumed_bpm
    print(f"expected IBI (@ {assumed_bpm} BPM): {expected_ibi:.2f}ms")

    # Cumulative drift: where does the grid diverge from actual beats?
    offset = beat_times[0] * 1000
    cumulative_drift_ms = []
    for i, bt in enumerate(beat_times):
        expected_beat_time_ms = offset + i * expected_ibi
        actual_beat_time_ms = bt * 1000
        drift = actual_beat_time_ms - expected_beat_time_ms
        cumulative_drift_ms.append(drift)

    cd = np.array(cumulative_drift_ms)
    print(f"\ncumulative drift from grid (ms):")
    print(f"  at beat 10 (~{beat_times[10]:.1f}s): {cd[10]:+.1f}ms")
    print(f"  at beat 20 (~{beat_times[20]:.1f}s): {cd[20]:+.1f}ms")
    if len(cd) > 30:
        print(f"  at beat 30 (~{beat_times[30]:.1f}s): {cd[30]:+.1f}ms")
    if len(cd) > 50:
        print(f"  at beat 50 (~{beat_times[50]:.1f}s): {cd[50]:+.1f}ms")
    print(f"  final ({len(cd)-1} beats, {beat_times[-1]:.1f}s): {cd[-1]:+.1f}ms")
    print(f"  max absolute drift: {np.abs(cd).max():.1f}ms")

    # Flag any IBIs that deviate significantly
    threshold = 30  # ms
    outliers = [(i, beat_times[i], ibi_ms[i]) for i in range(len(ibi_ms)) if abs(ibi_ms[i] - expected_ibi) > threshold]
    if outliers:
        print(f"\n!! {len(outliers)} IBI outliers (>{threshold}ms off) detected:")
        for i, t, ibi in outliers[:10]:
            print(f"  beat {i+1} @ {t:.2f}s: IBI = {ibi:.1f}ms (expected {expected_ibi:.1f}ms, diff {ibi-expected_ibi:+.1f})")
    else:
        print(f"\nOK: all IBIs within {threshold}ms of expected. Tempo is stable.")

    # Also compute per-section tempo (windowed)
    print(f"\nper-10-beat average IBI:")
    for start in range(0, len(ibi_ms), 10):
        chunk = ibi_ms[start:start+10]
        if len(chunk) > 0:
            chunk_bpm = 60000 / chunk.mean()
            print(f"  beats {start+1}-{start+len(chunk)}: mean IBI {chunk.mean():.2f}ms → {chunk_bpm:.2f} BPM")

if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else 'assets/musicA.mp3'
    assumed_bpm = float(sys.argv[2]) if len(sys.argv) > 2 else 129.20
    check_drift(path, assumed_bpm)
