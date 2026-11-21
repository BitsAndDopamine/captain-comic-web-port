#!/usr/bin/env python3
"""Export the original Captain Comic game files to web-friendly assets.

Reads from ../game files/ and writes to ../web/assets/:
  tiles/<AREA>.png        tile sheet (16 tiles per row, 16x16 px each, opaque)
  tiles/<AREA>.json       tile count + sheet layout
  levels/<AREA>.json      the 3 playfield strips (128x10 tile indices each)
  sprites/<NAME>.png      sprite frames side by side, 16x16 px, RGBA (mask -> alpha)
  sprites.json            frame counts for all sprites
  areas.json              per-area asset mapping parsed from COMIC.EXE + raw data blob
  world.json              decoded pickup, door, strip-link and enemy-slot records
  sprites/PLAYER*.png     original player/effect frames recovered from EXEPACK data
  palette.json            verified mode-0Dh colors, register aliases and reveal writes

Run:  python3 tools/export_web_assets.py
"""
import os
import re
import json
import glob
import numpy as np
from PIL import Image
from sprite_format import decode_sprite
from video_palette import RGBI_COLORS, palette_manifest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'game files')
OUT = os.path.join(ROOT, 'web', 'assets')

# The original 200-line mode's steady palette is the canonical RGBI palette.
EGA = RGBI_COLORS
EGA_RGB = np.array(EGA, dtype=np.uint8)


def plane_bits(buf32):
    b = np.frombuffer(buf32, dtype=np.uint8).reshape(16, 2)
    return np.hstack([(b[:, 0][:, None] >> np.arange(7, -1, -1)) & 1,
                      (b[:, 1][:, None] >> np.arange(7, -1, -1)) & 1]).astype(np.uint8)


def tile_pixels(rec):
    px = np.zeros((16, 16), np.uint8)
    for k in range(4):
        px |= plane_bits(rec[k * 32:(k + 1) * 32]) << k
    return px


def load_tiles(path):
    d = open(path, 'rb').read()
    n = (len(d) - 4) // 128
    return [tile_pixels(d[4 + i * 128:4 + (i + 1) * 128]) for i in range(n)]


def frame_pixels(fr):
    """160-byte frame -> (16x16 index array, 16x16 alpha array)."""
    return decode_sprite(fr)


def export_tiles_and_levels():
    os.makedirs(os.path.join(OUT, 'tiles'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'levels'), exist_ok=True)
    areas = []
    for f in sorted(glob.glob(os.path.join(SRC, '*.TT2'))):
        area = os.path.basename(f)[:-4]
        raw = open(f, 'rb').read()
        hdr = int.from_bytes(raw[:4], 'little')
        tiles = load_tiles(f)
        # The original collision code compares a map tile ID against the first
        # byte of the area's TT2 header; IDs greater than that cutoff are solid.
        solidity = json.load(open(os.path.join(HERE, 'solidity.json')))
        thresholds = solidity.get('thresholdByArea', {})
        if area in thresholds:
            threshold = thresholds[area]
            if raw[0] != threshold:
                raise ValueError(f'{area}: TT2 cutoff {threshold} disagrees with header byte {raw[0]}')
            solid = [1 if i > threshold else 0 for i in range(len(tiles))]
        else:
            # Preserve the old heuristic only for an area with no recovered EXE cutoff.
            solid = [1 if (t > 0).mean() >= 0.5 else 0 for t in tiles]
        print(f'  {area}: header dword={hdr}, tiles={len(tiles)}, solid={sum(solid)}'
              + (f' (EXE cutoff > {thresholds[area]})' if area in thresholds else ' (heuristic)'))
        cols = 16
        rows = (len(tiles) + cols - 1) // cols
        sheet = np.zeros((rows * 16, cols * 16), np.uint8)
        for i, t in enumerate(tiles):
            sheet[(i // cols) * 16:(i // cols + 1) * 16, (i % cols) * 16:(i % cols + 1) * 16] = t
        pal = [c for rgb in EGA for c in rgb]
        img = Image.fromarray(sheet, 'P')   # keep palette indices; don't convert from RGB
        img.putpalette(pal)
        img.save(os.path.join(OUT, 'tiles', f'{area}.png'))
        with open(os.path.join(OUT, 'tiles', f'{area}.json'), 'w') as fh:
            json.dump({'tileCount': len(tiles), 'tileSize': 16, 'cols': cols,
                       'solid': solid, 'sheet': f'assets/tiles/{area}.png'}, fh)
        strips = []
        for i in range(3):
            d = open(os.path.join(SRC, f'{area}{i}.PT'), 'rb').read()
            strips.append(list(d[4:4 + 1280]))
        with open(os.path.join(OUT, 'levels', f'{area}.json'), 'w') as fh:
            json.dump({'area': area, 'tileset': f'{area}.tt2', 'w': 128, 'h': 10,
                       'tileSize': 16, 'strips': strips}, fh)
        areas.append(area)
        print(f'{area}: {len(tiles)} tiles, 3 strips')
    return areas


def export_sprites():
    os.makedirs(os.path.join(OUT, 'sprites'), exist_ok=True)
    index = {}
    for f in sorted(glob.glob(os.path.join(SRC, '*.SHP'))):
        name = os.path.basename(f)[:-4]
        d = open(f, 'rb').read()
        n = len(d) // 160
        idx = np.zeros((16, n * 16), np.uint8)
        alpha = np.zeros((16, n * 16), np.uint8)
        for i in range(n):
            px, a = frame_pixels(d[i * 160:(i + 1) * 160])
            idx[:, i * 16:(i + 1) * 16] = px
            alpha[:, i * 16:(i + 1) * 16] = a
        rgba = np.dstack([EGA_RGB[idx], alpha])  # HxWx4
        Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 'sprites', f'{name}.png'))
        index[name] = {'frames': n, 'w': 16, 'h': 16, 'sheet': f'assets/sprites/{name}.png'}
        print(f'{name}: {n} frames')
    with open(os.path.join(OUT, 'sprites.json'), 'w') as fh:
        json.dump(index, fh, indent=1)


