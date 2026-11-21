#!/usr/bin/env python3
"""Unpack Captain Comic's EXEPACKed COMIC.EXE and export its PC-speaker cues.

The original has no external sound files. Sound is generated from PIT channel 2
period/duration pairs in the executable, selected by the INT 3 sound service.
This script exports those confirmed sequences as 16-bit mono WAV files plus a
JSON manifest (including the original note data) for the web port.
"""

from __future__ import annotations

import json
import math
import struct
import wave
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXE_PATH = ROOT / "game files" / "COMIC.EXE"
OUT_DIR = ROOT / "web" / "assets" / "audio"

# The EXEPACKed program initializes DS to 0x0274. The pointers passed to its
# INT 3 sound service are offsets within that segment.
DATA_SEGMENT_BASE = 0x2740
PIT_HZ = 1_193_182
TICK_HZ = PIT_HZ / 65_536
SAMPLE_RATE = 22_050
AMPLITUDE = 9_000

# Each entry is a unique table submitted to the executable's sound service
# (AL=1). Call sites are offsets in the unpacked image. Priority is CL at the call.
SOUND_TABLES = [
    ("intro_theme", "Opening theme", 0x0084, [0x0448, 0x14E2]),
    ("sound_02", "Door departure/arrival", 0xD2E9, [0x10D3, 0x1144]),
    ("sound_03", "Contact-death explosion", 0xD311, [0x1252]),
    ("sound_04", "Wand teleport shift", 0xD339, [0x1346]),
    ("sound_05", "Victory score tally", 0xD359, [0x149A, 0x14BE]),
    ("sound_06", "Teleport disappearance/arrival", 0xD365, [0x1542, 0x15CA]),
    ("sound_07", "Game Over", 0xD3C5, [0x1435]),
    ("sound_08", "Connected strip change", 0xD3FF, [0x1A91]),
    ("sound_09", "Death/life-loss pause", 0xD41F, [0x1860]),
    ("sound_10", "Fireball fired", 0xD46E, [0x2035]),
    ("sound_11", "Fireball hits enemy", 0xD47A, [0x212C]),
    ("sound_12", "Extra-life award (including at cap)", 0xD4B5, [0x2139]),
    ("sound_13", "Shield damage", 0xD491, [0x2206]),
    ("sound_14", "Pickup collected", 0xD4A1, [0x2506]),
]

SOUND_EVENTS = {
    "intro": {"soundId": "intro_theme", "priority": 4},
    "door": {"soundId": "sound_02", "priority": 4},
    "contactDeath": {"soundId": "sound_03", "priority": 4},
    "teleportShift": {"soundId": "sound_04", "priority": 2},
    "victoryTally": {"soundId": "sound_05", "priority": 3},
    "teleport": {"soundId": "sound_06", "priority": 4},
    "gameOver": {"soundId": "sound_07", "priority": 2},
    "stripChange": {"soundId": "sound_08", "priority": 4},
    "death": {"soundId": "sound_09", "priority": 4},
    "fire": {"soundId": "sound_10", "priority": 0},
    "enemyHit": {"soundId": "sound_11", "priority": 1},
    "extraLife": {"soundId": "sound_12", "priority": 4},
    "damage": {"soundId": "sound_13", "priority": 2},
    "pickup": {"soundId": "sound_14", "priority": 3},
}


