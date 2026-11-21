import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Victory, hasAllTreasures } from '../web/src/victory.js';
import { egaMode0dColor, recolorPalette } from '../web/src/palette.js';
import { LifeSystem } from '../web/src/lives.js';
import { Game } from '../web/src/main.js';
import { HighScores, RunMenu } from '../web/src/high_scores.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const mechanics = json('../web/assets/mechanics.json'), config = mechanics.victory;
const oracle = json('./fixtures/victory_traces.json');
const lifeState = life => ({ score: life.score, spares: life.spares, carry: life.scoreCarryProgress,
  shield: life.shield, refill: life.refillTicks });

test('victory timing, score/life recursion and sound requests match 120 original-code traces', () => {
  for (const row of oracle.cases) {
    let tick = 0;
    const sounds = [], emit = event => sounds.push({ tick, event });
    const life = new LifeSystem(mechanics.lives, emit);
    Object.assign(life, { spares: row.initial.spares, score: row.initial.score,
      scoreCarryProgress: row.initial.carry, shield: row.initial.shield, refillTicks: row.initial.refill });
    const victory = new Victory(config); victory.start(emit);
    for (const sample of row.waits) {
      while (tick < sample.tick) { tick++; victory.tick(life, emit); }
      const { tick: _tick, duration: _duration, ...expected } = sample;
      assert.deepEqual(lifeState(life), expected, `${JSON.stringify(row.initial)} tick ${tick}`);
    }
    while (tick < row.keys[0].tick) { tick++; victory.tick(life, emit); }
    assert.equal(victory.canAdvance, true);
    assert.equal(victory.advance(), true);
    assert.equal(victory.stage, 'gameOver');
    assert.equal(life.gameOver, false, 'winning consumes icons, not deaths');
    assert.deepEqual(lifeState(life), row.final);
    assert.deepEqual(sounds, row.sounds, JSON.stringify(row.initial));
    const start = row.keys[0].tick - config.paletteSteps.length - config.endingHoldTicks;
    const palette = config.paletteIndices.map(index => ({ tick: start, index, value: 0 }));
    config.paletteSteps.forEach((values, step) => values.forEach((value, n) => {
      if (step !== 4 || n === 2) palette.push({ tick: start + step, index: config.paletteIndices[n], value });
    }));
    assert.deepEqual(palette, row.palette);
  }
});

test('third-treasure countdown permits 18 normal ticks and starts departure on the nineteenth', () => {
  const victory = new Victory(config), life = new LifeSystem(mechanics.lives), sounds = [];
  for (let i = 0; i < 18; i++) victory.tick(life, sound => sounds.push(sound));
  assert.equal(victory.stage, 'pending');
  assert.equal(victory.countdown, 2);
  victory.tick(life, sound => sounds.push(sound));
  assert.equal(victory.stage, 'departure');
  assert.deepEqual(sounds, ['teleport']);
});

test('departure uses all 12 original frames, hides the player after six, then waits six ticks', () => {
  const victory = new Victory(config), life = new LifeSystem(mechanics.lives);
  victory.start(() => {});
  assert.equal(victory.effectFrame, null);
  assert.equal(victory.playerVisible, true);
  for (let frame = 0; frame < 12; frame++) {
    victory.tick(life);
    assert.equal(victory.effectFrame, frame);
    assert.equal(victory.playerVisible, frame < 6);
  }
  for (let t = 0; t < 6; t++) {
    victory.tick(life);
    assert.equal(victory.effectFrame, null);
    assert.equal(victory.stage, 'departure');
  }
  victory.tick(life);
  assert.equal(victory.stage, 'baseTally');
  assert.equal(life.score, 1000);
});

test('ending rejects early keys and waits five palette ticks plus twenty hold ticks', () => {
  const victory = new Victory(config), life = new LifeSystem(mechanics.lives);
  victory.stage = 'ending';
  for (let tick = 0; tick < 25; tick++) {
    assert.equal(victory.advance(), false);
    assert.equal(victory.paletteStep, Math.min(tick, 4));
    victory.tick(life);
  }
  assert.equal(victory.canAdvance, true);
  victory.tick(life);
  assert.equal(victory.ticks, 25, 'key wait does not keep modifying the sequence');
  assert.equal(victory.advance(), true);
  assert.equal(victory.advance(), false);
});

test('ending palette writes only the original three indices and preserves transparency/source pixels', () => {
  assert.deepEqual(egaMode0dColor(24), [85, 85, 85]);
  assert.deepEqual(egaMode0dColor(26), [85, 255, 85]);
  assert.deepEqual(egaMode0dColor(28), [255, 85, 85]);
  const palette = json('../web/assets/palette.json').colors;
  const pixels = new Uint8ClampedArray([0, 170, 0, 255, 85, 255, 85, 255,
    255, 85, 85, 128, 170, 170, 170, 255]);
  const original = [...pixels], output = recolorPalette(pixels, palette, config.paletteIndices, config.paletteSteps[0]);
  assert.deepEqual([...output], [85, 85, 85, 255, 85, 85, 85, 255, 85, 85, 85, 128, 170, 170, 170, 255]);
  assert.deepEqual([...pixels], original);
});

