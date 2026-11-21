#!/usr/bin/env python3
"""Original pickup/death oracles. Optional unicorn; original files are read-only.

Only video blits, waits and sound hardware are stubbed. Pickup handlers, enemy
AI/contact guard, score/life awards, death timing and strip reset execute as-is.
"""
import hashlib
import json
import struct
from pathlib import Path

from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE, UC_HOOK_INTR
from unicorn.x86_const import (UC_X86_REG_AX, UC_X86_REG_BX, UC_X86_REG_CX, UC_X86_REG_DS,
                              UC_X86_REG_ES, UC_X86_REG_IP, UC_X86_REG_SI, UC_X86_REG_SS, UC_X86_REG_SP)
from export_audio import unpack_exepack, DATA_SEGMENT_BASE as DS

ROOT = Path(__file__).resolve().parents[1]
SOUNDS = {0xd311: 'contactDeath', 0xd41f: 'death', 0xd3c5: 'gameOver',
          0xd491: 'damage', 0xd4a1: 'pickup', 0xd4b5: 'extraLife'}


class Oracle:
    def __init__(self, image):
        self.image = image
        self.uc = Uc(UC_ARCH_X86, UC_MODE_16)
        self.uc.mem_map(0, 1024 * 1024)
        self.uc.hook_add(UC_HOOK_CODE, self.code)
        self.uc.hook_add(UC_HOOK_INTR, self.interrupt)

    def write(self, address, values): self.uc.mem_write(DS + address, bytes(values))
    def byte(self, address): return self.uc.mem_read(DS + address, 1)[0]
    def word(self, address, value): self.write(address, struct.pack('<H', value))

    def reset(self, area, strip, pickup):
        self.uc.mem_write(0, self.image)
        for register, value in [(UC_X86_REG_DS, DS >> 4), (UC_X86_REG_ES, DS >> 4),
                                (UC_X86_REG_SS, 0x9000), (UC_X86_REG_SP, 0xff00)]: self.uc.reg_write(register, value)
        self.write(0x40, [area, strip])
        self.write(0x46, [4, 0, 4, 7, 5, 1, 1, 1, 1, 2])
        self.write(0x50, bytes(0x36))
        self.word(0x5b52, 0x2100)
        self.write(0x2100, [pickup, 12, 14] + [255] * 14 + [0] * 8)
        self.write(0xd3f2, [2, 1, 1, 3, 254, 1, 3, 0, 5, 4, 2, 0, 1])
        self.write(0xd440, [80, 26, 0, 1])
        self.write(0xd490, [1])
        self.write(0x3e, [255])
        self.write(0x42, [12, 14])
        self.word(0x44, 3)
        self.word(0x75b3, (64 << 8) | 12)
        self.tick, self.waits, self.sounds = 0, [], []
        self.exits = {0x181a}

    def state(self):
        s8 = lambda n: n - 256 if n > 127 else n
        score = list(self.uc.mem_read(DS + 0x50, 4))
        slots = bytes(self.uc.mem_read(DS + 0x5b54, 48))
        return {
            'score': (score[0] + score[1] * 100 + score[2] * 10000) * 100, 'carry': score[3],
            'spares': self.byte(0x46), 'shield': self.byte(0x47), 'colas': self.byte(0x48),
            'weapon': self.byte(0x49), 'boots': self.byte(0x4a),
            'tools': list(self.uc.mem_read(DS + 0x4b, 4)), 'treasures': self.byte(0x4f),
            'position': list(self.uc.mem_read(DS + 0x42, 2)), 'camera': self.byte(0x44),
            'airborne': self.byte(0xd3f3), 'momentum': s8(self.byte(0xd3f5)),
            'velocity': s8(self.byte(0xd3f6)), 'ceilingPush': self.byte(0xd3f7),
            'boostCounter': self.byte(0xd3f8), 'facing': self.byte(0xd3fa),
            'pose': self.byte(0xd3fb), 'animationPhase': self.byte(0xd3f2),
            'refill': self.byte(0xd3fc), 'victoryCounter': self.byte(0xd3fd),
            'weaponClock': self.byte(0xd3fe), 'pickupPhase': self.byte(0xd490),
            'collected': self.byte(0x54 + self.byte(0x40) + 16 * self.byte(0x41)),
            'enemies': [[slots[i + n] if n not in (2, 3) else s8(slots[i + n])
                         for n in (0, 1, 2, 3, 4, 9, 10, 11)] for i in range(0, 48, 12)],
            'shared': list(self.uc.mem_read(DS + 0xd440, 2)),
        }

    def ret(self):
        sp = self.uc.reg_read(UC_X86_REG_SP)
        target = struct.unpack('<H', self.uc.mem_read(0x90000 + sp, 2))[0]
        self.uc.reg_write(UC_X86_REG_SP, sp + 2)
        self.uc.reg_write(UC_X86_REG_IP, target)

    def code(self, _uc, address, _size, _data):
        if address in self.exits:
            self.uc.emu_stop()
        elif address in (0xe94, 0xec6, 0x17c9, 0xf0b, 0xffe, 0x238b, 0x2199, 0x2283, 0x22fd, 0x144e):
            self.ret()
        elif address == 0x5ca:
            duration = self.uc.reg_read(UC_X86_REG_AX)
            self.waits.append({'tick': self.tick, 'duration': duration, 'state': self.state()})
            self.tick += duration
            self.uc.reg_write(UC_X86_REG_AX, 0)
            self.ret()

    def interrupt(self, _uc, number, _data):
        if number != 3: raise RuntimeError(f'Unexpected interrupt {number:x}')
        self.sounds.append({'tick': self.tick, 'event': SOUNDS[self.uc.reg_read(UC_X86_REG_BX)]})

    def run(self, entry):
        self.uc.emu_start(entry, 0x10000, count=200000)
        if self.uc.reg_read(UC_X86_REG_IP) not in self.exits: raise RuntimeError('Unexpected oracle exit')


