"""Original mode-0Dh palette and the EXE's shared palette reveal routine.

320x200 EGA uses RGBI-compatible output, NOT the 350-line 64-colour mapping.
Register bits 3/5 are aliases here; bit 4 is the common intensity signal.
"""
import struct

RGBI_COLORS = [
    (0, 0, 0), (0, 0, 170), (0, 170, 0), (0, 170, 170),
    (170, 0, 0), (170, 0, 170), (170, 85, 0), (170, 170, 170),
    (85, 85, 85), (85, 85, 255), (85, 255, 85), (85, 255, 255),
    (255, 85, 85), (255, 85, 255), (255, 255, 85), (255, 255, 255),
]
INITIAL_REGISTERS = list(range(8)) + list(range(16, 24))


def mode0d_color(register):
    return RGBI_COLORS[(register & 7) | ((register & 16) >> 1)]


def palette_routine(image, start):
    """Read this known MOV/INT10/CALL-wait routine, rejecting unknown code.

    No disassembler/emulator dependency is required for normal asset export.
    """
    at, tick, ax, bx = start, 0, 0, 0
    writes, waits = [], []
    while True:
        opcode = image[at]
        if opcode in (0xb8, 0xbb):
            value = struct.unpack_from('<H', image, at + 1)[0]
            if opcode == 0xb8: ax = value
            else: bx = value
            at += 3
        elif image[at:at + 2] == b'\xcd\x10' and ax == 0x1000:
            writes.append({'tick': tick, 'index': bx & 255, 'value': bx >> 8})
            at += 2
        elif opcode == 0xe8:
            target = at + 3 + struct.unpack_from('<h', image, at + 1)[0]
            if target != 0x5ca or ax != 1: raise ValueError('Unexpected palette wait')
            waits.append({'tick': tick, 'duration': ax})
            tick += ax
            ax = 0
            at += 3
        elif opcode == 0xc3:
            return {'writes': writes, 'waits': waits, 'ticks': tick}
        else:
            raise ValueError(f'Unexpected palette instruction at {at:#x}')


def palette_manifest(image):
    blank = palette_routine(image, 0x052a)
    reveal = palette_routine(image, 0x0543)
    indices = [row['index'] for row in blank['writes']]
    if indices != [2, 10, 12] or len(reveal['waits']) != 5:
        raise ValueError('Unexpected original palette sequence')
    registers = INITIAL_REGISTERS.copy()
    for row in blank['writes']: registers[row['index']] = row['value']
    blank_registers = registers.copy()
    steps = []
    for tick in range(reveal['ticks']):
        for row in reveal['writes']:
            if row['tick'] == tick: registers[row['index']] = row['value']
        steps.append([registers[index] for index in indices])
    return {
        'note': 'Original BIOS mode 0Dh (320x200) RGBI-compatible palette; EXE palette writes verified.',
        'videoMode': 13, 'output': '200-line RGBI',
        'colors': [list(mode0d_color(value)) for value in registers],
        'registerColors': [list(mode0d_color(value)) for value in range(64)],
        'initialRegisters': INITIAL_REGISTERS, 'gameplayRegisters': registers,
        'blankRegisters': blank_registers,
        'reveal': {'indices': indices, 'steps': steps, 'ticksPerStep': 1,
                   'screens': ['SYS000', 'SYS001', 'SYS002'],
                   'blankRoutineImageOffset': '0x052a', 'routineImageOffset': '0x0543',
                   'writes': reveal['writes'], 'waits': reveal['waits']},
        'sources': [
            'COMIC.EXE: mode 0Dh at 0x042a; palette blank/reveal at 0x052a/0x0543.',
            'DOSBox Staging src/ints/int10_modes.cpp: mode 0Dh uses palette.cga64, not palette.ega.',
            'https://github.com/dosbox-staging/dosbox-staging/blob/main/src/ints/int10_modes.cpp',
        ],
    }
