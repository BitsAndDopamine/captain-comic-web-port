import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AnimationMode, VisualTimeline, ANIMATION_STORAGE_KEY } from '../web/src/animation.js';
import { Game } from '../web/src/main.js';
import { doorArrival } from '../web/src/doors.js';

const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const assets = Object.fromEntries(['areas', 'world', 'mechanics', 'startup', 'sprites', 'hud'].map(name => [name, json(`../web/assets/${name}.json`)]));
assets.levels = {}; assets.tiles = {}; assets.hudImgs = { items: {} };
assets.sys = Object.fromEntries(['SYS000', 'SYS001', 'SYS002', 'SYS003', 'SYS004', 'SYS005'].map(name => [name, { img: name }]));
for (const [name, sprite] of Object.entries(assets.sprites)) sprite.img = name;
for (const area of assets.world.areas) {
  assets.levels[area.area] = json(`../web/assets/levels/${area.area}.json`);
  assets.tiles[area.area] = { ...json(`../web/assets/tiles/${area.area}.json`), img: area.area };
}
const context = () => {
  const calls = [];
  return { calls, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, fillText() {},
    drawImage(...args) { calls.push(args); } };
};
const simpleGame = () => ({ world: {}, camX: 24, camY: 0, player: { x: 100, y: 96 },
  enemies: [{ xUnits: 20, yUnits: 10, state: 1 }], fireballs: [{ x: 112, y: 104 }] });

