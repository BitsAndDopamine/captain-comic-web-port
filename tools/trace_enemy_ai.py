#!/usr/bin/env python3
"""Generate enemy regression oracles by executing the unpacked 8086 code.

Optional development dependency: pip install unicorn. Not needed to play/export
or run tests. Rendering and player contact are skipped; AI, terrain probes,
animation, spawn scheduling and recycling execute unmodified original code.
"""
import base64
import hashlib
import json
import random
import struct
from pathlib import Path

from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_DS, UC_X86_REG_SS, UC_X86_REG_SP, UC_X86_REG_IP
from export_audio import unpack_exepack, DATA_SEGMENT_BASE

ROOT = Path(__file__).resolve().parents[1]
DS = DATA_SEGMENT_BASE
FIELDS = ['yUnits', 'xUnits', 'dx', 'dy', 'counter', 'steps', 'behavior',
          'pointerLow', 'pointerHigh', 'state', 'bank', 'phase']


def main():
    image, _ = unpack_exepack((ROOT / 'game files/COMIC.EXE').read_bytes())
    world = json.loads((ROOT / 'web/assets/world.json').read_text())
    machine = Uc(UC_ARCH_X86, UC_MODE_16)
    machine.mem_map(0, 1024 * 1024)
    machine.mem_write(0, image)
    machine.reg_write(UC_X86_REG_DS, DS >> 4)
    machine.reg_write(UC_X86_REG_SS, 0x9000)

    def hook(uc, address, _size, _data):
        if address == 0x1ba4:
            uc.emu_stop()
        elif address == 0x1b32:  # Contact tested separately; don't run death/HUD.
            uc.reg_write(UC_X86_REG_IP, 0x1b69)
        elif address == 0xf0b:  # Return from planar EGA draw without doing I/O.
            sp = uc.reg_read(UC_X86_REG_SP)
            target, = struct.unpack('<H', uc.mem_read(0x90000 + sp, 2))
            uc.reg_write(UC_X86_REG_SP, sp + 2)
            uc.reg_write(UC_X86_REG_IP, target)

    machine.hook_add(UC_HOOK_CODE, hook)

    def run(player, camera):
        machine.mem_write(DS + 0x42, bytes([player['yUnits'], player['xUnits']]))
        machine.mem_write(DS + 0x44, bytes([camera, 0]))
        machine.mem_write(DS + 0xd3fa, bytes([0 if player['facing'] > 0 else 5]))
        machine.reg_write(UC_X86_REG_SP, 0xff00)
        machine.emu_start(0x1ac0, 0x10000, count=100000)
        if machine.reg_read(UC_X86_REG_IP) != 0x1ba4:
            raise RuntimeError('Enemy update did not return')
        return list(machine.mem_read(DS + 0x5b54, 48))

    def load(area, strip):
        level = json.loads((ROOT / f'web/assets/levels/{area["area"]}.json').read_text())
        tiles = json.loads((ROOT / f'web/assets/tiles/{area["area"]}.json').read_text())
        cutoff = max(i for i, solid in enumerate(tiles['solid']) if not solid)
        machine.mem_write(DS + 0xc40, bytes([cutoff]))
        machine.mem_write(DS + 0x4c44, struct.pack('<H', 0x3000))
        machine.mem_write(DS + 0x3000, bytes(level['strips'][strip]))
        records = bytearray()
        for slot in area['strips'][strip]['enemySlots']:
            descriptor = next(d for d in area['sprites'] if d['slot'] == slot['spriteSlot'])
            records.extend([0, 0, 0, 0, 20, descriptor['animationSteps'],
                            slot['behaviorCode'], 0, 0, 0, 0, 2 if slot['initialPhase2'] else 0])
        machine.mem_write(DS + 0x5b54, bytes(records))
        machine.mem_write(DS + 0xd440, bytes([20, 22, 0, 0]))
        return records

    rng = random.Random(1988)
    cases, schedules = [], []
    for area in world['areas']:
        for strip in range(3):
            initial = load(area, strip)
            trace = bytearray()
            for tick in range(400):
                camera = (tick * 3) % 233
                player = {'xUnits': min(254, camera + 11), 'yUnits': 12 - (tick // 40) % 8,
                          'facing': 1 if tick % 80 < 40 else -1}
                trace.extend(run(player, camera))
                trace.extend(machine.mem_read(DS + 0xd440, 3))
            schedules.append({'area': area['area'], 'strip': strip,
                              'traceBase64': base64.b64encode(trace).decode('ascii')})
            for behavior in range(1, 6):
                for _ in range(12):
                    load(area, strip)
                    x, y = rng.randrange(256), rng.randrange(19)
                    player = {'xUnits': max(0, min(254, x + rng.randrange(-16, 17))),
                              'yUnits': rng.randrange(17), 'facing': rng.choice([-1, 1])}
                    camera = max(0, min(232, x - rng.randrange(23)))
                    record = list(initial[:12])
                    record[:7] = [y, x, rng.choice([255, 0, 1]), rng.choice([249, 255, 0, 1, 7, 15, 23]),
                                  rng.randrange(4), 4, behavior]
                    record[9:] = [1, 0, rng.choice([0, 1, 2, 255])]
                    # Other slots are inactive with long delays.
                    others = bytearray(initial[12:])
                    for start in range(0, 36, 12):
                        others[start + 4] = 100
                    machine.mem_write(DS + 0x5b54, bytes(record) + bytes(others))
                    expected = run(player, camera)[:12]
                    cases.append({'area': area['area'], 'strip': strip, 'record': record,
                                  'player': player, 'camera': camera, 'expected': expected})
    out = ROOT / 'tests/fixtures/enemy_traces.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({'source': 'Unpacked COMIC.EXE 0x1ac0..0x2003 executed with Unicorn',
                               'imageSha256': hashlib.sha256(image).hexdigest(),
                               'fields': FIELDS, 'movement': cases, 'schedules': schedules}, separators=(',', ':')) + '\n')
    print(f'{out}: {len(cases)} movement cases, {len(schedules)} 400-tick schedules')


if __name__ == '__main__':
    main()
