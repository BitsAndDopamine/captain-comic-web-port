import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Game } from '../web/src/main.js';

const json = file => JSON.parse(readFileSync(new URL(`../web/assets/${file}.json`, import.meta.url)));
const assets = Object.fromEntries(['areas', 'world', 'mechanics', 'startup', 'sprites'].map(name => [name, json(name)]));
assets.levels = {}; assets.tiles = {};
for (const area of assets.world.areas) {
  assets.levels[area.area] = json(`levels/${area.area}`);
  assets.tiles[area.area] = json(`tiles/${area.area}`);
}
const snapshot = game => JSON.stringify({ player: game.player, life: game.life,
  camera: [game.camX, game.camY], clock: game.dosTickAccumulator,
  recharge: game.weaponRechargeTicks, weapon: game.weapon,
  enemies: game.enemies, scheduler: game.enemyScheduler,
  fireballs: game.fireballs, pickups: game.pickups,
  door: game.doorTransition, death: game.deathTransition, wand: game.wandTransition,
  inventory: [...game.inventory], collected: [...game.collectedPickups] });

test('pause freezes movement, combat, pickups, refill and clocks; continue does not recreate the run', () => {
  const g = new Game(assets);
  const player = g.player, enemySystem = g.enemySystem;
  g.paused = true;
  const before = snapshot(g);
  for (let i = 0; i < 600; i++) g.step({ left: true, jump: true, fire: true, doorPressed: true, teleportPressed: true });
  assert.equal(snapshot(g), before);
  g.paused = false;
  for (let i = 0; i < 4; i++) g.step({});
  assert.equal(g.player, player);
  assert.equal(g.enemySystem, enemySystem);
  assert.notEqual(snapshot(g), before);
});

test('pause also freezes door, death and Wand transitions', () => {
  for (const transition of ['doorTransition', 'deathTransition', 'wandTransition']) {
    const g = new Game(assets);
    g[transition] = { elapsedTicks: 3, phase: 2 };
    g.paused = true;
    const before = snapshot(g);
    for (let i = 0; i < 60; i++) g.step({});
    assert.equal(snapshot(g), before, transition);
  }
});

test('export includes the original opaque 128x48 pause artwork', () => {
  assert.equal(assets.sprites.PAUSE.w, 128);
  assert.equal(assets.sprites.PAUSE.h, 48);
  assert.deepEqual(assets.sprites.PAUSE.source.dataSegmentOffsets, ['0xbac4']);
  assert.equal(assets.sprites.PAUSE.source.mask, false);
});
