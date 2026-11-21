#!/usr/bin/env python3
"""Verify original door/key logic with 8086 execution (optional unicorn dependency).

Rendering is skipped. Door selection and transition target selection execute from
the unpacked EXE. Original input files are read-only. Run after asset export.
"""
import hashlib
import json
import struct
from pathlib import Path

from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE
from unicorn.x86_const import (UC_X86_REG_DS, UC_X86_REG_SS, UC_X86_REG_SP,
                              UC_X86_REG_IP, UC_X86_REG_SI, UC_X86_REG_BX)
from export_audio import unpack_exepack, DATA_SEGMENT_BASE

ROOT = Path(__file__).resolve().parents[1]
DS = DATA_SEGMENT_BASE
RECORD = 0x6000


def main():
    image, _ = unpack_exepack((ROOT / 'game files/COMIC.EXE').read_bytes())
    world = json.loads((ROOT / 'web/assets/world.json').read_text())
    uc = Uc(UC_ARCH_X86, UC_MODE_16)
    uc.mem_map(0, 1024 * 1024)
    uc.mem_write(0, image)
    uc.reg_write(UC_X86_REG_DS, DS >> 4)
    uc.reg_write(UC_X86_REG_SS, 0x9000)
    uc.mem_write(DS + 0x5b52, struct.pack('<H', RECORD))
    mode = 'select'

    def hook(machine, address, _size, _data):
        if (mode == 'select' and address in (0x16f5, 0x1a95)) \
                or (mode == 'transition' and address in (0xacc, 0xc75)):
            machine.emu_stop()
        elif mode == 'transition' and address == 0x1111:
            sp = machine.reg_read(UC_X86_REG_SP)
            target, = struct.unpack('<H', machine.mem_read(0x90000 + sp, 2))
            machine.reg_write(UC_X86_REG_SP, sp + 2)
            machine.reg_write(UC_X86_REG_IP, target)

    uc.hook_add(UC_HOOK_CODE, hook)
    cases, transitions = [], []
    for area in world['areas']:
        for strip in area['strips']:
            raw = bytes.fromhex(strip['rawRecordHex'])
            uc.mem_write(DS + RECORD, raw)
            for door in strip['doors']:
                x, y = door['xUnits'], door['yUnits']
                probes = [(x - 1, y), (x, y), (x + 1, y), (x + 2, y), (x + 3, y),
                          (x + 1, y - 1), (x + 1, y + 1)]
                for px, py in probes:
                    for key in (0, 1):
                        for pressed in (0, 1):
                            for others in (0, 1):
                                mode = 'select'
                                for flag in (0x4a, 0x4b, 0x4d, 0x4e):
                                    uc.mem_write(DS + flag, bytes([others]))
                                uc.mem_write(DS + 0x4c, bytes([key]))
                                uc.mem_write(0x6d, bytes([pressed]))
                                uc.reg_write(UC_X86_REG_SI, ((px & 255) << 8) | (py & 255))
                                uc.reg_write(UC_X86_REG_SP, 0xff00)
                                uc.emu_start(0x16c3, 0x10000, count=1000)
                                end = uc.reg_read(UC_X86_REG_IP)
                                if end not in (0x16f5, 0x1a95):
                                    raise RuntimeError(f'Unexpected door-selection exit {end:04x}')
                                selected = (uc.reg_read(UC_X86_REG_BX) - RECORD - 5) // 4 \
                                    if end == 0x1a95 else -1
                                assert uc.mem_read(DS + 0x4c, 1)[0] == key
                                cases.append([area['id'], strip['strip'], px, py, key,
                                              pressed, others, selected])
                mode = 'transition'
                uc.mem_write(DS + 0x40, bytes([area['id'], strip['strip']]))
                uc.mem_write(DS + 0x4c, bytes([1]))
                uc.reg_write(UC_X86_REG_BX, RECORD + 5 + door['slot'] * 4)
                uc.reg_write(UC_X86_REG_SP, 0xff00)
                uc.emu_start(0x1a95, 0x10000, count=1000)
                end = uc.reg_read(UC_X86_REG_IP)
                if end not in (0xacc, 0xc75):
                    raise RuntimeError(f'Unexpected transition exit {end:04x}')
                target = list(uc.mem_read(DS + 0x40, 2))
                key_after = uc.mem_read(DS + 0x4c, 1)[0]
                assert target == [door['targetAreaId'], door['targetStrip']]
                assert key_after == 1
                transitions.append([area['id'], strip['strip'], door['slot'], *target, key_after])
    out = ROOT / 'tests/fixtures/door_traces.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        'source': 'Unpacked COMIC.EXE 0x16c3 and 0x1a95 executed with Unicorn; departure rendering skipped',
        'imageSha256': hashlib.sha256(image).hexdigest(),
        'caseFields': ['areaId', 'strip', 'playerXUnits', 'playerYUnits', 'hasKey',
                       'doorControlPressed', 'otherItemFlags', 'selectedDoorSlot'],
        'transitionFields': ['areaId', 'strip', 'doorSlot', 'targetAreaId', 'targetStrip', 'keyAfter'],
        'cases': cases, 'transitions': transitions,
    }, separators=(',', ':')) + '\n')
    print(f'{out}: {len(cases)} selection cases, {len(transitions)} transitions; key retained in every transition')


if __name__ == '__main__':
    main()
