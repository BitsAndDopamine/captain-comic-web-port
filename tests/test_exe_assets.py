"""Run after exporting assets: python3 -m unittest discover -s tests."""

import json
import hashlib
import struct
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from export_audio import DATA_SEGMENT_BASE, unpack_exepack, SOUND_TABLES
from export_exe_assets import EGA, GRAPHICS, opaque_pixels
from sprite_format import decode_sprite
from video_palette import palette_manifest, mode0d_color


class SpriteTests(unittest.TestCase):
    def test_transparent_and_opaque_black_are_different(self):
        record = bytearray(160)
        record[128:] = b'\xff' * 32
        record[128] = 0x7f  # clear mask bit at (0,0): opaque black
        pixels, alpha = decode_sprite(bytes(record))
        self.assertEqual(int(pixels[0, 0]), 0)
        self.assertEqual(int(alpha[0, 0]), 255)
        self.assertEqual(int(alpha[0, 1]), 0)

    def test_plane_order_and_bit_order(self):
        record = bytearray(160)
        record[128:] = b'\xff' * 32
        for plane in range(4):
            record[plane * 32] = 0x80 >> plane
        record[128] = 0x0f
        pixels, alpha = decode_sprite(bytes(record))
        self.assertEqual(pixels[0, :4].tolist(), [1, 2, 4, 8])
        self.assertEqual(alpha[0, :4].tolist(), [255] * 4)

    def test_rejects_wrong_length(self):
        with self.assertRaises(ValueError):
            decode_sprite(bytes(159))

    def test_all_source_shp_frames_match_exports(self):
        paths = sorted((ROOT / 'game files').glob('*.SHP'))
        self.assertEqual(len(paths), 14)
        for path in paths:
            with self.subTest(sprite=path.stem):
                data = path.read_bytes()
                frames = []
                self.assertEqual(len(data) % 160, 0)
                for offset in range(0, len(data), 160):
                    pixels, alpha = decode_sprite(data[offset:offset + 160])
                    frames.append(np.dstack([EGA[pixels], alpha]))
                expected = np.concatenate(frames, axis=1)
                with Image.open(ROOT / 'web' / 'assets' / 'sprites' / f'{path.stem}.png') as image:
                    np.testing.assert_array_equal(np.asarray(image), expected)


class ExeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image, cls.header = unpack_exepack((ROOT / 'game files' / 'COMIC.EXE').read_bytes())

    def test_unpacked_image(self):
        self.assertEqual(self.header, 0x84a0)
        self.assertEqual(len(self.image), 100208)
        self.assertEqual(self.image[4:17], b'Captain Comic')
        self.assertEqual(self.image[0x0ec6:0x0eca], b'\x8d\x36\xc0\x75')

    def test_audio_event_priorities_match_executable_call_sites(self):
        audio = json.loads((ROOT / 'web' / 'assets' / 'audio' / 'sounds.json').read_text())
        self.assertEqual(len(audio['events']), 14)
        bindings = {binding['soundId']: binding for binding in audio['events'].values()}
        for sound_id, _label, _pointer, calls in SOUND_TABLES:
            for call in calls:
                priority = bindings[sound_id]['priority']
                self.assertIn(bytes([0xb9, priority, 0]), self.image[call - 12:call])
            record = next(s for s in audio['sounds'] if s['id'] == sound_id)
            self.assertTrue((ROOT / 'web' / 'assets' / 'audio' / record['file']).is_file())

    def test_startup_text_and_order_match_executable(self):
        config = json.loads((ROOT / 'web' / 'assets' / 'startup.json').read_text())
        for name, pointer in [('notice', 0x194), ('registration', 0x68a)]:
            start = DATA_SEGMENT_BASE + pointer
            end = self.image.index(0x25, start)
            decoded = bytes(b ^ 0x25 for b in self.image[start:end]).decode('cp437')
            self.assertEqual(config[name], decoded)
        self.assertEqual([s.get('screen') for s in config['stages'] if 'screen' in s],
                         ['SYS000', 'SYS001', 'SYS004', 'SYS003'])
        self.assertEqual(config['initialState']['spritePosition']['x'], 112)
        self.assertEqual(config['initialState']['spritePosition']['y'], 96)

    def test_original_embedded_graphics_match_exports(self):
        index = json.loads((ROOT / 'web' / 'assets' / 'sprites.json').read_text())
        self.assertEqual(index['FIREBALL']['frames'], 2)
        self.assertEqual((index['FIREBALL']['w'], index['FIREBALL']['h']), (16, 8))
        for name, pointer, count, height in GRAPHICS:
            with self.subTest(sprite=name):
                info = index[name]
                self.assertEqual((info['frames'], info['w'], info['h']), (count, 16, height))
                frames = []
                stride = height * 10
                for i in range(count):
                    at = DATA_SEGMENT_BASE + pointer + i * stride
                    pixels, alpha = decode_sprite(self.image[at:at + stride], height)
                    frames.append(np.dstack([EGA[pixels], alpha]))
                with Image.open(ROOT / 'web' / info['sheet']) as image:
                    np.testing.assert_array_equal(np.asarray(image), np.concatenate(frames, axis=1))

    def test_life_energy_and_capacity_graphics_match_executable(self):
        for name, pointers, width, height in [
            ('LIFE_ICONS', [0xace4, 0xb6e4], 16, 16),
            ('ENERGY_CELLS', [0xba04, 0xba44, 0xba84], 8, 16),
            ('FIREBALL_CAPACITY', [0xa384 + bank + i * 160
                                   for bank in [0, 0xa00] for i in range(9, 14)], 16, 16),
            ('GAME_OVER', [0xc6c4], 128, 48),
        ]:
            with self.subTest(asset=name):
                frames = [opaque_pixels(self.image, ptr, width, height) for ptr in pointers]
                with Image.open(ROOT / 'web' / 'assets' / 'sprites' / f'{name}.png') as img:
                    np.testing.assert_array_equal(np.asarray(img), np.concatenate(frames, axis=1))

    def test_enemy_effects_match_original_pointer_table(self):
        pointers = struct.unpack_from('<11H', self.image, DATA_SEGMENT_BASE + 0xa364)
        frames = []
        for pointer in pointers:
            start = DATA_SEGMENT_BASE + pointer
            pixels, alpha = decode_sprite(self.image[start:start + 160], 16)
            frames.append(np.dstack([EGA[pixels], alpha]))
        with Image.open(ROOT / 'web/assets/sprites/ENEMY_EFFECTS.png') as image:
            np.testing.assert_array_equal(np.asarray(image), np.concatenate(frames, axis=1))

    def test_machine_code_trace_provenance(self):
        digest = hashlib.sha256(self.image).hexdigest()
        for path in ['tests/fixtures/enemy_traces.json', 'tests/fixtures/door_traces.json',
                     'tests/fixtures/item_traces.json', 'tests/fixtures/victory_traces.json',
                     'tests/fixtures/video_traces.json', 'tests/fixtures/pickups_death_traces.json',
                     'docs/player_physics_traces.json']:
            self.assertEqual(json.loads((ROOT / path).read_text())['imageSha256'], digest)
        world = json.loads((ROOT / 'web/assets/world.json').read_text())
        self.assertEqual(world['enemySpawn']['initialScreenOffsetUnits'],
                         self.image[DATA_SEGMENT_BASE + 0xd441])
        self.assertEqual(world['enemySpawn']['firstScreenOffsetUnits'], 24)

    def test_video_palette_matches_original_bios_writes_and_startup_timing(self):
        palette = json.loads((ROOT / 'web/assets/palette.json').read_text())
        self.assertEqual(palette, palette_manifest(self.image))
        self.assertEqual(palette['colors'], [list(c) for c in EGA])
        self.assertEqual(mode0d_color(24), (85, 85, 85))
        self.assertEqual(mode0d_color(26), (85, 255, 85))
        trace = json.loads((ROOT / 'tests/fixtures/video_traces.json').read_text())
        events = trace['startup']['events']
        expected = []
        for start in [0, 19]:
            expected.extend({'tick': start, 'kind': 'palette', 'index': index, 'value': 0}
                            for index in palette['reveal']['indices'])
            expected.extend({**row, 'tick': row['tick'] + start, 'kind': 'palette'}
                            for row in palette['reveal']['writes'])
        self.assertEqual([e for e in events if e['kind'] == 'palette'], expected)
        self.assertEqual([e['tick'] for e in events if e['kind'] == 'key'], [24, 24])
        self.assertEqual(trace['startup']['ticks'], 32)
        self.assertEqual(trace['highScores']['events'], [
            {'tick': 0, 'kind': 'mode', 'value': 13},
            {'tick': 0, 'kind': 'load', 'file': 'sys005.ega'},
        ])

    def test_all_system_screens_use_the_verified_original_steady_colors(self):
        from export_web_assets import decode_sys
        for path in sorted((ROOT / 'game files').glob('SYS*.EGA')):
            expected = EGA[decode_sys(str(path))]
            with Image.open(ROOT / f'web/assets/sys/{path.stem}.png') as actual:
                np.testing.assert_array_equal(np.asarray(actual.convert('RGB')), expected)

    def test_victory_timing_and_bonus_constants_match_original(self):
        config = json.loads((ROOT / 'web/assets/mechanics.json').read_text())['victory']
        self.assertEqual(self.image[0x246d:0x2472], bytes.fromhex('c606fdd314'))
        self.assertEqual(config['countdownInitial'], self.image[0x2471])
        self.assertEqual(config['countdownTrigger'], self.image[0x1661])
        for field, offset in [('baseAwardTicks', 0x148c), ('lifeAwardTicks', 0x14b0),
                              ('lifePauseTicks', 0x14d0), ('endingHoldTicks', 0x14fc),
                              ('effectFrames', 0x1552), ('departureLeadTicks', 0x154c),
                              ('departureSettleTicks', 0x1596)]:
            self.assertEqual(config[field], struct.unpack_from('<H', self.image, offset + 1)[0], field)
        self.assertEqual(config['pointsPerTick'], self.image[0x149c] * 100)
        self.assertEqual(self.image[DATA_SEGMENT_BASE + 0xd2de:DATA_SEGMENT_BASE + 0xd2de + 11], b'sys002.ega\0')

    def test_pickup_and_death_constants_match_original(self):
        config = json.loads((ROOT / 'web/assets/mechanics.json').read_text())
        self.assertEqual(config['pickups']['horizontalDistanceExclusive'], self.image[0x24a6])
        self.assertEqual(config['pickups']['verticalOffsetsInclusive'][1] + 1, self.image[0x24af])
        self.assertEqual(config['pickups']['viewportOffsetsInclusive'][1], self.image[0x1812])
        death = config['death']
        for key, at in [('explosionFrames', 0x1253), ('fallBottomYUnits', 0x1829),
                        ('blankWaitTicks', 0x1850), ('deathWaitTicks', 0x1861),
                        ('gameOverWaitTicks', 0x123e)]:
            self.assertEqual(death[key], struct.unpack_from('<H', self.image, at + 1)[0])
        self.assertEqual(self.image[0x1888:0x188d], bytes.fromhex('c606f8d304'))
        self.assertEqual(death['resetJumpCounter'], self.image[0x188c])

    def test_single_door_key_pickup_and_original_possession_flag(self):
        world = json.loads((ROOT / 'web/assets/world.json').read_text())
        keys = [(area['area'], strip['strip'], strip['pickup']['x'], strip['pickup']['y'])
                for area in world['areas'] for strip in area['strips']
                if bytes.fromhex(strip['rawRecordHex'])[0] == 1]
        self.assertEqual(keys, [('FOREST', 2, 1280, 16)])
        # cmp byte [004c],1; mov byte [004c],1. No per-door key-ID operand.
        self.assertEqual(self.image[0x16e6:0x16eb], bytes.fromhex('803e4c0001'))
        self.assertEqual(self.image[0x23e1:0x23e6], bytes.fromhex('c6064c0001'))

    def test_remaining_item_graphics_and_flags_match_executable(self):
        mechanics = json.loads((ROOT / 'web/assets/mechanics.json').read_text())
        self.assertTrue(mechanics['playerPhysics']['verticalImplementedInWeb'])
        self.assertEqual(self.image[0x23f5:0x23fa], bytes.fromhex('c6064a0005'))
        self.assertEqual(self.image[0x2409:0x240e], bytes.fromhex('c6064d0001'))
        self.assertEqual(self.image[0x241d:0x2422], bytes.fromhex('c6064e0001'))
        pointers = struct.unpack_from('<5H', self.image, DATA_SEGMENT_BASE + 0xa37a)
        self.assertEqual(list(pointers), [0x90a0, 0x91e0, 0x9320, 0x91e0, 0x90a0])
        index = json.loads((ROOT / 'web/assets/sprites.json').read_text())
        frames = index['WAND_SHIFT']['animation']
        self.assertEqual([0x90a0 + frame * 320 for frame in frames], list(pointers))

    def test_player_physics_research_constants_and_probe_offsets(self):
        config = json.loads((ROOT / 'web/assets/mechanics.json').read_text())['playerPhysics']
        self.assertTrue(config['implementedInWeb'])
        self.assertEqual(config['normalJumpCounter'], self.image[DATA_SEGMENT_BASE + 0x4a])
        self.assertEqual(self.image[0x18b2:0x18b7], bytes.fromhex('802ef6d307'))
        self.assertEqual(self.image[0x18ef:0x18f5], bytes.fromhex('80e90280c105'))
        for offset, dy in [(0x1730, 4), (0x19e4, 3), (0x1a44, 3), (0x1982, 5)]:
            self.assertEqual(self.image[offset:offset + 2], bytes([4, dy]))
        traces = json.loads((ROOT / 'docs/player_physics_traces.json').read_text())
        cases = {case['name']: case['ticks'] for case in traces['scenarios']}
        for name, rise in [('normal-held', 56), ('normal-tap', 16),
                           ('boots-held', 72), ('space-held', 88)]:
            self.assertEqual((12 - min(row['yUnits'] for row in cases[name])) * 8, rise)
        self.assertEqual([row['xUnits'] for row in cases['turn-left'][:3]], [64, 63, 62])
        self.assertEqual(cases['side-upper-body'][0]['xUnits'], 15)
        self.assertEqual(cases['side-knees'][0]['xUnits'], 14)

    def test_original_hud_contains_unlit_life_and_energy_cells(self):
        from export_web_assets import decode_sys
        screen = EGA[decode_sys(str(ROOT / 'game files' / 'SYS003.EGA'))]
        dark_helmet = opaque_pixels(self.image, 0xb6e4, 16, 16)[:, :, :3]
        for x in [48, 72, 96, 120, 144]:
            np.testing.assert_array_equal(screen[180:196, x:x + 16], dark_helmet)
        empty_energy = opaque_pixels(self.image, 0xba04, 8, 16)[:, :, :3]
        for y in [54, 82]:
            for x in range(248, 296, 8):
                np.testing.assert_array_equal(screen[y:y + 16, x:x + 8], empty_energy)

    def test_world_source_records(self):
        world = json.loads((ROOT / 'web' / 'assets' / 'world.json').read_text())
        areas = world['areas']
        self.assertEqual(len(areas), 8)
        self.assertEqual(sum(len(s['doors']) for a in areas for s in a['strips']), 36)
        self.assertEqual(sum(len(s['enemySlots']) for a in areas for s in a['strips']), 96)
        self.assertEqual(world['initialState']['position']['x'], 112)
        self.assertEqual(world['initialState']['position']['y'], 96)
        self.assertEqual(world['enemySpawn']['firstSpawnAfterTicks'], 21)
        self.assertEqual(world['enemySpawn']['maxRegularSpawnsPerGameTick'], 1)
        self.assertEqual(world['enemySpawn']['facingRightCandidateXUnits'],
                         'cameraXUnits + screenOffsetUnits')
        self.assertEqual(world['enemySpawn']['facingLeftCandidateXUnits'],
                         'cameraXUnits + 22 - screenOffsetUnits')
        pickups = [(a['area'], s['strip'], s['pickup']) for a in areas for s in a['strips']]
        self.assertEqual(len(pickups), 24)
        key = next((area, strip, p) for area, strip, p in pickups if p['kind'] == 'key')
        self.assertEqual((key[0], key[1], key[2]['x'], key[2]['y']),
                         ('FOREST', 2, 1280, 16))
        pointers = struct.unpack_from('<8H', self.image, DATA_SEGMENT_BASE + 0x75a3)
        for area, pointer in zip(areas, pointers):
            at = 0xfdf0 + pointer
            self.assertEqual(int(area['sourceImageOffset'], 16), at)
            for s in area['strips']:
                start = at + 128 + s['strip'] * 25
                raw = self.image[start:start + 25]
                self.assertEqual(bytes.fromhex(s['rawRecordHex']), raw)
                self.assertEqual((s['pickup']['id'], s['pickup']['y'], s['pickup']['x']),
                                 (raw[0], raw[1] * 8, raw[2] * 8))
                for door in s['doors']:
                    self.assertEqual(door['targetArea'], areas[door['targetAreaId']]['area'])
                    self.assertIn(door['targetStrip'], range(3))

    def test_strip_and_door_transitions_are_linked(self):
        world = json.loads((ROOT / 'web' / 'assets' / 'world.json').read_text())
        areas = world['areas']
        for area in areas:
            for strip in area['strips']:
                if strip['leftStrip'] is not None:
                    self.assertEqual(area['strips'][strip['leftStrip']]['rightStrip'], strip['strip'])
                if strip['rightStrip'] is not None:
                    self.assertEqual(area['strips'][strip['rightStrip']]['leftStrip'], strip['strip'])
                for door in strip['doors']:
                    target = areas[door['targetAreaId']]['strips'][door['targetStrip']]
                    reciprocal = [d for d in target['doors']
                                  if d['targetAreaId'] == area['id']
                                  and d['targetStrip'] == strip['strip']]
                    self.assertEqual(len(reciprocal), 1)

    def test_score_glyphs_match_source(self):
        digits = []
        for digit in range(10):
            at = DATA_SEGMENT_BASE + 0xb784 + digit * 64
            bits = np.unpackbits(np.frombuffer(self.image[at:at + 64], np.uint8)).reshape(4, 16, 8)
            pixels = np.zeros((16, 8), np.uint8)
            for plane in range(4):
                pixels |= bits[plane] << plane
            digits.append(np.dstack([EGA[pixels], np.full((16, 8), 255, np.uint8)]))
        with Image.open(ROOT / 'web' / 'assets' / 'sprites' / 'SCORE_DIGITS.png') as image:
            self.assertEqual(image.size, (80, 16))
            np.testing.assert_array_equal(np.asarray(image), np.concatenate(digits, axis=1))

    def test_score_geometry_matches_original_hud(self):
        from export_web_assets import decode_sys
        data = json.loads((ROOT / 'web' / 'assets' / 'mechanics.json').read_text())
        rect = data['hud']['scoreDigits']
        screen = decode_sys(str(ROOT / 'game files' / 'SYS003.EGA'))
        at = DATA_SEGMENT_BASE + 0xb784
        bits = np.unpackbits(np.frombuffer(self.image[at:at + 64], np.uint8)).reshape(4, 16, 8)
        zero = sum(bits[plane] << plane for plane in range(4))
        for i in range(rect['count']):
            x, y = rect['x'] + i * rect['pitch'], rect['y']
            np.testing.assert_array_equal(screen[y:y + rect['h'], x:x + rect['w']], zero)

    def test_solidity_matches_original_headers(self):
        for path in (ROOT / 'game files').glob('*.TT2'):
            with self.subTest(area=path.stem):
                header = path.read_bytes()[0]
                tiles = json.loads((ROOT / 'web' / 'assets' / 'tiles' / f'{path.stem}.json').read_text())
                self.assertEqual(tiles['solid'], [int(i > header) for i in range(tiles['tileCount'])])

    def test_fireball_resources_start_empty(self):
        self.assertEqual(self.image[DATA_SEGMENT_BASE + 0x48], 0)  # Cola slots
        self.assertEqual(self.image[DATA_SEGMENT_BASE + 0x49], 0)  # weapon energy
        self.assertEqual(self.image[DATA_SEGMENT_BASE + 0x4b], 0)  # Corkscrew
        mechanics = json.loads((ROOT / 'web' / 'assets' / 'mechanics.json').read_text())['fireball']
        self.assertEqual(mechanics['maxCapacity'], 5)
        self.assertEqual(mechanics['maxEnergy'], 12)
        self.assertEqual(mechanics['horizontalUnitsPerTick'], 2)
        self.assertEqual(mechanics['corkscrewWavePeriodTicks'], 2)


if __name__ == '__main__':
    unittest.main()
