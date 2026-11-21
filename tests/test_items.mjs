import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { wandDestination, wandEffectFrames, terrainIsDark, drawWandEffects } from '../web/src/items.js';
import { VerticalMotion } from '../web/src/vertical_motion.js';
import { Player } from '../web/src/player.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const mechanics = json('../web/assets/mechanics.json');
const worldData = json('../web/assets/world.json');
const traces = json('./fixtures/item_traces.json');

test('Wand destinations and camera counters match original machine code across all 24 strips', () => {
  const maps = worldData.areas.map(area => ({
    level: json(`../web/assets/levels/${area.area}.json`),
    solid: json(`../web/assets/tiles/${area.area}.json`).solid,
  }));
  for (const row of traces.wand) {
    const [area, strip, x, y, camera, facing, tx, ty, shift, direction] = row;
    const map = maps[area];
    const world = { tile(c, r) { return map.solid[map.level.strips[strip][r * 128 + c]] ?? false; } };
    const result = wandDestination(world, { xUnits: x, yUnits: y, facing }, camera, mechanics.items.wand);
    assert.deepEqual(result, { from: { xUnits: x, yUnits: y }, to: { xUnits: tx, yUnits: ty }, shift, direction },
      `original Wand case ${JSON.stringify(row)}`);
  }
});

test('Lantern darkness matches original blanking branch without changing solidity', () => {
  for (const [area, lantern, dark] of traces.darkness) {
    assert.equal(terrainIsDark(worldData.areas[area].area,
      new Set(lantern ? ['lantern'] : []), mechanics.items.lantern), dark);
  }
});

test('Wand crosses intervening walls but rejects landing columns without two clear rows', () => {
  const player = { xUnits: 14, yUnits: 12, facing: 1 }, config = mechanics.items.wand;
  const wall = { tile: (c, r) => c === 9 || r >= 8 };
  assert.deepEqual(wandDestination(wall, player, 3, config).to, { xUnits: 20, yUnits: 12 });
  for (const world of [{ tile: () => false }, { tile: () => true }, { tile: (_c, r) => r !== 7 }]) {
    assert.deepEqual(wandDestination(world, player, 3, config).to, { xUnits: 14, yUnits: 12 });
  }
  const ground = { tile: (_c, r) => r >= 8 };
  assert.equal(wandDestination(ground, { ...player, xUnits: 15 }, 3, config).to.xUnits, 20);
  assert.equal(wandDestination(ground, { ...player, xUnits: 15, facing: -1 }, 3, config).to.xUnits, 8);
});

test('Wand animation uses distinct origin/destination phases and recovered mirrored frames', () => {
  const c = mechanics.items.wand;
  assert.deepEqual(Array.from({ length: 6 }, (_, n) => wandEffectFrames(n, c)), [
    { origin: 0, destination: null, atDestination: false },
    { origin: 1, destination: 0, atDestination: false },
    { origin: 2, destination: 1, atDestination: false },
    { origin: 3, destination: 2, atDestination: true },
    { origin: 4, destination: 3, atDestination: true },
    { origin: null, destination: 4, atDestination: true },
  ]);
  const sprite = { img: 'effect', w: 16, h: 32, animation: [0, 1, 2, 1, 0] };
  const calls = [];
  drawWandEffects({ drawImage: (...args) => calls.push(args) }, sprite,
    { from: { xUnits: 14, yUnits: 12 }, to: { xUnits: 20, yUnits: 8 }, renderPhase: 3 },
    { x: 7, y: 7 }, 24, c);
  assert.deepEqual(calls.map(args => [args[1], args[5], args[6]]), [[16, 95, 103], [32, 143, 71]]);
});

test('Boots/normal/SPACE jump trajectories and ceiling handling match original player traces', () => {
  const research = json('../docs/player_physics_traces.json');
  for (const scenario of research.scenarios) {
    if (!['normal-held', 'normal-tap', 'boots-held', 'space-held', 'ceiling-held'].includes(scenario.name)) continue;
    const motion = new VerticalMotion(mechanics.playerPhysics);
    motion.boostCounter = scenario.jumpCounter;
    let y = 12;
    const world = { area: scenario.areaId === 2 ? 'SPACE' : 'FOREST',
      tile(_c, r) { return r >= 8 || (scenario.name === 'ceiling-held' && r === 4); } };
    for (let tick = 0; tick < scenario.ticks.length; tick++) {
      const jump = ['normal-held', 'boots-held', 'space-held', 'ceiling-held', 'jump-right-release'].includes(scenario.name)
        || (scenario.name === 'normal-tap' && tick === 0)
        || (scenario.name === 'running-jump-release' && tick >= 1);
      if (scenario.name.startsWith('side-')) continue; // Side probes belong to horizontal physics.
      const actual = motion.tick(y, 14, jump, scenario.jumpCounter === 5, world);
      y = actual.y;
      const expected = scenario.ticks[tick];
      assert.equal(y, expected.yUnits, `${scenario.name} tick ${tick + 1}`);
      assert.equal(motion.velocity, expected.verticalVelocity, `${scenario.name} velocity tick ${tick + 1}`);
    }
  }
});

test('60Hz player integration preserves 56/72px jump heights and does not auto-bounce when held', () => {
  const heights = [];
  const world = { area: 'FOREST', wPx: 2048, collideX() {}, tile(_c, r) { return r >= 8; } };
  for (const boots of [false, true]) {
    const p = new Player(114, 113, mechanics.playerPhysics);
    for (let n = 0; n < 5; n++) p.step({}, world, boots);
    let top = p.y;
    for (let n = 0; n < 90; n++) {
      p.step({ jump: true, jumpPressed: n === 0 }, world, boots);
      top = Math.min(top, p.y);
    }
    heights.push(113 - top);
    assert.equal(p.y, 113);
    assert.equal(p.onGround, true);
    assert.equal(p.vertical.boostCounter, 1);
  }
  assert.deepEqual(heights, [56, 72]);
});
