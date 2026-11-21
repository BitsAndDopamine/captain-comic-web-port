#!/usr/bin/env python3
"""Historical screenshot-based player extraction (superseded by EXE graphics).

The original player frames have now been recovered from EXEPACKed COMIC.EXE;
see export_exe_assets.py. This older utility is retained for reference. It
reads 'screenshot first level.png' (repo root), locates the player by its magenta
visor, crops the figure, downsamples to logical EGA pixels, and writes
tools/player_src.png (RGBA; frame 0 = facing right, frame 1 = mirrored left).

The web exporter no longer uses tools/player_src.png.

Run:  python3 tools/extract_player.py
"""
import os
from collections import deque
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOT = os.path.join(ROOT, 'screenshot first level.png')
OUT = os.path.join(HERE, 'player_src.png')

EGA = np.array([(0, 0, 0), (0, 0, 170), (0, 170, 0), (0, 170, 170), (170, 0, 0), (170, 0, 170),
                (170, 85, 0), (170, 170, 170), (85, 85, 85), (85, 85, 255), (85, 255, 85),
                (85, 255, 255), (255, 85, 85), (255, 85, 255), (255, 255, 85), (255, 255, 255)], dtype=np.int32)


def main():
    im = Image.open(SHOT).convert('RGB')
    a = np.asarray(im).astype(np.int32)
    H, W = a.shape[:2]
    # map every pixel to nearest EGA color
    d = ((a[:, :, None, :] - EGA[None, None, :, :]) ** 2).sum(axis=3)
    idx = d.argmin(axis=2)
    close = d.min(axis=2) < 3000
    sx, sy = W / 320.0, H / 200.0  # screenshot = 320x200 screen scaled up

    # find the player's magenta visor (colors 5/13) inside the playfield (left 2/3)
    visor = close & np.isin(idx, [5, 13])
    visor[:, int(W * 2 / 3):] = False
    ys, xs = np.nonzero(visor)
    # cluster visor pixels, take the largest cluster
    seen = np.zeros_like(visor)
    best = []
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        q = deque([(y0, x0)])
        seen[y0, x0] = True
        pts = []
        while q:
            cy, cx = q.popleft()
            pts.append((cy, cx))
            for dy in (-2, -1, 0, 1, 2):
                for dx in (-2, -1, 0, 1, 2):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and visor[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
        if len(pts) >= 8:
            best = pts
            break  # first (topmost) large cluster in the playfield = the player
    cy = sum(p[0] for p in best) / len(best)
    cx = sum(p[1] for p in best) / len(best)
    print('visor at px', round(cx), round(cy), '-> logical', round(cx / sx, 1), round(cy / sy, 1))

    # isolate the player by saturated colors (helmet/suit), excluding the gray
    # castle wall (7/8), black sky (0), grass (2) and dirt (6) around it
    sat = {1, 4, 5, 9, 12, 13, 14, 15}
    win = np.zeros_like(close)
    win[max(0, int((cy / sy - 26) * sy)):min(H, int((cy / sy + 22) * sy)),
        max(0, int((cx / sx - 14) * sx)):min(W, int((cx / sx + 14) * sx))] = True
    sel = close & win & np.isin(idx, list(sat))
    pys, pxs = np.nonzero(sel)
    bx0, by0, bx1, by1 = pxs.min(), pys.min(), pxs.max(), pys.max()
    lw = int(round((bx1 - bx0 + 1) / sx))
    lh = int(round((by1 - by0 + 1) / sy))
    print('player bbox px x=%d..%d y=%d..%d -> logical %dx%d' % (bx0, bx1, by0, by1, lw, lh))

    # downsample to logical grid: majority EGA index per logical pixel
    grid = np.zeros((lh, lw), np.uint8)
    for ly in range(lh):
        for lx in range(lw):
            xs0 = int(bx0 + lx * sx)
            xs1 = int(bx0 + (lx + 1) * sx)
            ys0 = int(by0 + ly * sy)
            ys1 = int(by0 + (ly + 1) * sy)
            cell = idx[ys0:ys1, xs0:xs1][close[ys0:ys1, xs0:xs1]]
            if len(cell):
                grid[ly, lx] = np.bincount(cell).argmax()
    # crop to the figure only (cells whose color is in the player palette)
    cellsat = np.isin(grid, list(sat))
    ys, xs = np.nonzero(cellsat)
    grid = grid[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    lh, lw = grid.shape
    print('figure size: %dx%d' % (lw, lh))
    for ly in range(lh):
        print(''.join('%x' % grid[ly, lx] for lx in range(lw)))

    # save RGBA: black (0) and surrounding grays (7/8) = transparent;
    # frame 0 = as-is (facing right), frame 1 = mirrored
    alpha = np.where(np.isin(grid, [0, 7, 8]), 0, 255).astype(np.uint8)
    rgba = np.dstack([EGA[grid].astype(np.uint8), alpha])
    sheet = np.concatenate([rgba, rgba[:, ::-1, :]], axis=1)  # 2 frames side by side
    Image.fromarray(sheet, 'RGBA').save(OUT)
    print('wrote', OUT, sheet.shape)


if __name__ == '__main__':
    main()
