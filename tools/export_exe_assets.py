#!/usr/bin/env python3
"""Recover embedded graphics and world records from EXEPACKed COMIC.EXE.

Run directly or through export_web_assets.py. Never writes to game files/.
Addresses below are relative to the unpacked image, unless marked DS-relative.
"""

import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image

from export_audio import DATA_SEGMENT_BASE, unpack_exepack
from sprite_format import decode_sprite
from video_palette import RGBI_COLORS, palette_manifest

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web' / 'assets'
EGA = np.array(RGBI_COLORS, dtype=np.uint8)

ITEM_KINDS = {0: 'corkscrew', 1: 'key', 2: 'boots', 3: 'lantern',
              4: 'wand', 5: 'gems', 6: 'crown', 7: 'gold', 8: 'cola', 14: 'shield'}
# Bases/strides are proven by the player's draw routine (0x0ec6), fireball frame
# table DS:a360 + draw routine (0x20b2), death/teleport routines and pickup renderer.
GRAPHICS = [
    ('FIREBALL', 0x8240, 2, 8),
    ('PLAYER', 0x75C0, 10, 32),
    ('PLAYER_DEATH', 0x86A0, 8, 32),
    ('TELEPORT', 0x9460, 12, 32),
    ('ITEMS', 0xA384, 32, 16),
    ('WAND_SHIFT', 0x90A0, 3, 32),
]


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


def opaque_pixels(image, pointer, width, height):
    length = width * height // 8
    start = DATA_SEGMENT_BASE + pointer
    bits = np.unpackbits(np.frombuffer(image[start:start + length * 4], np.uint8))
    bits = bits.reshape(4, height, width)
    pixels = np.zeros((height, width), np.uint8)
    for plane in range(4):
        pixels |= bits[plane] << plane
    return np.dstack([EGA[pixels], np.full((height, width), 255, np.uint8)])