def unpack_exepack(exe: bytes) -> tuple[bytes, int]:
    """Return the uncompressed image and EXEPACK header file offset."""
    if exe[:2] != b"MZ":
        raise ValueError("COMIC.EXE is not an MZ executable")

    header_paragraphs, = struct.unpack_from("<H", exe, 0x08)
    cs, = struct.unpack_from("<H", exe, 0x16)
    exepack_offset = (header_paragraphs + cs) * 16
    if exepack_offset + 18 > len(exe):
        raise ValueError("EXEPACK header lies outside COMIC.EXE")

    fields = struct.unpack_from("<9H", exe, exepack_offset)
    real_ip, real_cs, _mem_start, packed_size, _sp, _ss, dest_paras, skip, sig = fields
    if sig != 0x4252 and skip != 0x4252:
        raise ValueError("COMIC.EXE does not have the expected EXEPACK signature")
    if not packed_size or not dest_paras:
        raise ValueError("Invalid EXEPACK sizes")
    if (real_ip, real_cs) != (0x008E, 0):
        raise ValueError(f"Unexpected unpacked entry point {real_cs:04x}:{real_ip:04x}")

    packed_start = header_paragraphs * 16
    reversed_stream = exe[packed_start:exepack_offset][::-1]
    pos = 0
    while pos < len(reversed_stream) and reversed_stream[pos] == 0xFF:
        pos += 1

    decoded_reversed = bytearray()
    terminated = False
    while pos + 3 <= len(reversed_stream):
        opcode = reversed_stream[pos]
        pos += 1
        count = (reversed_stream[pos] << 8) | reversed_stream[pos + 1]
        pos += 2
        if (opcode & 0xFE) == 0xB0:
            if pos >= len(reversed_stream):
                raise ValueError("Truncated EXEPACK run")
            decoded_reversed.extend(bytes((reversed_stream[pos],)) * count)
            pos += 1
        elif (opcode & 0xFE) == 0xB2:
            if pos + count > len(reversed_stream):
                raise ValueError("Truncated EXEPACK literal")
            decoded_reversed.extend(reversed_stream[pos:pos + count])
            pos += count
        else:
            raise ValueError(f"Unknown EXEPACK opcode 0x{opcode:02x}")

        if opcode & 1:
            terminated = True
            break

    if not terminated:
        raise ValueError("EXEPACK stream has no end marker")

    # The bytes left in the reversed packed stream are the uncompressed tail.
    decoded_reversed.extend(reversed_stream[pos:])
    image = bytes(decoded_reversed[::-1])
    expected_size = dest_paras * 16
    if len(image) > expected_size:
        raise ValueError("EXEPACK output exceeds its declared size")
    image += bytes(expected_size - len(image))
    return image, exepack_offset


def read_note_table(image: bytes, ds_offset: int) -> tuple[int, list[tuple[int, int]]]:
    image_offset = DATA_SEGMENT_BASE + ds_offset
    notes = []
    pos = image_offset
    while pos + 4 <= len(image):
        divisor, ticks = struct.unpack_from("<HH", image, pos)
        if divisor == 0:
            if not notes:
                raise ValueError(f"Empty sound table at DS:{ds_offset:04x}")
            return image_offset, notes
        if ticks == 0:
            raise ValueError(f"Zero-duration note in table at DS:{ds_offset:04x}")
        notes.append((divisor, ticks))
        pos += 4
    raise ValueError(f"Unterminated sound table at DS:{ds_offset:04x}")


def render_wav(path: Path, notes: list[tuple[int, int]]) -> float:
    """Render PIT square-wave notes as browser-playable PCM WAV."""
    sample_count = sum(round(ticks * SAMPLE_RATE / TICK_HZ) for _, ticks in notes)
    samples = bytearray()
    for divisor, ticks in notes:
        frequency = PIT_HZ / divisor
        count = round(ticks * SAMPLE_RATE / TICK_HZ)
        phase = 0.0
        for _ in range(count):
            value = AMPLITUDE if phase < 0.5 else -AMPLITUDE
            samples.extend(struct.pack("<h", value))
            phase += frequency / SAMPLE_RATE
            phase -= math.floor(phase)

    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(samples)
    return sample_count / SAMPLE_RATE


def packed_file_hits(exe: bytes, notes: list[tuple[int, int]]) -> list[int]:
    """Find any directly contiguous copy of this table in the packed EXE."""
    table = b"".join(struct.pack("<HH", *note) for note in notes) + b"\0\0"
    hits = []
    offset = 0
    while True:
        offset = exe.find(table, offset)
        if offset < 0:
            return hits
        hits.append(offset)
        offset += 1


