import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Player, initialCamera } from '../web/src/player.js';
import { spritePosition } from '../web/src/items.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const config = json('../web/assets/mechanics.json').playerPhysics;
const research = json('../docs/player_physics_traces.json');

function stateOf(player) {
  const position = spritePosition(player, player.sprite);
  return {
    xUnits: position.x / 8, yUnits: position.y / 8,
    airborne: Number(player.vertical.airborne), horizontalMomentum: player.momentum,
    verticalVelocity: player.vertical.velocity, ceilingPush: player.vertical.ceilingPush,
    boostCounter: player.vertical.boostCounter, facingBank: player.facing < 0 ? 5 : 0,
    cameraUnits: player.cameraX / 8, pose: player.pose,
    dead: player.dead, transition: player.pendingStrip,
  };
}

for (const scenario of research.scenarios) {
  test(`full player update matches original code: ${scenario.name}`, () => {
    const cells = new Set(scenario.solidCells.map(([c, r]) => `${c}:${r}`));
    const world = {
      area: scenario.areaId === 2 ? 'SPACE' : 'FOREST',
      stripData: { leftStrip: scenario.name.startsWith('left-link') ? 0 : null,
        rightStrip: scenario.name.startsWith('right-link') ? 1 : null },
      tile: (c, r) => cells.has(`${c}:${r}`),
    };
    const player = new Player(scenario.initialXUnits * 8 + 2, 113, config);
    player.vertical.boostCounter = scenario.jumpCounter;
    player.cameraX = scenario.initialCameraUnits * 8;
    if (scenario.name.endsWith('link-air')) {
      player.vertical.airborne = true;
      player.momentum = scenario.name.startsWith('left') ? -5 : 5;
      player.facing = Math.sign(player.momentum);
    }
    for (let tick = 0; tick < scenario.ticks.length; tick++) {
      player.tick(scenario.inputs[tick], world, scenario.jumpCounter === 5);
      assert.deepEqual(stateOf(player), scenario.ticks[tick], `tick ${tick + 1}`);
    }
  });
}

test('state matrix matches original instructions on all 24 maps and 36 door arrivals', () => {
  const maps = new Map();
  for (const row of research.realMapCases) {
    if (!maps.has(row.area)) maps.set(row.area, {
      level: json(`../web/assets/levels/${row.area}.json`),
      solid: json(`../web/assets/tiles/${row.area}.json`).solid,
    });
    const map = maps.get(row.area), s = row.initial;
    const world = { area: row.area, tile(c, r) {
      if (c < 0 || c >= 128 || r < 0) return true;
      return map.solid[map.level.strips[row.strip][r * 128 + c]] ?? false;
    } };
    const player = new Player(s.xUnits * 8 + 2, s.yUnits * 8 + 17, config);
    Object.assign(player, { momentum: s.horizontalMomentum, facing: s.facingBank ? -1 : 1,
      cameraX: s.cameraUnits * 8 });
    Object.assign(player.vertical, { airborne: Boolean(s.airborne), velocity: s.verticalVelocity,
      boostCounter: s.boostCounter, ceilingPush: s.ceilingPush });
    player.tick(row.input, world, row.jumpCounter === 5);
    assert.deepEqual(stateOf(player), row.expected,
      `${row.area}:${row.strip} initial=${JSON.stringify(s)} input=${JSON.stringify(row.input)}`);
  }
  assert.equal(research.realMapCases.filter(row => row.doorArrival).length, 36);
  assert.equal(maps.size, 8);
});

test('camera initialization uses the original center and 0..232 bounds', () => {
  for (const [x, camera] of [[0, 0], [80, 0], [112, 24], [1000, 912], [2032, 1856]]) {
    assert.equal(initialCamera(x), camera);
  }
});

test('60Hz adapter queues a tapped jump and never moves between DOS ticks', () => {
  const player = new Player(114, 113, config);
  const world = { area: 'FOREST', tile: (_c, r) => r >= 8 };
  player.step({ right: true, jumpPressed: true }, world);
  assert.equal(player.x, 114);
  assert.equal(player.y, 113);
  for (let i = 0; i < 3; i++) player.step({ right: true }, world);
  assert.equal(player.x, 122);
  assert.equal(player.y, 105);
});