def export_exe_area_table():
    """Parse the per-area asset table embedded in COMIC.EXE (~0x79E0..0x8010)."""
    d = open(os.path.join(SRC, 'COMIC.EXE'), 'rb').read()
    start = d.find(b'lake.tt2')
    region = d[start:start + 1600]  # table runs up to ~0x8000 where plain strings resume
    tt2_matches = list(re.finditer(rb'(\w+)\.tt2 +', region))
    entries = []
    for i, m in enumerate(tt2_matches):
        area = m.group(1).decode()
        seg_end = tt2_matches[i + 1].start() if i + 1 < len(tt2_matches) else len(region)
        seg = region[m.start():seg_end]
        # names are padded with spaces to 13 bytes, then binary data follows
        names = re.findall(rb'(\w+\.(?:pt|shp)) +', seg)
        entries.append({
            'area': area,
            'tileset': f'{area}.tt2',
            'playfields': [n.decode() for n in names[:3] if n.endswith(b'.pt')],
            'sprites': [n.decode() for n in names[3:] if n.endswith(b'.shp')],
        })
    blob = region.hex()
    with open(os.path.join(OUT, 'areas.json'), 'w') as fh:
        json.dump({'source': 'COMIC.EXE @0x%04X' % start, 'entries': entries,
                   'rawRegionHex': blob}, fh)
    print('areas.json:', [e['area'] for e in entries])