test('original visuals are default; optional 30 FPS preference validates and persists', () => {
  const store = memory(), mode = new AnimationMode(store);
  assert.equal(mode.mode, 'original'); assert.equal(mode.smooth, false);
  mode.toggle(); assert.equal(mode.mode, '30fps'); assert.equal(new AnimationMode(store).smooth, true);
  assert.equal(mode.set('60fps'), false); assert.equal(mode.mode, '30fps');
  mode.toggle(); assert.equal(new AnimationMode(store).mode, 'original');
  store.setItem(ANIMATION_STORAGE_KEY, 'garbage');
  assert.equal(new AnimationMode(store).mode, 'original'); assert.equal(new AnimationMode(store).warning, true);
  const denied = new AnimationMode({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  denied.toggle(); assert.equal(denied.smooth, true); assert.equal(denied.warning, true);
});

test('30 FPS pacing is independent of refresh rate, without accumulated drift or catch-up draws', () => {
  for (const hz of [60, 90, 120, 144]) {
    const mode = new AnimationMode(); mode.set('30fps');
    let count = 0;
    for (let i = 0; i < hz * 10; i++) if (mode.shouldDraw(i * 1000 / hz)) count++;
    assert.equal(count, 300, `${hz}Hz monitor`);
    assert.equal(mode.shouldDraw(60_000), true);
    assert.equal(mode.shouldDraw(60_000), false, 'no burst after a hidden-tab gap');
    mode.invalidate(); assert.equal(mode.shouldDraw(60_001), true);
    mode.set('original'); assert.equal(mode.shouldDraw(60_002), true); assert.equal(mode.shouldDraw(60_003), true);
  }
});

test('original mode returns actual positions and does not interpolate any sprite', () => {
  const timeline = new VisualTimeline(), game = simpleGame();
  timeline.capture(game); assert.equal(timeline.previous, null);
  const view = timeline.sample(game, 0.5);
  assert.equal(view.player, game.player); assert.equal(view.enemies, game.enemies); assert.equal(view.fireballs, game.fireballs);
});

test('30 FPS smooths player, enemies, fireballs and camera together without modifying game objects', () => {
  const timeline = new VisualTimeline(), game = simpleGame(); timeline.enabled = true; timeline.capture(game);
  game.camX += 8; game.player.x += 8; game.player.y -= 16; game.enemies[0].xUnits--;
  game.fireballs[0].x += 16; game.fireballs[0].y += 8;
  const before = JSON.stringify(game), view = timeline.sample(game, 0.5);
  assert.deepEqual([view.camX, view.player.x, view.player.y], [28, 104, 88]);
  assert.equal(view.enemies[0].xUnits, 19.5);
  assert.deepEqual([view.fireballs[0].x, view.fireballs[0].y], [120, 108]);
  assert.equal(JSON.stringify(game), before);
});

test('new shots interpolate from their origin, but removed shots/enemies never linger', () => {
  const timeline = new VisualTimeline(), game = simpleGame(); timeline.enabled = true; timeline.capture(game);
  const shot = { x: 100, y: 80 }; game.fireballs.push(shot); timeline.rememberFireball(shot); shot.x += 16;
  assert.equal(timeline.sample(game, 0.5).fireballs[1].x, 108);
  game.fireballs = []; game.enemies = [];
  const view = timeline.sample(game, 0.5); assert.deepEqual(view.fireballs, []); assert.deepEqual(view.enemies, []);
});

test('teleports, strip changes, respawns, new spawns and death/victory/door boundaries snap cleanly', () => {
  for (const change of [g => { g.world = {}; }, g => { g.player = { ...g.player }; },
    g => { g.doorTransition = { stage: 'arrival' }; }, g => { g.deathTransition = { stage: 'explosion' }; },
    g => { g.victory = { active: true, stage: 'departure' }; }]) {
    const timeline = new VisualTimeline(), game = simpleGame(); timeline.enabled = true; timeline.capture(game);
    game.player.x += 8; change(game);
    assert.equal(timeline.sample(game, 0).player, game.player);
    assert.equal(timeline.previous, null);
  }
  const timeline = new VisualTimeline(), game = simpleGame(); timeline.enabled = true; timeline.capture(game);
  game.player.x += 100; game.camX += 100; game.enemies[0].state = 0;
  let view = timeline.sample(game, 0.5);
  assert.equal(view.player, game.player); assert.equal(view.camX, game.camX); assert.equal(view.enemies[0], game.enemies[0]);
  game.enemies[0].state = 0; timeline.capture(game); game.enemies[0].state = 1; game.enemies[0].xUnits = 200;
  assert.equal(timeline.sample(game, 0).enemies[0], game.enemies[0]);
});

test('pause freezes the displayed pose; leaving 30 FPS mode restores original positions immediately', () => {
  const timeline = new VisualTimeline(), game = simpleGame(); timeline.enabled = true; timeline.capture(game);
  game.player.x += 8; assert.equal(timeline.sample(game, 0.25).player.x, 102);
  game.paused = true;
  assert.equal(timeline.sample(game, 0.9).player.x, 102);
  timeline.enabled = false; assert.equal(timeline.sample(game, 0).player.x, 108);
});

const state = game => JSON.stringify({ area: game.area, strip: game.world.stripIndex,
  camX: game.camX, camY: game.camY, clock: game.dosTickAccumulator,
  life: { ...game.life, onSound: undefined }, weapon: game.weapon, recharge: game.weaponRechargeTicks, colas: game.colas,
  inventory: [...game.inventory], pickups: [...game.collectedPickups], pickupPhase: game.pickupPhase,
  player: game.player, enemies: game.enemies, fireballs: game.fireballs, scheduler: game.enemyScheduler,
  death: game.deathTransition, door: game.doorTransition, wand: game.wandTransition, victory: game.victory });

test('both modes have identical gameplay, enemy AI, firing, pickups, tools and death across 1,200 steps', () => {
  const original = new Game(assets), smooth = new Game(assets); smooth.visuals.enabled = true;
  for (const game of [original, smooth]) {
    game.colas = 5; game.weapon = 12; game.life.shield = 6; game.life.refillTicks = 0;
    for (const item of ['boots', 'corkscrew', 'key', 'wand', 'lantern']) game.inventory.add(item);
  }
  const ctx = context();
  for (let n = 0; n < 1200; n++) {
    const input = { right: n % 240 < 180, left: n % 240 >= 180, jump: n % 90 < 15,
      jumpPressed: n % 90 === 0, fire: n % 120 < 30, teleportPressed: n % 277 === 0 };
    original.step(input); smooth.step(input);
    original.draw(ctx, n * 1000 / 60); smooth.draw(ctx, n * 1000 / 60, { animationAlpha: n % 4 / 4 });
    assert.equal(state(smooth), state(original), `step ${n}`);
    ctx.calls.length = 0;
  }
});

test('door animations, checkpoints and victory timers keep their original durations in 30 FPS mode', () => {
  const original = new Game(assets), smooth = new Game(assets); smooth.visuals.enabled = true;
  for (const game of [original, smooth]) {
    game.inventory.add('key'); game.loadStrip(2);
    Object.assign(game.player, doorArrival(game.player, assets.sprites.PLAYER, game.world.stripData.doors[0]), { onGround: true });
    game.updateCamera(); game.step({ doorPressed: true });
  }
  const ctx = context();
  for (let n = 0; n < 150; n++) {
    original.step({}); smooth.step({}); smooth.draw(ctx, n, { animationAlpha: 0.4 });
    assert.equal(state(smooth), state(original), `door step ${n}`); ctx.calls.length = 0;
  }
  for (const game of [original, smooth]) {
    for (const item of ['gems', 'gold', 'crown']) game.inventory.add(item);
    game.armVictory();
  }
  for (let n = 0; n < 700; n++) {
    original.step({}); smooth.step({}); smooth.draw(ctx, n, { animationAlpha: 0.5 });
    assert.equal(state(smooth), state(original), `victory step ${n}`); ctx.calls.length = 0;
  }
});

test('original drawing is unchanged; 30 FPS uses integer destinations for every layer', () => {
  const game = new Game(assets), ctx = context();
  game.dosTickAccumulator = 1; game.step({ right: true, fire: true });
  game.draw(ctx, 0); const baseline = [...ctx.calls]; ctx.calls.length = 0;
  game.visuals.enabled = true; game.visuals.capture(game); game.player.x += 8; game.camX += 8;
  game.draw(ctx, 0, { animationAlpha: 0.33 });
  assert.ok(ctx.calls.every(call => call.slice(call.length === 3 ? 1 : 5).every(Number.isInteger)));
  game.player.x -= 8; game.camX -= 8; game.visuals.enabled = false; ctx.calls.length = 0;
  game.draw(ctx, 0); assert.deepEqual(ctx.calls, baseline);
});

test('30 FPS retains exactly the same artwork frames and HUD states at each original tick', () => {
  const original = new Game(assets), smooth = new Game(assets); smooth.visuals.enabled = true;
  for (const game of [original, smooth]) { game.colas = 5; game.weapon = 12; game.life.shield = 6; }
  const a = context(), b = context();
  for (let n = 0; n < 200; n++) {
    const input = { right: true, fire: n % 50 < 20, jump: n % 60 < 12, jumpPressed: n % 60 === 0 };
    original.step(input); smooth.step(input);
    original.draw(a, n * 1000 / 60); smooth.draw(b, n * 1000 / 60, { animationAlpha: 1 });
    assert.deepEqual(b.calls, a.calls, `artwork at step ${n}`);
    a.calls.length = 0; b.calls.length = 0;
  }
});
