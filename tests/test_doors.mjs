import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { doorAtPlayer, doorArrival, doorAnimationFrame, drawDoorOpening } from '../web/src/doors.js';

const world = JSON.parse(readFileSync(new URL('../web/assets/world.json', import.meta.url)));
const sprites = JSON.parse(readFileSync(new URL('../web/assets/sprites.json', import.meta.url)));
const sprite = sprites.PLAYER;
const forest = world.areas.find(a => a.area === 'FOREST');
const lastDoor = forest.strips[2].doors[0];
const mechanics = JSON.parse(readFileSync(new URL('../web/assets/mechanics.json', import.meta.url)));

test('last Forest door recognizes a player standing naturally on its platform', () => {
  // Platform is at y=128; the existing 15px hitbox settles at y=113, not y=96.
  const player = { x: 1914, y: 128 - 15, w: 12, h: 15 };
  assert.equal(doorAtPlayer(player, sprite, forest.strips[2].doors, true), lastDoor);
  assert.equal(doorAtPlayer(player, sprite, forest.strips[2].doors, false), null);
  assert.equal(doorAtPlayer({ ...player, y: player.y - 16 }, sprite,
    forest.strips[2].doors, true), null);
  assert.equal(doorAtPlayer({ ...player, x: player.x + 64 }, sprite,
    forest.strips[2].doors, true), null);
});

test('last Forest door arrives on the Lake platform without sinking into it', () => {
  const lake = world.areas[lastDoor.targetAreaId];
  const reciprocal = lake.strips[lastDoor.targetStrip].doors.find(d =>
    d.targetAreaId === forest.id && d.targetStrip === 2);
  const player = { w: 12, h: 15 };
  const arrival = doorArrival(player, sprite, reciprocal);
  assert.equal(lake.area, 'LAKE');
  assert.equal(arrival.y + player.h, 112); // Original doorY=80 + sprite height=32.
  assert.equal(doorAtPlayer({ ...player, ...arrival }, sprite, [reciprocal], true), reciprocal);
});

test('all 36 door arrival coordinates round-trip through the hitbox conversion', () => {
  let count = 0;
  for (const area of world.areas) for (const strip of area.strips) {
    for (const door of strip.doors) {
      const player = { w: 12, h: 15 };
      Object.assign(player, doorArrival(player, sprite, door));
      assert.equal(doorAtPlayer(player, sprite, [door], true), door);
      count++;
    }
  }
  assert.equal(count, 36);
});

test('original Door Key is reusable and unlocks every linked door', () => {
  assert.equal(mechanics.doors.requiredItem, 'key');
  assert.equal(mechanics.doors.keyConsumedOnUse, false);
  assert.equal(mechanics.doors.perDoorKeyTypes, false);
  for (const area of world.areas) for (const strip of area.strips) for (const door of strip.doors) {
    const player = { w: 12, h: 15 };
    Object.assign(player, doorArrival(player, sprite, door));
    assert.equal(doorAtPlayer(player, sprite, [door], false), null);
    assert.equal(doorAtPlayer(player, sprite, [door], true), door);
  }
});

test('door/key decisions match original executable traces, regardless of other item flags', () => {
  const traces = JSON.parse(readFileSync(new URL('./fixtures/door_traces.json', import.meta.url)));
  assert.equal(traces.cases.length, 2016);
  for (const [areaId, stripId, x, y, key, pressed, others, expected] of traces.cases) {
    const doors = world.areas[areaId].strips[stripId].doors;
    const player = { x: x * 8 + 2, y: y * 8 + 17, w: 12, h: 15 };
    const actual = pressed ? doorAtPlayer(player, sprite, doors, Boolean(key)) : null;
    assert.equal(actual?.slot ?? -1, expected,
      `area=${areaId}, strip=${stripId}, pos=${x},${y}, key=${key}, pressed=${pressed}, otherItems=${others}`);
  }
  assert.equal(traces.transitions.length, 36);
  for (const [areaId, stripId, slot, targetArea, targetStrip, keyAfter] of traces.transitions) {
    const door = world.areas[areaId].strips[stripId].doors.find(d => d.slot === slot);
    assert.deepEqual([door.targetAreaId, door.targetStrip], [targetArea, targetStrip]);
    assert.equal(keyAfter, 1);
  }
});

test('departure and arrival use the recovered tick sequence', () => {
  const config = mechanics.doors;
  const state = { stage: 'departure', elapsedTicks: 0 };
  assert.equal(doorAnimationFrame(state, config).shutters, true);
  state.elapsedTicks = 1;
  assert.equal(doorAnimationFrame(state, config).shutters, false);
  state.elapsedTicks = 3;
  assert.equal(doorAnimationFrame(state, config).player, false);
  state.elapsedTicks = 4;
  assert.equal(doorAnimationFrame(state, config), null);
  state.stage = 'arrival'; state.elapsedTicks = 3;
  assert.equal(doorAnimationFrame(state, config).player, false);
  state.elapsedTicks = 4;
  assert.equal(doorAnimationFrame(state, config).opening, true);
  state.elapsedTicks = 8;
  assert.equal(doorAnimationFrame(state, config), null);
});

test('opening uses correct area tile halves inside a 32x32 doorway', () => {
  const calls = [];
  const ctx = { fillRect: (...args) => calls.push(['fill', ...args]),
    drawImage: (...args) => calls.push(['image', ...args]) };
  drawDoorOpening(ctx, { img: 'sheet', cols: 16 }, [48, 49, 48, 49],
    { x: 1904, y: 96 }, { opening: true, shutters: true }, { x: 7, y: 7 }, 1800, 0);
  assert.deepEqual(calls[0], ['fill', 111, 103, 32, 32]);
  assert.deepEqual(calls[1], ['image', 'sheet', 8, 48, 8, 16, 111, 103, 8, 16]);
  assert.deepEqual(calls[2], ['image', 'sheet', 16, 48, 8, 16, 135, 103, 8, 16]);
  assert.equal(calls.length, 5);
});
