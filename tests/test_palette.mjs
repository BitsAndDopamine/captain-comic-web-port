import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { egaMode0dColor, recolorPalette } from '../web/src/palette.js';
import { Startup } from '../web/src/startup.js';

const json = file => JSON.parse(readFileSync(new URL(`../web/assets/${file}.json`, import.meta.url)));
const palette = json('palette'), victory = json('mechanics').victory;

test('all 64 register values use the original 200-line RGBI aliasing, not 350-line RGB', () => {
  assert.equal(palette.videoMode, 13);
  for (let value = 0; value < 64; value++) {
    assert.deepEqual(egaMode0dColor(value), palette.registerColors[value]);
    assert.deepEqual(egaMode0dColor(value), egaMode0dColor(value ^ 8));
    assert.deepEqual(egaMode0dColor(value), egaMode0dColor(value ^ 32));
  }
  assert.deepEqual(egaMode0dColor(6), [170, 85, 0], 'non-intense yellow is brown');
  assert.deepEqual(egaMode0dColor(24), [85, 85, 85]);
  assert.deepEqual(egaMode0dColor(31), [255, 255, 255]);
});

test('steady gameplay colors equal BIOS mode defaults despite the EXE register aliases', () => {
  assert.notDeepEqual(palette.initialRegisters, palette.gameplayRegisters);
  assert.deepEqual(palette.initialRegisters.map(egaMode0dColor), palette.colors);
  assert.deepEqual(palette.gameplayRegisters.map(egaMode0dColor), palette.colors);
  assert.deepEqual(palette.reveal.indices, [2, 10, 12]);
  assert.deepEqual(palette.reveal.steps, victory.paletteSteps);
  assert.deepEqual(palette.reveal.indices, victory.paletteIndices);
});

test('each reveal frame remaps only its three palette indices, never alpha/opaque black', () => {
  const pixels = new Uint8ClampedArray(palette.colors.flatMap((rgb, index) => [...rgb, index === 0 ? 255 : 128]));
  for (const registers of palette.reveal.steps) {
    const frame = recolorPalette(pixels, palette.colors, palette.reveal.indices, registers);
    for (let index = 0; index < 16; index++) {
      const target = palette.reveal.indices.indexOf(index);
      assert.deepEqual([...frame.slice(index * 4, index * 4 + 3)], target < 0
        ? palette.colors[index] : egaMode0dColor(registers[target]));
      assert.equal(frame[index * 4 + 3], pixels[index * 4 + 3]);
    }
  }
  assert.deepEqual([...pixels.slice(0, 4)], [0, 0, 0, 255]);
});

test('original reveal is gray -> light gray -> white highlight -> green/red, not a crossfade', () => {
  assert.deepEqual(palette.reveal.steps.map(row => row.map(egaMode0dColor)), [
    [[85, 85, 85], [85, 85, 85], [85, 85, 85]],
    [[170, 170, 170], [170, 170, 170], [170, 170, 170]],
    [[170, 170, 170], [255, 255, 255], [255, 255, 255]],
    [[0, 170, 0], [85, 255, 85], [255, 255, 255]],
    [[0, 170, 0], [85, 255, 85], [255, 85, 85]],
  ]);
});

test('startup page changes and key gates follow the original video-call trace', () => {
  const trace = JSON.parse(readFileSync(new URL('./fixtures/video_traces.json', import.meta.url)));
  const config = json('startup'), startup = new Startup(config), tick = 1 / config.timerTicksPerSecond;
  const frames = [];
  startup.press('Enter');
  for (let time = 0; time <= trace.startup.ticks; time++) {
    if (time === 24) {
      assert.equal(startup.stage.screen, 'SYS001');
      assert.equal(startup.canAdvance, true);
      startup.press('Enter'); frames.push({ tick: time, screen: startup.stage.screen });
      startup.press('Enter');
    }
    if (time === 0 || time === 19 || time === 24) frames.push({ tick: time, screen: startup.stage.screen });
    if (time < trace.startup.ticks) startup.step(tick);
  }
  assert.deepEqual(frames, [
    { tick: 0, screen: 'SYS000' }, { tick: 19, screen: 'SYS001' },
    { tick: 24, screen: 'SYS004' }, { tick: 24, screen: 'SYS003' },
  ]);
  assert.equal(startup.stage.id, 'arrival');
  assert.deepEqual(trace.startup.events.filter(e => e.kind === 'page').map(e => e.tick), [0, 19, 24, 24]);
});
