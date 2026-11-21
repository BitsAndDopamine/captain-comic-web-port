import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { drawTilemap } from '../web/src/tilemap.js';

test('tile zero is rendered as opaque artwork rather than skipped', () => {
  const calls = [];
  drawTilemap({ drawImage: (...args) => calls.push(args) }, {
    w: 3, h: 1, strip: [0, 17, 0], tiles: { img: 'sheet', cols: 16 },
  }, { x: 7, y: 7, w: 48 }, 0, 0);
  assert.deepEqual(calls, [
    ['sheet', 0, 0, 16, 16, 7, 7, 16, 16],
    ['sheet', 16, 16, 16, 16, 23, 7, 16, 16],
    ['sheet', 0, 0, 16, 16, 39, 7, 16, 16],
  ]);
});

test('all eight areas render zero-valued cells, including a scrolled viewport', () => {
  for (const area of ['LAKE', 'SHED', 'BASE', 'CASTLE', 'COMP', 'SPACE', 'FOREST', 'CAVE']) {
    const level = JSON.parse(readFileSync(new URL(`../web/assets/levels/${area}.json`, import.meta.url)));
    for (const strip of level.strips) for (const camera of [0, 0.2, 0.49, 0.5, 0.8, 15.8, 16.2, 21, 21.4, 1851.8, 1852]) {
      const calls = [];
      const world = { ...level, strip, tiles: { img: area, cols: 16 } };
      drawTilemap({ drawImage: (...args) => calls.push(args) }, world,
        { x: 7, y: 7, w: 196 }, camera, 0);
      const renderCamera = Math.round(camera);
      const first = Math.max(0, Math.floor(renderCamera / 16));
      const last = Math.min(level.w - 1, Math.ceil((renderCamera + 196) / 16));
      const expected = [];
      for (let r = 0; r < level.h; r++) for (let c = first; c <= last; c++) {
        if (strip[r * level.w + c] === 0) expected.push([7 + c * 16 - renderCamera, 7 + r * 16]);
      }
      assert.equal(calls.length, (last - first + 1) * level.h, area);
      assert.deepEqual(calls.filter(call => call[1] === 0 && call[2] === 0)
        .map(call => [call[5], call[6]]), expected, area);
    }
  }
});

test('fractional scrolling uses integer, exactly adjacent tile destinations on both axes', () => {
  const world = { w: 32, h: 3, strip: Array(96).fill(0), tiles: { img: 'atlas', cols: 1 } };
  for (const camera of [0.2, 0.49, 0.5, 0.8, 15.49, 15.5, 15.8, 16.2, 127.7]) {
    const calls = [];
    drawTilemap({ drawImage: (...args) => calls.push(args) }, world,
      { x: 7, y: 7, w: 196 }, camera, 0.7);
    const rows = new Map();
    for (const call of calls) {
      const [x, y, w, h] = call.slice(5);
      assert.ok([x, y, w, h].every(Number.isInteger));
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(x);
    }
    for (const xs of rows.values()) {
      for (let i = 1; i < xs.length; i++) assert.equal(xs[i] - xs[i - 1], 16);
      assert.ok(xs[0] <= 7 && xs.at(-1) + 16 >= 203, 'viewport stays covered');
    }
    assert.deepEqual([...rows.keys()], [6, 22, 38]);
  }
});
