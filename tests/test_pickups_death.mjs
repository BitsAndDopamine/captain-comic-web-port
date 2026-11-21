import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Game } from '../web/src/main.js';
import { Pickup, pickupContact, pickupVisible } from '../web/src/entities.js';
import { placeSprite, spritePosition } from '../web/src/items.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const traces = json('./fixtures/pickups_death_traces.json');
const assets = Object.fromEntries(['areas', 'world', 'mechanics', 'startup', 'sprites', 'hud'].map(name =>
  [name, json(`../web/assets/${name}.json`)]));
assets.levels = {}; assets.tiles = {}; assets.hudImgs = { items: {} }; assets.sys = { SYS003: { img: 'SYS003' } };
for (const [name, sprite] of Object.entries(assets.sprites)) sprite.img = name;
for (const area of assets.world.areas) {
  assets.levels[area.area] = json(`../web/assets/levels/${area.area}.json`);
  assets.tiles[area.area] = { ...json(`../web/assets/tiles/${area.area}.json`), img: area.area };
}
const kinds = { 0: 'corkscrew', 1: 'key', 2: 'boots', 3: 'lantern', 4: 'wand',
  5: 'gems', 6: 'crown', 7: 'gold', 8: 'cola', 14: 'shield' };
const keyOf = game => `${game.area}:${game.world.stripIndex}`;

test('6,720 original-code pickup cases match exact sprite units and viewport gates', () => {
  assert.equal(traces.geometry.length, 6720);
  for (const row of traces.geometry) {
    const [_area, _strip, id, x, y, px, py, camera, collected, phase] = row;
    const pickup = new Pickup(kinds[id], {}, id, x * 8, y * 8, 'test');
    const actual = pickupContact({ xUnits: px, yUnits: py }, pickup, camera * 8);
    assert.equal(actual, Boolean(collected), JSON.stringify(row));
    assert.equal(actual || !pickupVisible(pickup, camera * 8) ? 1 : 0, phase);
  }
});

function setup(row, emit) {
  const g = new Game(assets, { playEvent: emit });
  g.areaIdx = g.areaNames.indexOf(row.area); g.loadStrip(row.strip);
  const s = row.initial;
  g.inventory = new Set(['boots', 'corkscrew', 'key', 'lantern', 'wand', 'gems', 'crown']);
  Object.assign(g.life, { score: s.score, scoreCarryProgress: s.carry, spares: s.spares,
    shield: s.shield, refillTicks: s.refill });
  g.weapon = s.weapon; g.colas = s.colas; g.weaponRechargeTicks = 2 - s.weaponClock;
  g.pickupPhase = s.pickupPhase;
  placeSprite(g.player, assets.sprites.PLAYER, { x: s.position[1] * 8, y: s.position[0] * 8 });
  Object.assign(g.player, { spawnX: 64 * 8 + 2, spawnY: 12 * 8 + 17, facing: s.facing ? -1 : 1,
    momentum: s.momentum, animationPhase: s.animationPhase, pose: s.pose });
  Object.assign(g.player.vertical, { airborne: Boolean(s.airborne), velocity: s.velocity,
    ceilingPush: s.ceilingPush, boostCounter: s.boostCounter });
  g.camX = s.camera * 8;
  g.enemyScheduler.respawnDelay = s.shared[0]; g.enemyScheduler.spawnOffset = s.shared[1];
  g.enemies.forEach((e, n) => {
    const [yUnits, xUnits, dx, dy, counter, state, bank, phase] = s.enemies[n];
    Object.assign(e, { yUnits, xUnits, dx, dy, counter, state, bank, phase, behavior: 4 });
  });
  g.pickups = row.pickup === 255 ? [] : [new Pickup(kinds[row.pickup], assets.sprites.ITEMS,
    row.pickup, 14 * 8, 12 * 8, keyOf(g))];
  return g;
}
function state(g) {
  const p = g.player, pos = spritePosition(p, assets.sprites.PLAYER), v = p.vertical;
  return { score: g.score, carry: g.life.scoreCarryProgress, spares: g.lives, shield: g.shield,
    colas: g.colas, weapon: g.weapon, boots: g.inventory.has('boots') ? 5 : 4,
    tools: ['corkscrew', 'key', 'lantern', 'wand'].map(item => Number(g.inventory.has(item))),
    treasures: ['gems', 'crown', 'gold'].filter(item => g.inventory.has(item)).length,
    position: [pos.y / 8, pos.x / 8], camera: g.camX / 8,
    airborne: Number(v.airborne), momentum: p.momentum, velocity: v.velocity,
    ceilingPush: v.ceilingPush, boostCounter: v.boostCounter, facing: p.facing < 0 ? 5 : 0,
    pose: p.pose, animationPhase: p.animationPhase, refill: g.life.refillTicks,
    victoryCounter: g.victory?.countdown ?? 0, weaponClock: 2 - g.weaponRechargeTicks,
    pickupPhase: g.pickupPhase, collected: Number(g.collectedPickups.has(keyOf(g))),
    enemies: g.enemies.map(e => [e.yUnits, e.xUnits, e.dx, e.dy, e.counter, e.state, e.bank, e.phase]),
    shared: [g.enemyScheduler.respawnDelay, g.enemyScheduler.spawnOffset] };
}