def export_graphics(image):
    sprites_dir = OUT / 'sprites'
    sprites_dir.mkdir(parents=True, exist_ok=True)
    index_path = OUT / 'sprites.json'
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    for name, offset, count, height in GRAPHICS:
        stride = height * 10
        start = DATA_SEGMENT_BASE + offset
        frames = []
        for frame in range(count):
            at = start + frame * stride
            pixels, alpha = decode_sprite(image[at:at + stride], height)
            frames.append(np.dstack([EGA[pixels], alpha]))
        Image.fromarray(np.concatenate(frames, axis=1)).save(sprites_dir / f'{name}.png')
        info = {'frames': count, 'w': 16, 'h': height,
                'sheet': f'assets/sprites/{name}.png',
                'source': {'file': 'COMIC.EXE', 'unpackedImageOffset': f'0x{start:05x}',
                           'dataSegmentOffset': f'0x{offset:04x}', 'frameBytes': stride}}
        if name == 'PLAYER':
            info['animations'] = {
                'right': {'idle': 0, 'walk': [1, 2, 3], 'air': 4},
                'left': {'idle': 5, 'walk': [6, 7, 8], 'air': 9},
            }
        if name == 'ITEMS':
            info['kinds'] = ITEM_KINDS
            info['alternateFrameOffset'] = 16
        if name == 'WAND_SHIFT':
            # Runtime table DS:a37a uses [0,1,2,1,0]; file stores three unique frames.
            info['animation'] = [0, 1, 2, 1, 0]
        index[name] = info
        print(f'{name}: {count} original 16x{height} frames, unpacked image 0x{start:05x}')
    # Hit/contact effects: pointer table indexed by runtime state minus two.
    pointers = struct.unpack_from('<11H', image, DATA_SEGMENT_BASE + 0xA364)
    effects = []
    for pointer in pointers:
        start = DATA_SEGMENT_BASE + pointer
        pixels, alpha = decode_sprite(image[start:start + 160], 16)
        effects.append(np.dstack([EGA[pixels], alpha]))
    Image.fromarray(np.concatenate(effects, axis=1)).save(sprites_dir / 'ENEMY_EFFECTS.png')
    index['ENEMY_EFFECTS'] = {
        'frames': 11, 'w': 16, 'h': 16, 'sheet': 'assets/sprites/ENEMY_EFFECTS.png',
        'source': {'file': 'COMIC.EXE', 'pointerTableDataSegmentOffset': '0xa364',
                   'dataSegmentOffsets': [f'0x{p:04x}' for p in pointers]},
    }
    # Score renderer 0x238b indexes ten 64-byte, 8x16 color-only glyphs.
    # These are opaque, including the black cells which erase the old numeral.
    start = DATA_SEGMENT_BASE + 0xB784
    digits = []
    for digit in range(10):
        at = start + digit * 64
        bits = np.unpackbits(np.frombuffer(image[at:at + 64], np.uint8)).reshape(4, 16, 8)
        pixels = np.zeros((16, 8), np.uint8)
        for plane in range(4):
            pixels |= bits[plane] << plane
        digits.append(np.dstack([EGA[pixels], np.full((16, 8), 255, np.uint8)]))
    Image.fromarray(np.concatenate(digits, axis=1)).save(sprites_dir / 'SCORE_DIGITS.png')
    index['SCORE_DIGITS'] = {
        'frames': 10, 'w': 8, 'h': 16, 'sheet': 'assets/sprites/SCORE_DIGITS.png',
        'source': {'file': 'COMIC.EXE', 'unpackedImageOffset': f'0x{start:05x}',
                   'dataSegmentOffset': '0xb784', 'frameBytes': 64, 'mask': False},
    }
    print(f'SCORE_DIGITS: 10 original 8x16 glyphs, unpacked image 0x{start:05x}')
    # HUD routines blit color planes directly: these cells are opaque, including
    # their gray background and dark/unlit helmet artwork.
    for name, pointers, width, height in [
        ('LIFE_ICONS', [0xACE4, 0xB6E4], 16, 16),
        ('ENERGY_CELLS', [0xBA04, 0xBA44, 0xBA84], 8, 16),
        ('FIREBALL_CAPACITY', [0xA384 + i * 160 + bank
                               for bank in [0, 0xA00] for i in range(9, 14)], 16, 16),
        ('GAME_OVER', [0xC6C4], 128, 48),
        ('PAUSE', [0xBAC4], 128, 48),
    ]:
        frames = [opaque_pixels(image, pointer, width, height) for pointer in pointers]
        Image.fromarray(np.concatenate(frames, axis=1)).save(sprites_dir / f'{name}.png')
        index[name] = {
            'frames': len(pointers), 'w': width, 'h': height,
            'sheet': f'assets/sprites/{name}.png',
            'source': {'file': 'COMIC.EXE', 'mask': False,
                       'dataSegmentOffsets': [f'0x{pointer:04x}' for pointer in pointers],
                       'unpackedImageOffsets': [f'0x{DATA_SEGMENT_BASE + pointer:05x}' for pointer in pointers]},
        }
    write_json(index_path, index)


def point(y, x):
    return {'xUnits': x, 'yUnits': y, 'x': x * 8, 'y': y * 8}


