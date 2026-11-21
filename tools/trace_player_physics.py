#!/usr/bin/env python3
"""Execute isolated original player updates for physics research (needs unicorn).

Writes reference traces, not a replacement web physics implementation. Synthetic
terrain isolates jump/Boots/SPACE, turning, air control and collision probes.
"""
import json
import hashlib
import struct
import random
from pathlib import Path

from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_DS, UC_X86_REG_SS, UC_X86_REG_SP, UC_X86_REG_IP, UC_X86_REG_SI
from export_audio import unpack_exepack, DATA_SEGMENT_BASE

ROOT = Path(__file__).resolve().parents[1]
DS = DATA_SEGMENT_BASE


def real_map_cases(image):
    """Deterministic one-tick state matrix, including every original door arrival."""
    rng = random.Random(1988)
    cases = []
    world = json.loads((ROOT / 'web/assets/world.json').read_text())
    uc = Uc(UC_ARCH_X86, UC_MODE_16)
    uc.mem_map(0, 1024 * 1024)
    uc.mem_write(0, image)
    uc.reg_write(UC_X86_REG_DS, DS >> 4)
    uc.reg_write(UC_X86_REG_SS, 0x9000)
    uc.mem_write(DS + 0xc40, bytes([0]))
    uc.mem_write(DS + 0x4c44, struct.pack('<H', 0x3000))
    uc.mem_write(DS + 0x5b52, struct.pack('<H', 0x2000))
    uc.mem_write(DS + 0x2003, bytes([255, 255]))

    def hook(machine, address, _size, _data):
        if address in (0x176b, 0x181b): machine.emu_stop()

    uc.hook_add(UC_HOOK_CODE, hook)
    for area in world['areas']:
        level = json.loads((ROOT / f"web/assets/levels/{area['area']}.json").read_text())
        solid = json.loads((ROOT / f"web/assets/tiles/{area['area']}.json").read_text())['solid']
        for strip in area['strips']:
            tiles = bytes(solid[t] for t in level['strips'][strip['strip']])
            uc.mem_write(DS + 0x3000, tiles + bytes(128 * 21 - len(tiles)))
            starts = [(rng.randrange(255), rng.randrange(17)) for _ in range(64)]
            # Arrival is one unit right of the reciprocal door (0x1094).
            starts += [(d['xUnits'] + 1, d['yUnits']) for d in strip['doors']]
            for n, (x, y) in enumerate(starts):
                arrival = n >= 64
                state = {'xUnits': x, 'yUnits': y, 'airborne': 0 if arrival else rng.randrange(2),
                         'horizontalMomentum': 0 if arrival else rng.randrange(-5, 6),
                         'verticalVelocity': 0 if arrival else rng.randrange(-10, 24),
                         'ceilingPush': 0 if arrival else rng.randrange(2),
                         'boostCounter': rng.randrange(1, 6), 'facingBank': rng.choice([0, 5]),
                         'cameraUnits': max(0, min(232, x - 11)), 'pose': 0}
                controls = {'left': bool(rng.randrange(2)), 'right': bool(rng.randrange(2)),
                            'jump': bool(rng.randrange(2))}
                boost = rng.choice([4, 5])
                uc.mem_write(DS + 0x40, bytes([area['id']]))
                uc.mem_write(DS + 0x42, bytes([y, x]))
                uc.mem_write(DS + 0x44, struct.pack('<H', state['cameraUnits']))
                uc.mem_write(DS + 0x4a, bytes([boost]))
                flags = [state['airborne'], 0, state['horizontalMomentum'] & 255,
                         state['verticalVelocity'] & 255, state['ceilingPush'],
                         state['boostCounter'], 0, state['facingBank'], 0]
                uc.mem_write(DS + 0xd3f3, bytes(flags))
                uc.mem_write(DS + 0xd3f2, bytes([1]))
                uc.mem_write(0x68, bytes(12))
                uc.mem_write(0x6e, bytes([int(controls['jump'])]))
                uc.mem_write(0x70, bytes([int(controls['left']), int(controls['right'])]))
                uc.reg_write(UC_X86_REG_SP, 0xff00)
                uc.emu_start(0x1698, 0x10000, count=10000)
                ip = uc.reg_read(UC_X86_REG_IP)
                if ip not in (0x176b, 0x181b): raise RuntimeError(f'Unexpected exit {ip:x}')
                pos = uc.reg_read(UC_X86_REG_SI)
                flags = bytes(uc.mem_read(DS + 0xd3f3, 9))
                signed = lambda n: n - 256 if n > 127 else n
                expected = {'xUnits': pos >> 8, 'yUnits': pos & 255, 'airborne': flags[0],
                            'horizontalMomentum': signed(flags[2]), 'verticalVelocity': signed(flags[3]),
                            'ceilingPush': flags[4], 'boostCounter': flags[5], 'facingBank': flags[7],
                            'cameraUnits': struct.unpack('<H', uc.mem_read(DS + 0x44, 2))[0],
                            'pose': flags[8], 'dead': ip == 0x181b, 'transition': None}
                cases.append({'area': area['area'], 'strip': strip['strip'], 'initial': state,
                              'jumpCounter': boost, 'input': controls, 'expected': expected,
                              'doorArrival': arrival})
    return cases