test('192 original-code death traces match enemies, late pickups, sounds, reset state and Game Over timing', () => {
  assert.equal(traces.deaths.length, 192);
  for (const row of traces.deaths) {
    let tick = 0;
    const sounds = [], game = setup(row, event => sounds.push({ tick, event }));
    game.kill(row.cause);
    for (const wait of row.waits) {
      while (tick < wait.tick) { tick++; game.tickDeath(); }
      assert.deepEqual(state(game), wait.state, `${row.area}:${row.strip} ${row.cause}/${row.pickup} tick ${tick}`);
    }
    while (tick < row.ticks) { tick++; game.tickDeath(); }
    assert.deepEqual(state(game), row.final, `${row.area}:${row.strip} reset`);
    assert.equal(game.life.gameOver, row.gameOver);
    assert.deepEqual(sounds, row.sounds, `${row.area}:${row.strip} sound timing`);
  }
});

test('pickups are checked once per DOS tick, after enemy/projectile processing, and persist across death', () => {
  const g = new Game(assets), calls = [];
  g.life.refillTicks = 0;
  g.pickups = [new Pickup('cola', assets.sprites.ITEMS, 8, 112, 96, keyOf(g))];
  g.enemySystem.tick = () => calls.push('enemy');
  g.fireballs = [{ alive: true, tick() { calls.push('projectile'); } }];
  g.step({}); assert.equal(g.colas, 0);
  for (let n = 0; n < 3; n++) g.step({});
  assert.deepEqual(calls, ['enemy', 'projectile']);
  assert.equal(g.colas, 1, 'item at the sprite head is collectable');
  assert.equal(g.score, 2000);
  g.kill(); while (g.deathTransition) g.tickDeath();
  assert.equal(g.pickups.length, 0);
  assert.equal(g.colas, 1);
});

test('pickup bank alternates on eligible DOS checks, never on renders or offscreen checks', () => {
  const g = new Game(assets);
  const pickup = new Pickup('cola', assets.sprites.ITEMS, 8, 200, 96, keyOf(g));
  g.pickups = [pickup]; g.pickupPhase = 0;
  g.collectPickups(); assert.equal(pickup.bank, 0);
  g.collectPickups(); assert.equal(pickup.bank, 16);
  pickup.draw({ drawImage() {} }, { x: 7, y: 7 }, 24, 0, 99999);
  assert.equal(g.pickupPhase, 0);
  g.camX = 300; g.collectPickups(); assert.equal(g.pickupPhase, 0);
});

test('fatal contact enters the explosion before projectiles and can collect a life-saving third treasure', () => {
  const events = [], g = new Game(assets, { playEvent: event => events.push(event) });
  g.life.refillTicks = 0; g.life.spares = 0;
  g.inventory.add('gems'); g.inventory.add('crown');
  g.pickups = [new Pickup('gold', assets.sprites.ITEMS, 7, 112, 96, keyOf(g))];
  for (const e of g.enemies) { e.state = 0; e.counter = 100; }
  Object.assign(g.enemies[0], { state: 1, counter: 0, behavior: 4, phase: 1, xUnits: 14, yUnits: 12 });
  let shotsMoved = 0;
  g.fireballs = [{ alive: true, tick() { shotsMoved++; } }];
  for (let n = 0; n < 4; n++) g.step({});
  assert.equal(g.deathTransition.stage, 'explosion');
  assert.equal(g.deathTransition.frame, 0);
  assert.equal(g.enemies[0].state, 9, 'fatal enemy participates in the immediate nested update');
  assert.equal(g.enemies[1].counter, 99, 'remaining slots run in the explosion, not the aborted outer tick');
  assert.equal(shotsMoved, 0);
  assert.equal(g.fireballs.length, 1, 'projectile storage is cleared at respawn, not death entry');
  assert.equal(g.lives, 1);
  assert.equal(g.score, 2000);
  assert.equal(g.victory.countdown, 20);
  assert.deepEqual(events, ['contactDeath', 'pickup', 'extraLife']);
  while (g.deathTransition) g.tickDeath();
  assert.equal(g.life.gameOver, false);
  assert.equal(g.lives, 0);
  assert.equal(g.victory.countdown, 20, 'victory countdown is suspended for the whole death path');
  assert.equal(g.fireballs.length, 0);
  assert.equal(g.pickups.length, 0);
  assert.equal(events.filter(event => event === 'death').length, 1);
  assert.ok(!events.includes('gameOver'));
});

test('fall cropping draws only the visible top rows; blank waits hide all actors', () => {
  const g = new Game(assets);
  placeSprite(g.player, assets.sprites.PLAYER, { x: 112, y: 136 }); g.kill();
  const rectangles = [], images = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, clip() {}, fillRect() {},
    rect: (...r) => rectangles.push(r), drawImage: (...a) => images.push(a[0]) };
  g.draw(ctx, 0);
  assert.ok(rectangles.some(r => JSON.stringify(r) === JSON.stringify([7, 143, 196, 24])));
  assert.ok(images.includes('PLAYER'));
  images.length = 0; g.tickDeath(); g.draw(ctx, 0);
  assert.ok(!images.includes('PLAYER') && !images.includes('ITEMS') && !images.includes('FIREBALL'));
});
