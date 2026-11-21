import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LifeSystem, drawLifeIcons, drawEnergyCells, drawFireballCapacity } from '../web/src/lives.js';

const config = JSON.parse(readFileSync(new URL('../web/assets/mechanics.json', import.meta.url))).lives;

test('four spare helmets means five attempts, including the active player', () => {
  const life = new LifeSystem(config);
  assert.equal(life.spares, 4);
  for (let spares = 3; spares >= 0; spares--) {
    assert.equal(life.loseLife(), true);
    assert.equal(life.spares, spares);
    assert.equal(life.gameOver, false);
  }
  assert.equal(life.loseLife(), false);
  assert.equal(life.gameOver, true);
  assert.equal(life.spares, 0);
  assert.equal(life.loseLife(), false);
});

test('shield recharges over six timer ticks and a hit while already empty is fatal', () => {
  const life = new LifeSystem(config);
  for (let i = 1; i <= 6; i++) { life.tick(); assert.equal(life.shield, i); }
  assert.equal(life.refillTicks, 0);
  for (let i = 5; i >= 0; i--) {
    assert.equal(life.takeHit(), false);
    assert.equal(life.shield, i);
  }
  assert.equal(life.takeHit(), true);
  life.collectShield();
  assert.equal(life.shield, 0); // Scheduled, not instantly restored.
  life.tick();
  assert.equal(life.shield, 1);
});

test('score carry awards a life at 50,000 points without counting the active player', () => {
  const life = new LifeSystem(config);
  life.addPoints(49_900);
  assert.equal(life.spares, 4);
  life.addPoints(100);
  assert.equal(life.score, 50_000);
  assert.equal(life.spares, 5);
  assert.equal(life.scoreCarryProgress, 0);
});

test('eight-digit score wrap carries into the original adjacent extra-life counter', () => {
  const life = new LifeSystem(config);
  life.score = 99_999_000;
  life.addPoints(1000);
  assert.equal(life.score, 0);
  assert.equal(life.scoreCarryProgress, 2);
  life.score = 99_999_000;
  life.scoreCarryProgress = 4;
  life.addPoints(1000);
  assert.equal(life.scoreCarryProgress, 0); // Original clears it, not subtracts five.
  assert.equal(life.spares, 5);
});

test('full-shield pickup grants a spare; cap converts award to 22,500 points plus recharge', () => {
  const life = new LifeSystem(config);
  for (let i = 0; i < 6; i++) life.tick();
  life.collectShield();
  assert.equal(life.spares, 5);
  life.collectShield();
  assert.equal(life.spares, 5);
  assert.equal(life.score, 22_500);
  assert.equal(life.refillTicks, 6);
  for (let i = 0; i < 6; i++) life.tick();
  assert.equal(life.score, 33_300); // Six full-shield steps award 1,800 each.
  assert.equal(life.shield, 6);
});

test('helmet display always blits five lit/unlit 16x16 cells, not gray covers', () => {
  const calls = [], sprite = { img: 'helmets', w: 16, h: 16 };
  drawLifeIcons({ drawImage: (...args) => calls.push(args) }, sprite, 4, config.icons);
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.map(c => c[1]), [0, 0, 0, 0, 16]);
  assert.deepEqual(calls.map(c => c[5]), [48, 72, 96, 120, 144]);
  assert.ok(calls.every(c => c[6] === 180));
});

test('energy uses half/full weapon cells and whole shield cells at original positions', () => {
  const calls = [], sprite = { img: 'energy', w: 8, h: 16 };
  drawEnergyCells({ drawImage: (...args) => calls.push(args) }, sprite, 3, 2, config.energyCells);
  assert.equal(calls.length, 12);
  assert.deepEqual(calls.slice(0, 6).map(c => c[1] / 8), [2, 1, 0, 0, 0, 0]);
  assert.deepEqual(calls.slice(6).map(c => c[1] / 8), [2, 2, 0, 0, 0, 0]);
  assert.equal(calls[0][5], 248);
  assert.equal(calls[0][6], 54);
  assert.equal(calls[6][6], 82);
});

test('Cola capacity uses counts 1–5 and the alternate graphic bank', () => {
  const calls = [], sprite = { img: 'counts', w: 16, h: 16 };
  const ctx = { drawImage: (...args) => calls.push(args) };
  drawFireballCapacity(ctx, sprite, 0, config.fireballCapacity);
  assert.equal(calls.length, 0);
  for (let n = 1; n <= 5; n++) {
    drawFireballCapacity(ctx, sprite, n, config.fireballCapacity);
    drawFireballCapacity(ctx, sprite, n, config.fireballCapacity, true);
  }
  assert.deepEqual(calls.map(c => c[1] / 16), [0, 5, 1, 6, 2, 7, 3, 8, 4, 9]);
  assert.ok(calls.every(c => c[5] === 232 && c[6] === 112));
});