const assets = Object.fromEntries(['areas', 'world', 'mechanics', 'startup', 'sprites'].map(name =>
  [name, json(`../web/assets/${name}.json`)]));
assets.levels = {}; assets.tiles = {};
for (const area of assets.world.areas) {
  assets.levels[area.area] = json(`../web/assets/levels/${area.area}.json`);
  assets.tiles[area.area] = json(`../web/assets/tiles/${area.area}.json`);
}
const grants = items => ({ items, colas: null, weapon: null, shield: null });
const advanceTo = (game, stage) => {
  let frames = 0;
  while (game.victory?.stage !== stage && frames++ < 3000) game.step({});
  assert.equal(game.victory?.stage, stage);
};

test('all three unique treasures are required; final pickup awards points/life before arming once', () => {
  for (const items of [[], ['gems'], ['gems', 'crown']]) {
    assert.equal(hasAllTreasures(new Set(items), config), false);
    assert.equal(new Game(assets, null, grants(items)).victory, null);
  }
  const game = new Game(assets, null, grants(['gems', 'crown']));
  game.enemySystem.tick = () => {};
  game.pickups = [{ kind: 'gold', x: game.player.x, y: game.player.y, w: 16, h: 16, stateKey: 'final' }];
  for (let n = 0; n < 4; n++) game.step({}); // Pickup checks share the DOS clock.
  const victory = game.victory;
  assert.ok(victory);
  assert.equal(victory.countdown, 20);
  assert.equal(game.score, 2000);
  assert.equal(game.lives, 5);
  assert.ok(game.collectedPickups.has('final'));
  game.armVictory(); game.step({});
  assert.equal(game.victory, victory);
  assert.equal(game.score, 2000);
});

test('treasure URL grants preview the practice ending without awarding pickup points/lives or flags', () => {
  const game = new Game(assets, null, grants(config.treasures));
  assert.equal(game.victory.stage, 'pending');
  assert.equal(game.practice, true);
  assert.equal(game.score, 0);
  assert.equal(game.lives, 4);
  assert.equal(game.collectedPickups.size, 0);
});

test('victory freezes world/combat/refill, survives pause and hands the final score to high scores once', () => {
  const game = new Game(assets, null, grants(config.treasures));
  game.enemySystem.tick = () => {};
  advanceTo(game, 'departure');
  const frozen = JSON.stringify({ player: game.player, enemies: game.enemies, weapon: game.weapon,
    recharge: game.weaponRechargeTicks, shield: game.shield, refill: game.life.refillTicks, camera: game.camX });
  game.paused = true;
  const sequence = JSON.stringify(game.victory), clock = game.dosTickAccumulator;
  for (let n = 0; n < 300; n++) game.step({ jump: true, fire: true, doorPressed: true });
  assert.equal(JSON.stringify(game.victory), sequence);
  assert.equal(game.dosTickAccumulator, clock);
  game.paused = false;
  game.kill(); assert.equal(game.deathTransition, null);
  for (let n = 0; n < 10; n++) game.step({ right: true, jump: true, fire: true });
  assert.equal(JSON.stringify({ player: game.player, enemies: game.enemies, weapon: game.weapon,
    recharge: game.weaponRechargeTicks, shield: game.shield, refill: game.life.refillTicks, camera: game.camX }), frozen);
  advanceTo(game, 'ending');
  for (let n = 0; n < 100; n++) game.step({});
  assert.ok(game.victory.advance());
  assert.equal(game.runEnded, true);
  assert.equal(game.life.gameOver, false);
  assert.equal(game.lives, 0);
  const score = game.score;
  for (let n = 0; n < 100; n++) game.step({});
  assert.equal(game.score, score);
  const scores = new HighScores(), menu = new RunMenu(scores);
  menu.finish(game.score, game.practice); menu.submit('WINNER');
  assert.equal(menu.submit('DUPLICATE'), false);
  assert.deepEqual(scores.entries('practice'), [{ name: 'WINNER', score }]);
  assert.deepEqual(scores.entries(), []);
});

test('death animation freezes a pending win; exhausting lives can still lose before departure', () => {
  const game = new Game(assets, null, grants(config.treasures));
  game.life.spares = 0;
  game.kill();
  for (let n = 0; n < 200; n++) game.step({});
  assert.equal(game.life.gameOver, true);
  assert.equal(game.victory.countdown, 20);
  assert.equal(game.victory.active, false);
});
