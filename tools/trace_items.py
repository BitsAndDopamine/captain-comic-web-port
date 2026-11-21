#!/usr/bin/env python3
"""Execute original Wand target and Lantern blanking code (optional unicorn).

Run after the web exporter. No original files are modified. The resulting fixture
lets normal Node tests check the port without requiring an emulator dependency.
"""
import hashlib
import json
import struct
from pathlib import Path

from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS, UC_X86_REG_SP, UC_X86_REG_IP
from export_audio import unpack_exepack, DATA_SEGMENT_BASE

ROOT = Path(__file__).resolve().parents[1]
DS = DATA_SEGMENT_BASE


def main():
    image, _ = unpack_exepack((ROOT / 'game files/COMIC.EXE').read_bytes())
    world = json.loads((ROOT / 'web/assets/world.json').read_text())
    uc = Uc(UC_ARCH_X86, UC_MODE_16)
    uc.mem_map(0, 1024 * 1024)
    uc.mem_write(0, image)
    for register in (UC_X86_REG_DS, UC_X86_REG_ES):
        uc.reg_write(register, DS >> 4)
    uc.reg_write(UC_X86_REG_SS, 0x9000)
    mode = 'wand'

    def hook(machine, address, _size, _data):
        if (mode == 'wand' and address == 0x1346) or (mode == 'lantern' and address == 0xb2f):
            machine.emu_stop()

    uc.hook_add(UC_HOOK_CODE, hook)
    cases, darkness = [], []
    for area in world['areas']:
        levels = json.loads((ROOT / f'web/assets/levels/{area["area"]}.json').read_text())
        tileset = (ROOT / f'game files/{area["area"]}.TT2').read_bytes()
        for lantern in (0, 1):
            mode = 'lantern'
            uc.mem_write(DS + 0x40, bytes([area['id']]))
            uc.mem_write(DS + 0x4d, bytes([lantern]))
            uc.mem_write(DS + 0xc40, tileset[:4])
            uc.mem_write(DS + 0xc44, bytes([0x55]) * 0x4000)
            uc.emu_start(0xb14, 0x10000, count=20000)
            assert uc.reg_read(UC_X86_REG_IP) == 0xb2f
            dark = bytes(uc.mem_read(DS + 0xc44, 0x4000)) == bytes(0x4000)
            assert bytes(uc.mem_read(DS + 0xc40, 4)) == tileset[:4]
            darkness.append([area['id'], lantern, dark])
        mode = 'wand'
        uc.mem_write(DS + 0xc40, tileset[:4])
        uc.mem_write(DS + 0x4c44, struct.pack('<H', 0x3000))
        for strip in range(3):
            uc.mem_write(DS + 0x3000, bytes(levels['strips'][strip]))
            for camera in (0, 3, 120, 128, 220, 232):
                for relative in (0, 5, 6, 11, 16, 17, 22):
                    x = camera + relative
                    for facing in (-1, 1):
                        uc.mem_write(DS + 0x42, bytes([12, x]))
                        uc.mem_write(DS + 0x44, struct.pack('<H', camera))
                        uc.mem_write(DS + 0xd3fa, bytes([0 if facing > 0 else 5]))
                        uc.reg_write(UC_X86_REG_SP, 0xff00)
                        uc.emu_start(0x1298, 0x10000, count=5000)
                        assert uc.reg_read(UC_X86_REG_IP) == 0x1346
                        y_out, x_out = uc.mem_read(DS + 0xd2d3, 2)
                        shift = uc.mem_read(DS + 0xd2d7, 1)[0]
                        direction, = struct.unpack('<h', uc.mem_read(DS + 0xd2d8, 2))
                        cases.append([area['id'], strip, x, 12, camera, facing,
                                      x_out, y_out, shift, direction])
    path = ROOT / 'tests/fixtures/item_traces.json'
    path.write_text(json.dumps({
        'source': 'Unpacked COMIC.EXE Wand 0x1298 and darkness branch 0x0b14 executed with Unicorn',
        'imageSha256': hashlib.sha256(image).hexdigest(),
        'wandCaseFields': ['area', 'strip', 'xUnits', 'yUnits', 'camera', 'facing',
                           'targetXUnits', 'targetYUnits', 'cameraShift', 'direction'],
        'wand': cases, 'darknessFields': ['area', 'hasLantern', 'terrainBlanked'], 'darkness': darkness,
    }, separators=(',', ':')) + '\n')
    print(f'{path}: {len(cases)} Wand cases and {len(darkness)} darkness cases')


if __name__ == '__main__':
    main()