def main():
    image, _ = unpack_exepack((ROOT / 'game files/COMIC.EXE').read_bytes())
    world = json.loads((ROOT / 'web/assets/world.json').read_text())
    oracle, geometry, deaths = Oracle(image), [], []
    for area in world['areas']:
        level = json.loads((ROOT / f'web/assets/levels/{area["area"]}.json').read_text())
        solid = json.loads((ROOT / f'web/assets/tiles/{area["area"]}.json').read_text())['solid']
        for strip in area['strips']:
            p = strip['pickup']
            for dx in range(-3, 4):
                for dy in range(-2, 6):
                    for offset in (-1, 0, 1, 22, 23):
                        oracle.reset(area['id'], strip['strip'], p['id'])
                        x, y = (p['xUnits'] + dx) & 255, (p['yUnits'] + dy) & 255
                        camera = max(0, min(232, p['xUnits'] - offset))
                        oracle.write(0x2101, [p['yUnits'], p['xUnits']])
                        oracle.write(0x42, [y, x]); oracle.word(0x44, camera)
                        oracle.run(0x17de)
                        geometry.append([area['id'], strip['strip'], p['id'], p['xUnits'], p['yUnits'],
                                         x, y, camera, oracle.byte(0x54 + area['id'] + 16 * strip['strip']), oracle.byte(0xd490)])
            variants = [('enemy', 12, 0, 255), ('enemy', 12, 4, 255),
                        ('enemy', 12, 0, 7), ('enemy', 12, 4, 2),
                        ('fall', 17, 4, 255), ('fall', 18, 0, 255),
                        ('fall', 19, 4, 255), ('fall', 20, 0, 255)]
            for cause, y, spares, pickup in variants:
                oracle.reset(area['id'], strip['strip'], pickup)
                oracle.write(0x46, [spares])
                record = bytearray.fromhex(strip['rawRecordHex']); record[:3] = bytes([pickup, 12, 14])
                oracle.write(0x2100, record)
                oracle.word(0x4c44, 0x3000)
                oracle.write(0x3000, level['strips'][strip['strip']])
                oracle.write(0xc40, [max(n for n, value in enumerate(solid) if not value)])
                oracle.write(0x5b84, [d['animationSteps'] for d in area['sprites']] + [0] * (4 - len(area['sprites'])))
                slots = []
                for n, slot in enumerate(strip['enemySlots']):
                    desc = next(d for d in area['sprites'] if d['slot'] == slot['spriteSlot'])
                    ex, ey = [(14, 12), (20, 8), (28, 10), (16, 12)][n]
                    slots += [ey, ex, 0, 0, 1 if n == 0 else 0, desc['animationSteps'], 4,
                              0, 0, 8 if n == 0 else 1, 0, 0 if n == 0 else 1]
                oracle.write(0x5b54, slots)
                oracle.write(0x42, [y, 14])
                oracle.uc.reg_write(UC_X86_REG_SI, (14 << 8) | y)
                oracle.uc.mem_write(0x9ff00, struct.pack('<H', 0x1b5a))
                initial = oracle.state()
                oracle.exits = {0x161f, 0x1436}
                oracle.run(0x1248 if cause == 'enemy' else 0x181b)
                deaths.append({'area': area['area'], 'strip': strip['strip'], 'cause': cause,
                               'pickup': pickup, 'initial': initial, 'waits': oracle.waits,
                               'sounds': oracle.sounds, 'ticks': oracle.tick, 'final': oracle.state(),
                               'gameOver': oracle.uc.reg_read(UC_X86_REG_IP) == 0x1436})
    path = ROOT / 'tests/fixtures/pickups_death_traces.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'source': 'Original unpacked COMIC.EXE pickup/death/enemy/reset instructions',
                                'imageSha256': hashlib.sha256(image).hexdigest(),
                                'geometry': geometry, 'deaths': deaths}, separators=(',', ':')) + '\n')
    print(f'{len(geometry)} pickup cases; {len(deaths)} death/reset traces -> {path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