def export_world(image):
    # Loader 0x0acc reads pointers at main DS:75a3, switches source DS to 0x0fdf,
    # and copies 203 bytes to DS:74d8. Each source record is padded to 208 bytes.
    pointers = struct.unpack_from('<8H', image, DATA_SEGMENT_BASE + 0x75A3)
    source_base = 0xFDF0
    records = [image[source_base + ptr:source_base + ptr + 203] for ptr in pointers]

    def filename(data):
        return data.split(b'\0', 1)[0].rstrip(b' ').decode('ascii')

    names = [filename(record[:14]).split('.')[0].upper() for record in records]
    if names != ['LAKE', 'FOREST', 'SPACE', 'BASE', 'CAVE', 'SHED', 'CASTLE', 'COMP']:
        raise ValueError(f'Unexpected EXE area table: {names}')
    areas = []
    for area_id, (record, ptr) in enumerate(zip(records, pointers)):
        sprites = []
        for slot in range(4):
            offset = 60 + slot * 17
            count, orientation, repeats_last = record[offset:offset + 3]
            if not count:
                continue
            sprite_file = filename(record[offset + 3:offset + 17])
            if orientation not in (1, 2) or repeats_last not in (0, 1):
                raise ValueError('Unrecognized enemy sprite descriptor')
            expected_frames = count * orientation
            actual_bytes = (ROOT / 'game files' / sprite_file.upper()).stat().st_size
            if actual_bytes != expected_frames * 160:
                raise ValueError(f'{sprite_file}: frame count disagrees with descriptor')
            sprites.append({'slot': slot, 'file': sprite_file, 'cycleFrames': count,
                            'directionBanks': orientation, 'repeatPenultimate': bool(repeats_last),
                            'animationSteps': count + repeats_last})
        strips = []
        for strip_id in range(3):
            offset = 128 + strip_id * 25
            data = record[offset:offset + 25]
            kind, y, x, left, right = data[:5]
            if kind not in ITEM_KINDS:
                raise ValueError(f'Unknown item ID {kind}')
            doors = []
            for slot in range(3):
                dy, dx, destination, target_strip = data[5 + slot * 4:9 + slot * 4]
                if (dy, dx) == (255, 255):
                    continue
                if destination >= len(names) or target_strip >= 3:
                    raise ValueError('Door target outside the world')
                doors.append({'slot': slot, **point(dy, dx),
                              'targetAreaId': destination, 'targetArea': names[destination],
                              'targetStrip': target_strip})
            enemies = []
            for slot in range(4):
                sprite_slot, behavior = data[17 + slot * 2:19 + slot * 2]
                sprite = next((s for s in sprites if s['slot'] == sprite_slot), None)
                if sprite is None:
                    raise ValueError('Enemy references an absent sprite descriptor')
                enemies.append({'slot': slot, 'spriteSlot': sprite_slot, 'file': sprite['file'],
                                'behaviorCode': behavior & 0x7f,
                                'initialPhase2': bool(behavior & 0x80),
                                'rawBehaviorByte': behavior})
            strips.append({'strip': strip_id, 'sourceRecordOffset': offset,
                           'pickup': {'id': kind, 'kind': ITEM_KINDS[kind], **point(y, x)},
                           'leftStrip': None if left == 255 else left,
                           'rightStrip': None if right == 255 else right,
                           'doors': doors, 'enemySlots': enemies,
                           'rawRecordHex': data.hex()})
        areas.append({'id': area_id, 'area': names[area_id],
                      'sourceImageOffset': f'0x{source_base + ptr:05x}',
                      'tileset': filename(record[:14]),
                      'playfields': [filename(record[14 + i * 14:28 + i * 14]) for i in range(3)],
                      'transitionTiles': list(record[56:60]),
                      'sprites': sprites, 'strips': strips})

    initial_y, initial_x = image[DATA_SEGMENT_BASE + 0x75B3:DATA_SEGMENT_BASE + 0x75B5]
    world = {'source': 'COMIC.EXE, EXEPACK-decompressed image',
             'coordinateUnitPixels': 8,
             'notes': ['Enemy slots are behavior/graphics configurations, NOT fixed spawn coordinates.',
                       'Door position is the interaction coordinate; target entry is resolved by a reciprocal door.',
                       'Pickup positions are sprite top-lefts; IDs use ITEMS frame numbers.',
                        'Behavior 127 is an inactive slot that retries after 100 ticks.',
                        'High bit seeds phase=2; behaviors 1/5 then move every tick rather than every other tick.'],
             'enemySpawn': {
                 'initImageOffset': '0x0d15',
                 'updateImageOffset': '0x1ac0',
                 'spawnImageOffset': '0x1f5f',
                 'inactiveDelayTicks': 20,
                 'spawnWhenDelayUnderflows': True,
                 'firstSpawnAfterTicks': 21,
                 'maxRegularSpawnsPerGameTick': 1,
                 'spawnLockDataSegmentOffset': '0xd442',
                 'screenOffsetCycleDataSegmentOffset': '0xd441',
                 'screenOffsetStepUnits': 2,
                  'initialScreenOffsetUnits': 22,
                  'firstScreenOffsetUnits': 24,
                 'screenOffsetWrapAt': 31,
                 'screenOffsetWrapTo': 24,
                 'facingRightCandidateXUnits': 'cameraXUnits + screenOffsetUnits',
                 'facingLeftCandidateXUnits': 'cameraXUnits + 22 - screenOffsetUnits',
                 'spawnYStartUnits': '(playerYUnits & 0xfe) + 4',
                 'spawnYStepUnits': -2,
                 'spawnYRule': 'scan upward through terrain; use the first clear cell above its top surface',
                  'spawnHorizontalOverflow': 'right uses signed overflow (JO); left uses unsigned borrow (JB)',
                  'initialRespawnDelayTicks': 20,
                  'respawnDelayStepTicks': 20,
                  'respawnDelayWrapAt': 120,
                  'respawnDelayWrapTo': 20,
                  'despawnPlayerDistanceUnits': 30,
                 'specialBehavior127RetryDelayTicks': 100,
             },
             'initialState': {'areaId': 1, 'area': 'FOREST', 'strip': 0,
                              'position': point(initial_y, initial_x)},
             'areas': areas}
    write_json(OUT / 'world.json', world)
    print(f'world.json: {len(areas)} areas, 24 pickups, '
          f'{sum(len(s["doors"]) for a in areas for s in a["strips"])} doors, 96 enemy slots')


