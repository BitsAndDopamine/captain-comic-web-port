#!/usr/bin/env python3
"""Trace original startup/score-screen video calls (optional Python unicorn).

No original files are written. File loads, hardware rendering and timer waits
are stubbed; palette instructions, page-selection order and control flow run.
"""
import hashlib
import json
import struct
from pathlib import Path

from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE, UC_HOOK_INTR
from unicorn.x86_const import (UC_X86_REG_AX, UC_X86_REG_BX, UC_X86_REG_CX, UC_X86_REG_DX,
                              UC_X86_REG_DS, UC_X86_REG_IP, UC_X86_REG_SS, UC_X86_REG_SP)
from export_audio import unpack_exepack, DATA_SEGMENT_BASE as DS

ROOT = Path(__file__).resolve().parents[1]


def trace(image, entry, exit_address):
    uc = Uc(UC_ARCH_X86, UC_MODE_16)
    uc.mem_map(0, 1024 * 1024)
    uc.mem_write(0, image)
    uc.reg_write(UC_X86_REG_DS, DS >> 4)
    uc.reg_write(UC_X86_REG_SS, 0x9000)
    uc.reg_write(UC_X86_REG_SP, 0xff00)
    uc.mem_write(DS + 0x46, bytes([0]))
    tick, events = 0, []

    def ret():
        sp = uc.reg_read(UC_X86_REG_SP)
        ip = struct.unpack('<H', uc.mem_read(0x90000 + sp, 2))[0]
        uc.reg_write(UC_X86_REG_SP, sp + 2)
        uc.reg_write(UC_X86_REG_IP, ip)

    def code(_machine, address, _size, _data):
        nonlocal tick
        if address == exit_address:
            uc.emu_stop()
        elif address == 0x5ca:
            duration = uc.reg_read(UC_X86_REG_AX)
            events.append({'tick': tick, 'kind': 'wait', 'duration': duration})
            tick += duration
            uc.reg_write(UC_X86_REG_AX, 0)
            ret()
        elif address == 0xa52:
            pointer = uc.reg_read(UC_X86_REG_DX) + (uc.reg_read(UC_X86_REG_DS) << 4)
            name = bytes(uc.mem_read(pointer, 13)).split(b'\0')[0].decode('ascii')
            events.append({'tick': tick, 'kind': 'load', 'file': name})
            ret()
        elif address == 0xfbd:
            events.append({'tick': tick, 'kind': 'page', 'offset': uc.reg_read(UC_X86_REG_CX)})
            ret()
        elif address in (0xf7a, 0x2199):
            ret()

    def interrupt(_machine, number, _data):
        ax = uc.reg_read(UC_X86_REG_AX)
        if number == 0x10:
            if ax == 13:
                events.append({'tick': tick, 'kind': 'mode', 'value': ax})
            elif ax == 0x1000:
                bx = uc.reg_read(UC_X86_REG_BX)
                events.append({'tick': tick, 'kind': 'palette', 'index': bx & 255, 'value': bx >> 8})
            else: raise RuntimeError(f'Unexpected video call {ax:x}')
        elif number == 0x16:
            events.append({'tick': tick, 'kind': 'key'})
            uc.reg_write(UC_X86_REG_AX, 0x1c0d)
        elif number != 3:
            raise RuntimeError(f'Unexpected interrupt {number:x}')

    uc.hook_add(UC_HOOK_CODE, code)
    uc.hook_add(UC_HOOK_INTR, interrupt)
    uc.emu_start(entry, 0x10000, count=500000)
    if uc.reg_read(UC_X86_REG_IP) != exit_address: raise RuntimeError('Unexpected trace exit')
    return {'events': events, 'ticks': tick}


def main():
    image, _ = unpack_exepack((ROOT / 'game files/COMIC.EXE').read_bytes())
    result = {'source': 'Original unpacked COMIC.EXE startup and high-score screen setup',
              'imageSha256': hashlib.sha256(image).hexdigest(),
              'startup': trace(image, 0x042a, 0x0527),
              'highScores': trace(image, 0x2580, 0x25b7)}
    path = ROOT / 'tests/fixtures/video_traces.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2) + '\n')
    print(f'Startup: {result["startup"]["ticks"]} ticks; high-score mode reset -> {path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
