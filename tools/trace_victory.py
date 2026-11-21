#!/usr/bin/env python3
"""Optional Unicorn oracle for the original complete victory/tally path.

Only BIOS/DOS/video blits and waits are stubbed; original scoring, life awards,
life consumption, loops, sound requests and palette calls execute unchanged.
Never writes to game files/. Run after the web exporter; requires unicorn.
"""
import hashlib
import json
import struct
from pathlib import Path

from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE, UC_HOOK_INTR
from unicorn.x86_const import (UC_X86_REG_AX, UC_X86_REG_BX, UC_X86_REG_CX,
                              UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_IP,
                              UC_X86_REG_SS, UC_X86_REG_SP)
from export_audio import unpack_exepack, DATA_SEGMENT_BASE as DS

ROOT = Path(__file__).resolve().parents[1]


def trace(image, spares, score, carry):
    uc = Uc(UC_ARCH_X86, UC_MODE_16)
    uc.mem_map(0, 1024 * 1024)
    uc.mem_write(0, image)
    uc.reg_write(UC_X86_REG_DS, DS >> 4)
    uc.reg_write(UC_X86_REG_ES, DS >> 4)
    uc.reg_write(UC_X86_REG_SS, 0x9000)
    uc.reg_write(UC_X86_REG_SP, 0xff00)
    units = score // 100
    uc.mem_write(DS + 0x46, bytes([spares, 4]))
    uc.mem_write(DS + 0x50, bytes([units % 100, (units // 100) % 100, units // 10000, carry]))
    uc.mem_write(DS + 0xd3fc, bytes([2]))
    tick = 0
    waits, sounds, palette, keys = [], [], [], []
    sound_ids = {0xd365: 'teleport', 0xd359: 'victoryTally', 0xd4b5: 'extraLife', 0x84: 'intro'}

    def state():
        low, mid, high, progress = bytes(uc.mem_read(DS + 0x50, 4))
        return {'score': (low + mid * 100 + high * 10000) * 100,
                'spares': uc.mem_read(DS + 0x46, 1)[0], 'carry': progress,
                'shield': uc.mem_read(DS + 0x47, 1)[0], 'refill': uc.mem_read(DS + 0xd3fc, 1)[0]}

    def ret():
        sp = uc.reg_read(UC_X86_REG_SP)
        address = struct.unpack('<H', uc.mem_read(0x90000 + sp, 2))[0]
        uc.reg_write(UC_X86_REG_SP, sp + 2)
        uc.reg_write(UC_X86_REG_IP, address)

    def code(_machine, address, _size, _data):
        nonlocal tick
        if address in (0xe94, 0xec6, 0x17c9, 0xf0b, 0x238b, 0x2199, 0xa52):
            ret()
        elif address == 0x5ca:
            duration = uc.reg_read(UC_X86_REG_AX)
            waits.append({'tick': tick, 'duration': duration, **state()})
            tick += duration
            uc.reg_write(UC_X86_REG_AX, 0)
            ret()
        elif address == 0x2580:
            uc.emu_stop()

    def interrupt(_machine, number, _data):
        if number == 3:
            pointer = uc.reg_read(UC_X86_REG_BX)
            sounds.append({'tick': tick, 'event': sound_ids[pointer]})
        elif number == 0x10:
            if uc.reg_read(UC_X86_REG_AX) == 0x1000:
                bx = uc.reg_read(UC_X86_REG_BX)
                palette.append({'tick': tick, 'index': bx & 255, 'value': bx >> 8})
        elif number == 0x16:
            keys.append({'tick': tick, 'ip': f'0x{uc.reg_read(UC_X86_REG_IP):04x}'})
        else:
            raise RuntimeError(f'Unexpected interrupt {number:x}')

    uc.hook_add(UC_HOOK_CODE, code)
    uc.hook_add(UC_HOOK_INTR, interrupt)
    uc.emu_start(0x1489, 0x10000, count=500000)
    if uc.reg_read(UC_X86_REG_IP) != 0x2580:
        raise RuntimeError(f'Unexpected victory exit {uc.reg_read(UC_X86_REG_IP):x}')
    return {'initial': {'spares': spares, 'score': score, 'carry': carry, 'shield': 4, 'refill': 2},
            'waits': waits, 'sounds': sounds, 'palette': palette, 'keys': keys, 'final': state()}


def main():
    image, _ = unpack_exepack((ROOT / 'game files/COMIC.EXE').read_bytes())
    cases = [trace(image, spares, score, carry) for spares in range(6)
             for score in (0, 49900, 99900, 99999000) for carry in range(5)]
    path = ROOT / 'tests/fixtures/victory_traces.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'source': 'Original unpacked COMIC.EXE 0x1489..0x1535 plus score/life routines',
                                'imageSha256': hashlib.sha256(image).hexdigest(), 'cases': cases}, indent=2) + '\n')
    print(f'{len(cases)} victory traces -> {path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