def main():
    image, _ = unpack_exepack((ROOT / 'game files' / 'COMIC.EXE').read_bytes())
    export_graphics(image)
    export_world(image)
    export_mechanics(image)
    export_startup(image)


def export_startup(image):
    """Startup screens, XOR-0x25 text, and timing recovered from the entry path."""
    def text_at(pointer):
        start = DATA_SEGMENT_BASE + pointer
        end = image.index(0x25, start)
        return bytes(value ^ 0x25 for value in image[start:end]).decode('cp437')

    position_at = DATA_SEGMENT_BASE + 0x75B3
    y, x = image[position_at:position_at + 2]
    area_id = image[DATA_SEGMENT_BASE + 0x40]
    strip = image[DATA_SEGMENT_BASE + 0x41]
    if (area_id, strip, x, y) != (1, 0, 14, 12):
        raise ValueError('Unexpected initial player state')
    reveal_ticks = len(palette_manifest(image)['reveal']['steps'])
    write_json(OUT / 'startup.json', {
        'source': 'COMIC.EXE, EXEPACK-decompressed image',
        'timerTicksPerSecond': round(1_193_182 / 65_536, 6),
        'notice': text_at(0x0194),
        'registration': text_at(0x068A),
        'textSourceImageOffsets': {'notice': '0x028d4', 'registration': '0x02dca'},
        'startupRoutineImageOffset': '0x042a',
        'initialPositionImageOffset': f'0x{position_at:05x}',
        'arrivalRoutineImageOffset': '0x159d',
        'cameraFollowOffsetPixels': 88,
        'initialState': {
            'areaId': area_id, 'area': 'FOREST', 'strip': strip,
            'spritePosition': point(y, x),
            'cameraX': max(0, min(232, x - 11)) * 8,
            'facing': 1,
        },
        'theme': 'assets/audio/intro_theme.wav',
        'stages': [
            {'id': 'notice', 'advance': 'key'},
            {'id': 'title', 'screen': 'SYS000', 'ticks': reveal_ticks + 14, 'revealTicks': reveal_ticks,
             'source': '0x0434..0x0458: 5 palette-step ticks, then 14 hold ticks'},
            {'id': 'story', 'screen': 'SYS001', 'advance': 'key', 'revealTicks': reveal_ticks,
             'keyDelayTicks': reveal_ticks,
             'source': '0x045b..0x046e; first BIOS key wait at 0x04d7'},
            {'id': 'legend', 'screen': 'SYS004', 'advance': 'key',
             'source': '0x04cd..0x04e8; second BIOS key wait at 0x04e1'},
            {'id': 'planet', 'screen': 'SYS003', 'ticks': 8,
             'source': '0x04f9..0x0527: five life-icon ticks, then three ticks'},
            {'id': 'arrival', 'waitTicks': 15, 'effect': 'TELEPORT',
             'effectFrames': 12, 'effectTicksPerFrame': 1,
             'playerVisibleFromFrame': 6, 'settleTicks': 1,
             'source': '0x159d..0x161e'},
        ],
        'notes': [
            'SYS002 is the ending/treasure-recovery screen, not a startup screen.',
            'The browser uses fixed controls instead of emulating DOS keyboard/joystick setup.',
            'Title/story/ending use the original five-step mode-0Dh palette reveal; other page changes are hard flips.',
            'The startup life-icon counter represents spare lives: animate five awards, then consume one to spawn the active player.',
        ],
    })
    print('startup.json: original notice, title/story/legend order, timings and FOREST entry')