def validate_sound_call_sites(image: bytes) -> None:
    """Ensure the pointer list covers every direct INT 3 play request."""
    expected = {
        (site, ds_offset)
        for _sound_id, _label, ds_offset, sites in SOUND_TABLES
        for site in sites
    }
    discovered = set()
    # The unpacked main program occupies this range; later INT 3 bytes are data.
    for site in range(0x008E, 0x2700):
        if image[site] != 0xCC:
            continue
        before = image[max(0, site - 12):site]
        if b"\xB8\x01\x00" not in before:  # mov ax,1 = play sequence
            continue
        lea = before.rfind(b"\x8D\x1E")  # lea bx,[DS:table]
        if lea >= 0:
            ds_offset, = struct.unpack_from("<H", before, lea + 2)
            discovered.add((site, ds_offset))
    if discovered != expected:
        missing = sorted(expected - discovered)
        extra = sorted(discovered - expected)
        raise ValueError(f"Sound call-site inventory mismatch; missing={missing}, extra={extra}")


def main() -> None:
    exe = EXE_PATH.read_bytes()
    image, exepack_offset = unpack_exepack(exe)
    if image[4:17] != b"Captain Comic":
        raise ValueError("Unpacked image did not pass the Captain Comic text check")
    validate_sound_call_sites(image)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "format": "WAV PCM, mono, signed 16-bit little-endian",
        "sampleRate": SAMPLE_RATE,
        "events": SOUND_EVENTS,
        "channelPolicy": "One PC-speaker channel; lower priority is ignored; equal/higher priority replaces the current cue (image 0x086f).",
        "source": {
            "file": "game files/COMIC.EXE",
            "fileSize": len(exe),
            "compression": "Microsoft EXEPACK",
            "exepackHeaderFileOffset": f"0x{exepack_offset:04x}",
            "unpackedImageSize": len(image),
            "soundDriver": "PC speaker via PIT channel 2 (ports 0x43/0x42, gate 0x61)",
            "soundDataSegmentBase": f"0x{DATA_SEGMENT_BASE:04x}",
            "pitClockHz": PIT_HZ,
            "timerTickHz": round(TICK_HZ, 6),
        },
        "sounds": [],
    }

    for sound_id, label, ds_offset, call_sites in SOUND_TABLES:
        event, binding = next((name, b) for name, b in SOUND_EVENTS.items() if b['soundId'] == sound_id)
        for site in call_sites:
            expected_priority = bytes((0xb9, binding['priority'], 0))
            if expected_priority not in image[site - 12:site]:
                raise ValueError(f'{sound_id}: unexpected CL priority at image {site:04x}')
        image_offset, notes = read_note_table(image, ds_offset)
        filename = f"{sound_id}.wav"
        seconds = render_wav(OUT_DIR / filename, notes)
        raw_offsets = packed_file_hits(exe, notes)
        manifest["sounds"].append({
            "id": sound_id,
            "label": label,
            "event": event,
            "priority": binding['priority'],
            "file": filename,
            "durationSeconds": round(seconds, 4),
            "noteCount": len(notes),
            "source": {
                "dataSegmentOffset": f"0x{ds_offset:04x}",
                "unpackedImageOffset": f"0x{image_offset:05x}",
                "playCallImageOffsets": [f"0x{x:04x}" for x in call_sites],
                "contiguousPackedFileOffsets": [f"0x{x:04x}" for x in raw_offsets],
            },
            "notes": [
                {
                    "pitDivisor": divisor,
                    "durationTicks": ticks,
                    "frequencyHz": round(PIT_HZ / divisor, 3),
                }
                for divisor, ticks in notes
            ],
        })

    manifest_path = OUT_DIR / "sounds.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(manifest['sounds'])} sounds to {OUT_DIR}")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
