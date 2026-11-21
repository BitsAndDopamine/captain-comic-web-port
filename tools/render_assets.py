#!/usr/bin/env python3
"""Render the original Captain Comic (1988) asset files to PNG previews.

Decodes the game's custom formats (reverse-engineered):
  *.TT2  tileset: 4-byte header + N tiles of 128 bytes (16x16 px, 4 EGA bit-planes)
  *.PT   playfield strip: 4-byte header (128x10 as two LE words) + 1280 tile indices
  *.SHP  sprite: frames of 160 bytes = 4 color planes + inverted mask (16x16)

Output goes to ../rendered/. Uses the standard EGA 16-color
palette (the game's own palette is hardcoded in COMIC.EXE), so colors may differ
slightly from the original game.

Usage: python3 tools/render_assets.py
"""
import os
import glob
import numpy as np
from PIL import Image
from sprite_format import decode_sprite

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), 'game files')   # folder with the game files
OUT = os.path.join(os.path.dirname(HERE), 'rendered')
os.makedirs(OUT, exist_ok=True)

# Standard EGA 16-color palette
EGA = np.array([
    (0, 0, 0), (0, 0, 170), (0, 170, 0), (0, 170, 170),
    (170, 0, 0), (170, 0, 170), (170, 85, 0), (170, 170, 170),
    (85, 85, 85), (85, 85, 255), (85, 255, 85), (85, 255, 255),
    (255, 85, 85), (255, 85, 255), (255, 255, 85), (255, 255, 255)], dtype=np.uint8)


def plane_bits(buf32):
    """32 bytes -> 16x16 bit matrix (row = 2 bytes, MSB = leftmost pixel)."""
    b = np.frombuffer(buf32, dtype=np.uint8).reshape(16, 2)
    return np.hstack([(b[:, 0][:, None] >> np.arange(7, -1, -1)) & 1,
                      (b[:, 1][:, None] >> np.arange(7, -1, -1)) & 1]).astype(np.uint8)


def tile_pixels(rec):
    """128-byte tile record -> 16x16 palette-index array (4 planes x 32 bytes)."""
    px = np.zeros((16, 16), np.uint8)
    for k in range(4):
        px |= plane_bits(rec[k * 32:(k + 1) * 32]) << k
    return px


def load_tiles(path):
    d = open(path, 'rb').read()
    n = (len(d) - 4) // 128
    return [tile_pixels(d[4 + i * 128:4 + (i + 1) * 128]) for i in range(n)]


def render_pt(path, tiles):
    """One .PT strip -> 2048x160 palette-index array (128x10 cells of 16x16 px)."""
    d = open(path, 'rb').read()
    arr = np.zeros((160, 2048), np.uint8)
    for r in range(10):
        for c in range(128):
            t = d[4 + r * 128 + c]
            tile = tiles[t] if t < len(tiles) else np.zeros((16, 16), np.uint8)
            arr[r * 16:(r + 1) * 16, c * 16:(c + 1) * 16] = tile
    return arr


def frame_pixels(fr):
    """160-byte sprite frame -> 16x16 index array on a black background."""
    px, alpha = decode_sprite(fr)
    px[alpha == 0] = 0
    return px


def save(arr, path, scale=1):
    if scale > 1:
        arr = np.kron(arr, np.ones((scale, scale), dtype=np.uint8))
    Image.fromarray(EGA[arr]).save(path)


def main():
    themes = sorted(set(os.path.basename(f)[:-4] for f in glob.glob(os.path.join(SRC, '*.TT2'))))
    overview = []
    for th in themes:
        tiles = load_tiles(os.path.join(SRC, th + '.TT2'))
        # tile sheet (16 per row)
        cols = 16
        rows = (len(tiles) + cols - 1) // cols
        sheet = np.zeros((rows * 16, cols * 16), np.uint8)
        for i, t in enumerate(tiles):
            sheet[(i // cols) * 16:(i // cols + 1) * 16, (i % cols) * 16:(i % cols + 1) * 16] = t
        save(sheet, os.path.join(OUT, f'tiles_{th}.png'), scale=3)
        # playfield strips + stacked composite
        strips = []
        for i in range(3):
            s = render_pt(os.path.join(SRC, f'{th}{i}.PT'), tiles)
            save(s, os.path.join(OUT, f'level_{th}{i}.png'))
            strips.append(s)
        combo = np.vstack(strips)
        save(combo, os.path.join(OUT, f'level_{th}_all.png'))
        overview.append(combo[::2, ::2])  # downscale 2x for the overview sheet
        print(f'{th}: {len(tiles)} tiles')
    Image.fromarray(np.vstack([EGA[s] for s in overview])).save(os.path.join(OUT, 'areas_overview.png'))
    # sprites
    for f in sorted(glob.glob(os.path.join(SRC, '*.SHP'))):
        name = os.path.basename(f)[:-4]
        d = open(f, 'rb').read()
        n = len(d) // 160
        arr = np.zeros((16, n * 16), np.uint8)
        for i in range(n):
            arr[:, i * 16:(i + 1) * 16] = frame_pixels(d[i * 160:(i + 1) * 160])
        save(arr, os.path.join(OUT, f'shp_{name}.png'), scale=8)
        print(f'{name}: {n} frames')
    print('done ->', OUT)


if __name__ == '__main__':
    main()