def export_mechanics(image):
    """Record confirmed mechanics and distinguish implemented/reference fields."""
    write_json(OUT / 'mechanics.json', {
        'source': 'COMIC.EXE, EXEPACK-decompressed image',
        'note': 'Enemy AI/spawning, score, lives/HUD, item abilities and original DOS-tick player movement/terrain probes/camera are applied.',
        'victory': {
            'treasures': ['gems', 'crown', 'gold'],
            'countdownInitial': 20, 'countdownTrigger': 1,
            'triggerImageOffset': '0x246d', 'countdownImageOffset': '0x1652',
            'routineImageOffset': '0x1489', 'departureRoutineImageOffset': '0x1538',
            'timerTicksPerSecond': round(1_193_182 / 65_536, 6),
            'departureLeadTicks': 1, 'effect': 'TELEPORT', 'effectFrames': 12,
            'effectTicksPerFrame': 1, 'playerVisibleEffectFrames': 6,
            'departureSettleTicks': 6,
            'baseAwardTicks': 20, 'lifeAwardTicks': 10, 'pointsPerTick': 1000,
            'lifePauseTicks': 3, 'endingScreen': 'SYS002', 'endingHoldTicks': 20,
            'paletteIndices': palette_manifest(image)['reveal']['indices'],
            'paletteSteps': palette_manifest(image)['reveal']['steps'],
            'paletteRoutineImageOffset': '0x0543',
            'notes': [
                'Countdown starts when the third treasure is acquired; normal gameplay continues until it reaches 1.',
                'Score-earned extra lives, including capped-life bonuses, remain active during tally.',
                'Spare-life consumption does not reset shield, refill or score-carry state.',
                'Ending waits through five palette ticks and twenty hold ticks before accepting a fresh key.',
                'After the ending key, the original shows Game Over without its cue, then waits again for high scores.',
            ],
        },
        'playerPhysics': {
            'implementedInWeb': True,
            'verticalImplementedInWeb': True,
            'updateImageOffsets': ['0x1698', '0x18a4', '0x19bc', '0x1a18'],
            'coordinateUnitPixels': 8,
            'timerTicksPerSecond': round(1_193_182 / 65_536, 6),
            'spriteSizePixels': [16, 32],
            'groundStepUnits': 1,
            'turnBeforeWalking': True,
            'cameraDeadZoneUnits': [10, 12],
            'cameraMaxUnits': 232,
            'cameraInitialOffsetUnits': 11,
            'normalJumpCounter': 4,
            'bootsJumpCounter': 5,
            'heldJumpVelocitySubtract': 7,
            'verticalDisplacement': 'signed vertical velocity arithmetic-shifted right by three, in 8px units',
            'gravityPerTick': 5,
            'spaceGravityPerTick': 3,
            'verticalVelocityCap': 23,
            'horizontalMomentumCap': 5,
            'horizontalMomentumDecayPerTick': 1,
            'edgeFallInitialVerticalVelocity': 8,
            'edgeFallHorizontalMomentum': 2,
            'terrainProbesUnits': {
                'left': [-1, 3], 'right': [2, 3],
                'standingSupport': [0, 4], 'ceiling': [0, 0], 'landing': [0, 5],
                'rowProbeWidth': 2,
            },
            'contactWindowsUnits': {
                'enemy': 'abs(enemyX-playerX)<2 and 0<=enemyY-playerY<4',
                'fireball': 'abs(fireballX-enemyX)<=1 and 0<=fireballY-enemyY<=1',
            },
        },
        'items': {
            'boots': {'requiredItem': 'boots', 'pickupId': 2,
                      'normalJumpCounter': 4, 'upgradedJumpCounter': 5,
                      'pickupRoutineImageOffset': '0x23f5'},
            'lantern': {'requiredItem': 'lantern', 'pickupId': 3, 'area': 'CASTLE',
                        'areaId': 6, 'darkensTerrainOnly': True,
                        'checkRoutineImageOffset': '0x0b14'},
            'wand': {'requiredItem': 'wand', 'pickupId': 4, 'control': 'CapsLock',
                     'requiresGrounded': True, 'distanceUnits': 6,
                     'searchStartYUnits': 18, 'durationTicks': 6, 'relocateAtTick': 3,
                     'effectSprite': 'WAND_SHIFT', 'effectFrames': 5,
                     'targetRoutineImageOffset': '0x1298',
                     'animationRoutineImageOffset': '0x1348',
                     'effectPointerTableDataSegmentOffset': '0xa37a'},
        },
        'score': {
            'incrementRoutineImageOffset': '0x2343',
            'glyphRendererImageOffset': '0x238b',
            'storageDataSegmentOffsets': ['0x0050', '0x0051', '0x0052'],
            'storageRadix': 100,
            'storageOrder': 'least-significant group first',
            'displayedPointsPerStoredUnit': 100,
            'staticDisplaySuffix': '00',
            'extraLifeEveryDisplayedPoints': 50000,
            'extraLifeProgressDataSegmentOffset': '0x0053',
            'pickupDisplayedPoints': 2000,
            'projectileEnemyKillDisplayedPoints': 300,
            'atLifeCapBonusDisplayedPoints': 22500,
            'atLifeCapBonusSource': '0x215d: three calls to 0x2343 with AL=75',
        },
        'hud': {
            'scoreDigits': {'x': 232, 'y': 24, 'w': 8, 'h': 16, 'pitch': 8,
                            'count': 6, 'staticSuffix': '00', 'sprite': 'SCORE_DIGITS'},
            'lifeCap': 5,
            'shieldCap': 6,
            'weaponEnergyCap': 12,
            'fireballCapacityCap': 5,
        },
        'lives': {
            'spareLivesDataSegmentOffset': '0x0046',
            'shieldDataSegmentOffset': '0x0047',
            'initialSpareLives': 4,
            'startupAwards': 5,
            'startupConsumed': 1,
            'maxSpareLives': 5,
            'shieldCap': 6,
            'shieldRechargeTicks': 6,
            'scoreCarriesPerExtraLife': 5,
            'extraLifeEveryPoints': 50000,
            'cappedLifeBonusPartPoints': 7500,
            'fullShieldRechargePoints': 1800,
            'deathExplosionTicks': 8,
            'deathPauseTicks': 17,
            'awardRoutineImageOffset': '0x212f',
            'consumeRoutineImageOffset': '0x2172',
            'deathCheckImageOffset': '0x1867',
            'timerTicksPerSecond': round(1_193_182 / 65_536, 6),
            'icons': {'sprite': 'LIFE_ICONS', 'x0': 48, 'y': 180,
                      'gap': 24, 'count': 5, 'w': 16, 'h': 16},
            'energyCells': {'sprite': 'ENERGY_CELLS', 'x0': 248,
                            'weaponY': 54, 'shieldY': 82, 'count': 6},
            'fireballCapacity': {'sprite': 'FIREBALL_CAPACITY', 'x': 232, 'y': 112,
                                  'max': 5, 'alternateFrameOffset': 5},
            'gameOver': {'sprite': 'GAME_OVER', 'x': 40, 'y': 64},
        },
        'pickups': {
            'contactRoutineImageOffset': '0x2491', 'viewportRoutineImageOffset': '0x17de',
            'coordinateUnitPixels': 8, 'horizontalDistanceExclusive': 2,
            'verticalOffsetsInclusive': [0, 3], 'viewportOffsetsInclusive': [0, 22],
            'animationCounterDataSegmentOffset': '0xd490',
        },
        'death': {
            'contactRoutineImageOffset': '0x1248', 'fallRoutineImageOffset': '0x181b',
            'resetRoutineImageOffset': '0x1871', 'checkpointDataSegmentOffset': '0x75b3',
            'explosionFrames': 8, 'fallCropMinYUnits': 17, 'fallCropMaxYUnits': 19,
            'fallBottomYUnits': 20, 'blankWaitTicks': 2, 'deathWaitTicks': 15, 'gameOverWaitTicks': 1,
            'resetJumpCounter': 4, 'resetWeaponRechargeTicks': 2,
            'preservesCeilingPush': True, 'deathGuardDataSegmentOffset': '0xd443',
            'timerTicksPerSecond': round(1_193_182 / 65_536, 6),
        },
        'doors': {
            'requiredItem': 'key',
            'keyPickupId': 1,
            'keyFlagDataSegmentOffset': '0x004c',
            'keyConsumedOnUse': False,
            'perDoorKeyTypes': False,
            'keyCheckImageOffset': '0x16e6',
            'departureRoutineImageOffset': '0x1111',
            'arrivalRoutineImageOffset': '0x1094',
            'shutterRoutineImageOffset': '0x1179',
            'arrivalSoundDelayTicks': 3,
            'timerTicksPerSecond': round(1_193_182 / 65_536, 6),
            'departure': [
                {'ticks': 1, 'opening': True, 'shutters': True, 'player': True},
                {'ticks': 1, 'opening': True, 'shutters': False, 'player': True},
                {'ticks': 1, 'opening': True, 'shutters': True, 'player': True},
                {'ticks': 1, 'opening': False, 'shutters': False, 'player': False},
            ],
            'arrival': [
                {'ticks': 4, 'opening': False, 'shutters': False, 'player': False},
                {'ticks': 1, 'opening': True, 'shutters': True, 'player': True},
                {'ticks': 1, 'opening': True, 'shutters': False, 'player': True},
                {'ticks': 1, 'opening': True, 'shutters': True, 'player': True},
                {'ticks': 1, 'opening': False, 'shutters': False, 'player': True},
            ],
        },
        'fireball': {
            'initialCapacity': 0,
            'capacityPerCola': 1,
            'maxCapacity': 5,
            'initialEnergy': 0,
            'maxEnergy': 12,
            'energyCostPerShot': 1,
            'rechargeTicksPerEnergy': 2,
            'timerTicksPerSecond': round(1_193_182 / 65_536, 6),
            'coordinateUnitPixels': 8,
            'horizontalUnitsPerTick': 2,
            'maxCameraXUnits': 22,
            'sprite': 'FIREBALL',
            'frameCount': 2,
            'frameSize': [16, 8],
            'corkscrewItemId': 0,
            'corkscrewWavePeriodTicks': 2,
            'corkscrewVerticalOffsetUnits': 1,
        },
    })


if __name__ == '__main__':
    main()
