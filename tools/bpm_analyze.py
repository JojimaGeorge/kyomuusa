#!/usr/bin/env python3
"""MP3 BGM の BPM とダウンビート先頭 offset (ms) を推定する。
Usage: python bpm_analyze.py <mp3_path> [hint_bpm] [hint_offset_ms]
"""
import sys
import numpy as np
import librosa

def analyze(path, hint_bpm=None, hint_offset_ms=None):
    print(f"\n=== {path} ===")
    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = len(y) / sr
    print(f"duration: {duration:.2f}s  sample_rate: {sr}")

    # Onset envelope
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)

    # Global tempo estimation (static)
    tempo_arr = librosa.beat.tempo(onset_envelope=onset_env, sr=sr, aggregate=None)
    global_tempo = librosa.beat.tempo(onset_envelope=onset_env, sr=sr)[0]
    print(f"global_tempo (librosa): {global_tempo:.2f} BPM")

    # Beat tracking (returns beat times in seconds)
    _, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    if len(beat_times) > 0:
        # inter-beat intervals → derive BPM more precisely
        ibi = np.diff(beat_times)
        median_ibi = np.median(ibi)
        derived_bpm = 60.0 / median_ibi
        print(f"derived_bpm (median IBI): {derived_bpm:.2f} BPM")
        first_beat_ms = beat_times[0] * 1000
        print(f"first detected beat: {first_beat_ms:.0f}ms")

    # If hint_bpm is provided, search for the nearest beat to a hinted offset
    if hint_bpm and hint_offset_ms is not None:
        beat_interval_sec = 60.0 / hint_bpm
        # Find the beat time closest to hint_offset
        hint_sec = hint_offset_ms / 1000.0
        if len(beat_times) > 0:
            closest_idx = int(np.argmin(np.abs(beat_times - hint_sec)))
            closest_beat_sec = beat_times[closest_idx]
            diff_ms = (closest_beat_sec - hint_sec) * 1000
            print(f"\nhint: bpm={hint_bpm}, offset={hint_offset_ms}ms")
            print(f"nearest detected beat: {closest_beat_sec*1000:.0f}ms (diff from hint: {diff_ms:+.0f}ms)")

    # Show first 8 detected beats for reference
    print(f"\nfirst 8 beats (ms): {[int(t*1000) for t in beat_times[:8]]}")

    # Compute plausible downbeat offset: earliest beat after 1s that matches hint_bpm
    # (Tracks often have intro fade; first stable downbeat is what gameplay needs to sync to)
    if len(beat_times) >= 16:
        # Recommend offset based on median of first few beats modulo beat_interval
        target_bpm = hint_bpm if hint_bpm else derived_bpm
        beat_interval_sec = 60.0 / target_bpm
        # Project first beat onto the grid
        first_beat = beat_times[0]
        # The "downbeat offset" is just first_beat_ms if the track's intro starts cleanly
        print(f"\n>>> recommended metadata:")
        print(f"    bpm: {target_bpm:.2f}")
        print(f"    offsetMs: {int(first_beat * 1000)}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python bpm_analyze.py <mp3_path> [hint_bpm] [hint_offset_ms]")
        sys.exit(1)
    path = sys.argv[1]
    hint_bpm = float(sys.argv[2]) if len(sys.argv) > 2 else None
    hint_offset_ms = float(sys.argv[3]) if len(sys.argv) > 3 else None
    analyze(path, hint_bpm, hint_offset_ms)
