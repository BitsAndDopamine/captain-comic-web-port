import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EnemySystem, playerEnemyContact, fireballEnemyContact } from '../web/src/enemies.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const worldData = json('../web/assets/world.json');
const traces = json('./fixtures/enemy_traces.json');
function setup(name, strip) {
  const area = worldData.areas.find(a => a.area === name);
  const level = json(`../web/assets/levels/${name}.json`);
  const tiles = json(`../web/assets/tiles/${name}.json`);
  const data = level.strips[strip];
  const system = new EnemySystem(area, area.strips[strip], {});
  // Match the EXE's flat 128-column map buffer, including reads past a row edge.
  const world = { tile(c, r) { return tiles.solid[data[r * 128 + c]] ?? false; } };
  return { system, world };
}
const pack = e => [e.yUnits, e.xUnits, e.dx & 255, e.dy & 255, e.counter,
  e.descriptor.animationSteps, e.behavior, 0, 0, e.state, e.bank, e.phase];

test('all five movement routines match original 8086 traces across every strip', () => {
  const cache = new Map();
  for (const [i, c] of traces.movement.entries()) {
    const key = `${c.area}:${c.strip}`;
    if (!cache.has(key)) cache.set(key, setup(c.area, c.strip));
    const { system, world } = cache.get(key), e = system.enemies[0], r = c.record;
    Object.assign(e, { yUnits: r[0], xUnits: r[1], dx: r[2] > 127 ? r[2] - 256 : r[2],
      dy: r[3] > 127 ? r[3] - 256 : r[3], counter: r[4], descriptor: { animationSteps: r[5] },
      behavior: r[6], state: r[9], bank: r[10], phase: r[11] });
    system.shared.respawnDelay = 20;
    for (const other of system.enemies.slice(1)) { other.state = 0; other.counter = 100; }
    system.tick(world, c.player, c.camera, null);
    assert.deepEqual(pack(e), c.expected, `machine-code movement case ${i}: ${JSON.stringify(c)}`);
  }
});

test('24 complete spawn/AI/recycle schedules match 400 original machine-code ticks each', () => {
  for (const c of traces.schedules) {
    const { system, world } = setup(c.area, c.strip);
    const expected = Buffer.from(c.traceBase64, 'base64');
    for (let tick = 0; tick < 400; tick++) {
      const camera = (tick * 3) % 233;
      const player = { xUnits: Math.min(254, camera + 11), yUnits: 12 - Math.floor(tick / 40) % 8,
        facing: tick % 80 < 40 ? 1 : -1 };
      // Contact is bypassed in the machine-code oracle as well.
      system.tick(world, player, camera, null);
      const actual = [...system.enemies.flatMap(pack), system.shared.respawnDelay,
        system.shared.spawnOffset, Number(system.spawned)];
      assert.deepEqual(actual, [...expected.subarray(tick * 51, (tick + 1) * 51)],
        `${c.area}:${c.strip} tick ${tick + 1}`);
    }
  }
});

test('contact uses asymmetric sprite-coordinate windows, not the provisional player box', () => {
  const p = { xUnits: 14, yUnits: 12 };
  assert.equal(playerEnemyContact(p, { xUnits: 15, yUnits: 15 }), true);
  assert.equal(playerEnemyContact(p, { xUnits: 16, yUnits: 12 }), false);
  assert.equal(playerEnemyContact(p, { xUnits: 14, yUnits: 11 }), false);
  assert.equal(playerEnemyContact(p, { xUnits: 14, yUnits: 16 }), false);
  const e = { alive: true, xUnits: 14, yUnits: 12 };
  assert.equal(fireballEnemyContact({ x: 120, y: 104 }, e), true);
  assert.equal(fireballEnemyContact({ x: 112, y: 88 }, e), false);
});

test('spawn delay underflows on tick 21, only one regular slot activates per tick', () => {
  const { system } = setup('FOREST', 2);
  const flat = { tile: (_x, y) => y >= 8 };
  const player = { xUnits: 14, yUnits: 12, facing: 1 };
  for (let n = 0; n < 20; n++) system.tick(flat, player, 3, null);
  assert.equal(system.enemies.filter(e => e.alive).length, 0);
  assert.equal(system.shared.spawnOffset, 22);
  system.tick(flat, player, 3, null);
  assert.equal(system.enemies.filter(e => e.alive).length, 1);
  assert.equal(system.enemies[0].xUnits, 27);
  assert.equal(system.enemies[0].yUnits, 14);
  system.tick(flat, player, 3, null);
  assert.equal(system.enemies.filter(e => e.alive).length, 2);
});

test('killed slots show original effects and recycle with staggered delays, not permanent removal', () => {
  const { system, world } = setup('FOREST', 0), e = system.enemies[0];
  Object.assign(e, { xUnits: 14, yUnits: 12, state: 1, counter: 0 });
  e.hit();
  const stages = [];
  for (let tick = 0; tick < 5; tick++) {
    system.tick(world, { xUnits: 14, yUnits: 12, facing: 1 }, 3, null);
    stages.push(e.renderState);
  }
  assert.deepEqual(stages, [2, 3, 4, 5, 6]);
  system.tick(world, { xUnits: 14, yUnits: 12, facing: 1 }, 3, null);
  assert.equal(e.state, 0);
  assert.equal(e.counter, 20);
  assert.equal(system.shared.respawnDelay, 40);
  const area = worldData.areas.find(a => a.area === 'FOREST');
  const next = new EnemySystem(area, area.strips[1], {}, system.shared);
  assert.equal(next.shared.respawnDelay, 40);
  assert.equal(next.enemies[0].counter, 20); // Strip load resets per-slot delays only.
});

test('descriptor animation repeats penultimate frame and selects the original direction bank', () => {
  const { system } = setup('FOREST', 0), e = system.enemies[0];
  const poses = [];
  for (const bank of [0, 5]) for (let frame = 0; frame < 4; frame++) {
    e.counter = frame; e.bank = bank; poses.push(e.frame);
  }
  assert.deepEqual(poses, [0, 1, 2, 1, 3, 4, 5, 4]);
});