def export_palette():
    from export_audio import unpack_exepack
    image, _ = unpack_exepack(open(os.path.join(SRC, 'COMIC.EXE'), 'rb').read())
    manifest = palette_manifest(image)
    if manifest['colors'] != [list(c) for c in EGA]:
        raise ValueError('Asset colors disagree with original steady palette')
    with open(os.path.join(OUT, 'palette.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)


def decode_sys(path):
    """SYS*.EGA = one 320x200 EGA screen. PackBits-like RLE:
    [word planeSize] then 4 planes, each a token stream until planeSize bytes:
      token < 0x80  -> literal run of `token` raw bytes
      token >= 0x80 -> run of (token & 0x7f) copies of the next byte
    (reverse-engineered from the decompressor at COMIC.EXE image offset 0xa68)
    Returns a 200x320 uint8 palette-index array."""
    with open(path, 'rb') as fh:
        d = fh.read()
    import struct
    pos = 0
    planes = []
    while pos + 2 <= len(d):
        (target,) = struct.unpack_from('<H', d, pos)
        pos += 2
        if target == 0 or target > 64000:
            break
        for k in range(4):
            out = bytearray()
            while len(out) < target and pos < len(d):
                t = d[pos]
                pos += 1
                if t < 0x80:
                    out += d[pos:pos + t]
                    pos += t
                else:
                    n = t & 0x7F
                    v = d[pos]
                    pos += 1
                    out += bytes([v]) * n
            planes.append(np.frombuffer(bytes(out[:target]), np.uint8).reshape(200, target // 200))
    px = np.zeros((200, 320), np.uint8)
    for k in range(4):
        p = planes[k]
        bits = ((p[:, :, None] >> np.arange(7, -1, -1)) & 1).reshape(200, p.shape[1] * 8)
        px[:, :bits.shape[1]] |= (bits << k).astype(np.uint8)
    return px


def components(mask):
    """Simple union-find connected components on a 2D bool mask."""
    h, w = mask.shape
    parent = list(range(h * w))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    ys, xs = np.nonzero(mask)
    for y, x in zip(ys, xs):
        i = y * w + x
        if x + 1 < w and mask[y, x + 1]:
            union(i, i + 1)
        if y + 1 < h and mask[y + 1, x]:
            union(i, i + w)
    from collections import defaultdict
    comps = defaultdict(list)
    for y, x in zip(ys, xs):
        comps[find(y * w + x)].append((x, y))
    out = []
    for pts in comps.values():
        if len(pts) < 20:
            continue
        xs_ = [p[0] for p in pts]
        ys_ = [p[1] for p in pts]
        out.append((min(xs_), min(ys_), max(xs_) - min(xs_) + 1, max(ys_) - min(ys_) + 1))
    return out


def export_sys():
    """Decode SYS*.EGA screens. Player graphics are exported from COMIC.EXE."""
    sysdir = os.path.join(OUT, 'sys')
    os.makedirs(sysdir, exist_ok=True)
    index = {}
    for f in sorted(glob.glob(os.path.join(SRC, 'SYS*.EGA'))):
        name = os.path.basename(f)[:-4]
        px = decode_sys(f)
        Image.fromarray(EGA_RGB[px]).save(os.path.join(sysdir, f'{name}.png'))
        index[name] = {'w': 320, 'h': 200, 'sheet': f'assets/sys/{name}.png'}
        print(f'{name}: decoded 320x200')
    with open(os.path.join(OUT, 'sys.json'), 'w') as fh:
        json.dump(index, fh, indent=1)


def crop_rgba(px, x, y, w, h, bg_vals=(0, 7)):
    """Crop a rect from a palette-index screen, return RGBA with bg colors transparent."""
    sub = px[y:y + h, x:x + w]
    alpha = np.where(np.isin(sub, list(bg_vals)), 0, 255).astype(np.uint8)
    return np.dstack([EGA_RGB[sub], alpha])


def export_hud_and_items():
    """Measure the dynamic HUD element geometry from SYS003 (the full in-game chrome
    screen: gray background, white frame, panel, score box, bars, life strip — drawn
    as the base image by the web port) and crop the item icons from SYS004."""
    hud = os.path.join(OUT, 'hud')
    if os.path.isdir(hud):
        import shutil
        shutil.rmtree(hud)
    os.makedirs(hud, exist_ok=True)
    sys3 = decode_sys(os.path.join(SRC, 'SYS003.EGA'))
    sys4 = decode_sys(os.path.join(SRC, 'SYS004.EGA'))
    rects = {}
    # playfield window: level content is clipped to x 7..202, y 7..168 (frame: white
    # line x5-6 left, y169-170 bottom, panel box from x220; verified against a real
    # in-game screenshot)
    rects['playfield'] = {'x': 7, 'y': 7, 'w': 196, 'h': 162}
    # score box: black rect inside the white-bordered box at the panel top (x 228..298,
    # y 12..42); red seven-segment digits at x 233.., 6px wide, 9px pitch, y 24..38
    black = sys3 == 0
    ys, xs = np.nonzero(black[14:41, 230:298])
    rects['scoreBox'] = {'x': 230 + int(xs.min()), 'y': 14 + int(ys.min()),
                         'w': int(xs.max() - xs.min() + 1), 'h': int(ys.max() - ys.min() + 1)}
    red = np.isin(sys3, [4, 12])
    # Six dynamic base-100 digits are drawn with the EXE's 8x16 font; the last
    # two "00" cells are static pixels in SYS003. Verified pixel-identical there.
    rects['scoreDigits'] = {'x': 232, 'y': 24, 'w': 8, 'h': 16,
                            'pitch': 8, 'count': 6, 'staticSuffix': '00'}
    # energy bars: red fill bbox inside each bar box (weapon ~y53..70, shield ~y81..98)
    for name, y0 in (('weaponBar', 50), ('shieldBar', 78)):
        ys, xs = np.nonzero(red[y0:y0 + 22, 246:299])
        rects[name] = {'x': 246 + int(xs.min()), 'y': y0 + int(ys.min()),
                       'w': int(xs.max() - xs.min() + 1), 'h': int(ys.max() - ys.min() + 1),
                       'segments': 6, 'unitsPerSegment': 2 if name == 'weaponBar' else 1}
        print(f'{name}: fill bbox x={rects[name]["x"]} y={rects[name]["y"]} '
              f'w={rects[name]["w"]} h={rects[name]["h"]}')
    # big black box in the lower panel = inventory display area
    ys, xs = np.nonzero(black[100:177, 230:306])
    rects['panelBox'] = {'x': 230 + int(xs.min()), 'y': 100 + int(ys.min()),
                         'w': int(xs.max() - xs.min() + 1), 'h': int(ys.max() - ys.min() + 1)}
    print('panelBox:', rects['panelBox'], 'scoreBox:', rects['scoreBox'], 'digits:', rects['scoreDigits'])
    # life icons in the bottom strip: helmet-colored (red/blue/magenta) clusters, x < 175
    strip = sys3[178:200, 0:175]
    fg = np.isin(strip, [1, 4, 5, 9, 12, 13])
    cols = np.nonzero(fg.any(axis=0))[0]
    groups = []
    cur = [cols[0]]
    for c in cols[1:]:
        if c - cur[-1] <= 3:
            cur.append(c)
        else:
            groups.append((cur[0], cur[-1])); cur = [c]
    groups.append((cur[0], cur[-1]))
    rows = np.nonzero(fg.any(axis=1))[0]
    iy0, iy1 = rows.min(), rows.max()
    # EXE 0x214b/0x217d computes whole 16x16 cell positions. Colored bounds
    # alone omit their gray border and cannot represent the dark/off graphic.
    rects['lifeIcons'] = {'x0': 48, 'y': 180, 'w': 16, 'h': 16,
                          'gap': 24, 'count': 5, 'sprite': 'LIFE_ICONS'}
    print('life icon groups:', groups, 'rows', 178 + iy0, 178 + iy1)
    # item icons from the SYS004 legend (starfield bg): 20x20 windows at grid centers,
    # keep colored (non-black, non-white/gray) pixels only
    # icon top-left corners measured from the legend grid (cols x~41/125/201, rows y~8/30/53/77)
    items = {
        'corkscrew': (38, 5), 'boots': (122, 5), 'wand': (198, 6),
        'key': (39, 29), 'lantern': (124, 27), 'cola': (200, 27),
        'gems': (38, 55), 'crown': (121, 49), 'gold': (198, 50),
        'shield': (122, 74),
    }
    keep = {1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14}  # everything except black/white/grays
    itemRects = {}
    for name, (x, y) in items.items():
        win = sys4[y:y + 18, x:x + 18]
        mask = np.isin(win, list(keep))
        sub = np.where(mask, win, 0)
        ys, xs = np.nonzero(sub)
        if len(ys) == 0:
            print(f'item {name}: EMPTY at {x},{y}')
            continue
        sub = sub[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        alpha = np.where(sub == 0, 0, 255).astype(np.uint8)
        rgba = np.dstack([EGA_RGB[sub], alpha])
        Image.fromarray(rgba, 'RGBA').save(os.path.join(hud, f'item_{name}.png'))
        itemRects[name] = {'w': int(sub.shape[1]), 'h': int(sub.shape[0]), 'img': f'assets/hud/item_{name}.png'}
        print(f'item {name}: {sub.shape[1]}x{sub.shape[0]}')
    rects['items'] = itemRects
    with open(os.path.join(OUT, 'hud.json'), 'w') as fh:
        json.dump(rects, fh, indent=1)


def main():
    os.makedirs(OUT, exist_ok=True)
    export_tiles_and_levels()
    export_sprites()
    export_exe_area_table()
    export_palette()
    export_sys()
    export_hud_and_items()
    # Original embedded player/effect/item graphics replace screenshot fallbacks.
    from export_exe_assets import main as export_exe_assets
    export_exe_assets()
    from export_audio import main as export_audio
    export_audio()
    print('done ->', OUT)


if __name__ == '__main__':
    main()
