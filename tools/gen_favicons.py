#!/usr/bin/env python3
"""Generate favicon PNGs from source favicon.png in various sizes.
Outputs: favicon-16.png, favicon-32.png, favicon-48.png, favicon-192.png, apple-touch-icon.png (180x180)
Also writes favicon.ico (multi-size).
"""
import os, sys
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)  # game/
src = os.path.join(root, 'favicon.png')
im = Image.open(src).convert('RGBA')
print(f"source: {src}  size={im.size}  mode={im.mode}")

sizes = [
    ('favicon-16.png', 16),
    ('favicon-32.png', 32),
    ('favicon-48.png', 48),
    ('favicon-192.png', 192),
    ('apple-touch-icon.png', 180),
]
for name, size in sizes:
    out_path = os.path.join(root, name)
    # Square crop from center, then resize
    w, h = im.size
    short = min(w, h)
    left = (w - short) // 2
    top = (h - short) // 2
    sq = im.crop((left, top, left + short, top + short))
    # Use LANCZOS for pixel-art friendly but smooth downscale (NEAREST preserves dot aesthetic if needed)
    # For favicons, BILINEAR keeps readable at tiny sizes; use LANCZOS for best quality
    resized = sq.resize((size, size), Image.LANCZOS)
    resized.save(out_path)
    print(f"wrote {name} ({size}x{size})")

# Multi-size ICO (favicon.ico)
ico_path = os.path.join(root, 'favicon.ico')
w, h = im.size
short = min(w, h)
left = (w - short) // 2
top = (h - short) // 2
sq = im.crop((left, top, left + short, top + short))
sq.save(ico_path, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
print(f"wrote favicon.ico (16/32/48)")
