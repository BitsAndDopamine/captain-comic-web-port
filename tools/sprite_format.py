"""Original DOS sprite layout, verified against COMIC.EXE's blitter at 0x0f8f."""

import numpy as np


def decode_sprite(record, height=16):
    """Return palette indices and alpha for a 16-pixel-wide masked sprite.

    Four color planes precede an AND mask. Mask bit 1 preserves the background;
    bit 0 clears it before ORing the color planes. Opaque black is significant.
    Records are 160 bytes at height 16 and 320 bytes at height 32.
    """
    if len(record) != height * 2 * 5:
        raise ValueError(f'Expected {height * 10} sprite bytes, got {len(record)}')
    bits = np.unpackbits(np.frombuffer(record, dtype=np.uint8)).reshape(5, height, 16)
    pixels = np.zeros((height, 16), dtype=np.uint8)
    for plane in range(4):
        pixels |= bits[plane] << plane
    # The game uses (background & mask) | color. These assets have zero color
    # bits wherever the mask preserves the background, so ordinary RGBA is exact.
    if np.any((bits[4] != 0) & (pixels != 0)):
        raise ValueError('Sprite has color bits outside the opaque mask')
    return pixels, (1 - bits[4]) * 255