def main():
    image, _ = unpack_exepack((ROOT / 'game files/COMIC.EXE').read_bytes())
    cases = []
    scenarios = [
        ('normal-held', 1, 4, 'held'), ('normal-tap', 1, 4, 'tap'),
        ('boots-held', 1, 5, 'held'), ('space-held', 2, 4, 'held'),
        ('walk-right', 1, 4, 'right'), ('turn-left', 1, 4, 'left'),
        ('jump-right-release', 1, 4, 'air-release'),
        ('running-jump-release', 1, 4, 'run-air'),
        ('side-upper-body', 1, 4, 'right'), ('side-knees', 1, 4, 'right'),
         ('ceiling-held', 1, 4, 'held'),
        ('both-ground', 1, 4, 'both'), ('both-air', 1, 4, 'both-air'),
        ('air-reverse', 1, 4, 'reverse'), ('edge-fall', 1, 4, 'right'),
        ('left-wall', 1, 4, 'left'), ('right-wall', 1, 4, 'right'),
        ('camera-left', 1, 4, 'left'), ('camera-right', 1, 4, 'right'),
        ('left-boundary', 1, 4, 'left'), ('right-boundary', 1, 4, 'right'),
        ('left-link', 1, 4, 'left'), ('right-link', 1, 4, 'right'),
        ('air-wall', 1, 4, 'run-air'),
        ('left-link-air', 1, 4, 'left'), ('right-link-air', 1, 4, 'right'),
    ]
    for name, area, boost, control in scenarios:
        uc = Uc(UC_ARCH_X86, UC_MODE_16)
        uc.mem_map(0, 1024 * 1024)
        uc.mem_write(0, image)
        uc.reg_write(UC_X86_REG_DS, DS >> 4)
        uc.reg_write(UC_X86_REG_SS, 0x9000)
        uc.mem_write(DS + 0x40, bytes([area]))
        x = 64 if control == 'left' else 14
        if name.startswith('left-'): x = 0 if name != 'left-wall' else 18
        if name.startswith('right-'): x = 254 if name != 'right-wall' else 14
        camera = max(0, min(232, x - 11)) if 'boundary' in name or 'link' in name else 3
        uc.mem_write(DS + 0x42, bytes([12, x]))
        uc.mem_write(DS + 0x44, struct.pack('<H', camera))
        uc.mem_write(DS + 0x4a, bytes([boost]))
        uc.mem_write(DS + 0xd3f3, bytes(9))
        uc.mem_write(DS + 0xd3f8, bytes([boost]))
        if name.endswith('link-air'):
            uc.mem_write(DS + 0xd3f3, bytes([1]))
            uc.mem_write(DS + 0xd3f5, bytes([251 if control == 'left' else 5]))
            uc.mem_write(DS + 0xd3fa, bytes([5 if control == 'left' else 0]))
        uc.mem_write(DS + 0xc40, bytes([0]))
        uc.mem_write(DS + 0x4c44, struct.pack('<H', 0x3000))
        uc.mem_write(DS + 0x5b52, struct.pack('<H', 0x2000))
        uc.mem_write(DS + 0x2003, bytes([0 if name.startswith('left-link') else 255,
                                              1 if name.startswith('right-link') else 255]))
        tiles = bytearray(128 * 21)
        tiles[128 * 8:] = bytes([1]) * (128 * 13)
        if name == 'side-upper-body':
            tiles[6 * 128 + 8] = 1
        if name == 'side-knees':
            tiles[7 * 128 + 8] = 1
        if name == 'ceiling-held':
            tiles[4 * 128:5 * 128] = bytes([1]) * 128
        if name == 'edge-fall':
            for r in range(8, 21): tiles[r * 128 + 9:(r + 1) * 128] = bytes(119)
        if name in ('left-wall', 'right-wall', 'air-wall'):
            for r in range(8): tiles[r * 128 + 8] = 1
        uc.mem_write(DS + 0x3000, bytes(tiles))
        uc.mem_write(0x68, bytes(12))  # No pause/door/Wand keys held.

        def hook(machine, address, _size, _data):
            if address in (0x176b, 0x181b, 0x1a7e):
                machine.emu_stop()

        uc.hook_add(UC_HOOK_CODE, hook)
        rows = []
        inputs = []
        for tick in range(32):
            jump = control in ('held', 'air-release') or (control == 'tap' and tick == 0) \
                or (control == 'run-air' and tick >= 1)
            jump = jump or control in ('both-air', 'reverse')
            left = control in ('left', 'both', 'both-air') or (control == 'reverse' and tick >= 4)
            right = control == 'right' or (control == 'air-release' and tick < 4) \
                or (control == 'run-air' and tick == 0) or control in ('both', 'both-air') \
                or (control == 'reverse' and tick < 4)
            inputs.append({'jump': jump, 'left': left, 'right': right})
            uc.mem_write(DS + 0xd3f2, bytes([tick % 3 + 1]))
            uc.mem_write(DS + 0xd3fb, bytes([0]))
            uc.mem_write(0x6e, bytes([int(jump)]))
            uc.mem_write(0x70, bytes([int(left), int(right)]))
            uc.reg_write(UC_X86_REG_SP, 0xff00)
            try:
                uc.emu_start(0x1698, 0x10000, count=10000)
            except Exception as error:
                raise RuntimeError(f'{name} tick {tick}: IP={uc.reg_read(UC_X86_REG_IP):04x}') from error
            exit_ip = uc.reg_read(UC_X86_REG_IP)
            if exit_ip not in (0x176b, 0x181b, 0x1a7e):
                raise RuntimeError('Player update did not reach expected exit')
            pos = uc.reg_read(UC_X86_REG_SI)
            uc.mem_write(DS + 0x42, struct.pack('<H', pos))
            flags = bytes(uc.mem_read(DS + 0xd3f3, 9))
            s8 = lambda value: value - 256 if value > 127 else value
            rows.append({'xUnits': pos >> 8, 'yUnits': pos & 255,
                         'airborne': flags[0], 'horizontalMomentum': s8(flags[2]),
                         'verticalVelocity': s8(flags[3]), 'ceilingPush': flags[4],
                         'boostCounter': flags[5], 'facingBank': flags[7],
                         'cameraUnits': struct.unpack('<H', uc.mem_read(DS + 0x44, 2))[0],
                         'pose': uc.mem_read(DS + 0xd3fb, 1)[0],
                         'dead': exit_ip == 0x181b,
                         'transition': name.split('-')[0] if exit_ip == 0x1a7e else None})
            if exit_ip in (0x181b, 0x1a7e): break
        cases.append({'name': name, 'areaId': area, 'jumpCounter': boost,
                      'initialXUnits': x, 'initialCameraUnits': camera,
                      'solidCells': [[i % 128, i // 128] for i, t in enumerate(tiles) if t],
                      'inputs': inputs, 'ticks': rows})
    path = ROOT / 'docs/player_physics_traces.json'
    matrix = real_map_cases(image)
    path.write_text(json.dumps({'source': 'Original unpacked COMIC.EXE player updates; synthetic and original terrain',
                                'imageSha256': hashlib.sha256(image).hexdigest(),
                                'scenarios': cases, 'realMapCases': matrix}, indent=2) + '\n')
    print(f'Real-map state matrix: {len(matrix)} cases, including all 36 door arrivals')
    for case in cases:
        print(case['name'], 'Y:', [r['yUnits'] for r in case['ticks'][:18]],
              'X:', [r['xUnits'] for r in case['ticks'][:8]])


if __name__ == '__main__':
    main()
