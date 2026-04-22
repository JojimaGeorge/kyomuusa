#!/usr/bin/env python3
"""Convert game PNG/GIF assets to WebP in-place, backing up originals to assets/_backup/.

Excludes favicons, OGP, and apple-touch-icon (crawler/legacy compat).
PNG → lossless WebP (pixel art preserved).
GIF → animated WebP (lossless).
"""
import os
import shutil
import sys
from PIL import Image

# Copy assets dir from windows temp (avoid bash/CP932 path issues)
SRC_DIR = r'C:\Windows\Temp\webp_work\assets'
OUT_DIR = r'C:\Windows\Temp\webp_work\assets'
BACKUP_DIR = r'C:\Windows\Temp\webp_work\_backup'

EXCLUDE = {
    'favicon.png', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png',
    'favicon-192.png', 'apple-touch-icon.png', 'ogp.png', 'favicon.ico',
}

os.makedirs(BACKUP_DIR, exist_ok=True)

png_count = 0
gif_count = 0
total_before = 0
total_after = 0

for fname in sorted(os.listdir(SRC_DIR)):
    src = os.path.join(SRC_DIR, fname)
    if not os.path.isfile(src):
        continue
    if fname in EXCLUDE:
        print(f"  skip {fname} (exclude list)")
        continue
    lower = fname.lower()
    if not (lower.endswith('.png') or lower.endswith('.gif')):
        continue

    stem, ext = os.path.splitext(fname)
    webp_path = os.path.join(OUT_DIR, f"{stem}.webp")
    backup_path = os.path.join(BACKUP_DIR, fname)

    before_size = os.path.getsize(src)
    total_before += before_size

    # Backup original
    shutil.copy2(src, backup_path)

    try:
        img = Image.open(src)
        if lower.endswith('.gif') and getattr(img, 'is_animated', False):
            # Animated WebP: pass save_all=True with loop/duration preserved via PIL
            img.save(webp_path, format='WEBP', save_all=True, lossless=True,
                     method=6, loop=img.info.get('loop', 0))
            gif_count += 1
            kind = 'GIF (animated)'
        else:
            # Static PNG/GIF → lossless WebP
            if img.mode not in ('RGB', 'RGBA'):
                img = img.convert('RGBA')
            img.save(webp_path, format='WEBP', lossless=True, method=6)
            png_count += 1
            kind = 'PNG/GIF (static)'
        img.close()
    except Exception as e:
        print(f"  !! {fname} failed: {e}")
        continue

    after_size = os.path.getsize(webp_path)
    total_after += after_size
    pct = 100 * (1 - after_size / before_size) if before_size else 0
    print(f"  {kind:20s} {fname:40s} {before_size/1024:8.1f}KB → {after_size/1024:7.1f}KB  ({pct:+.0f}%)")

    # Remove the original from working assets (originals are in backup)
    os.remove(src)

print(f"\nConverted: {png_count} PNG + {gif_count} GIF")
print(f"Before: {total_before/1024/1024:.2f} MB")
print(f"After : {total_after/1024/1024:.2f} MB")
print(f"Saved : {(total_before-total_after)/1024/1024:.2f} MB ({100*(1-total_after/total_before):.0f}%)")
