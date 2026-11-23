import assert from 'node:assert/strict';
import test from 'node:test';
import { fireballOrigin, Fireball } from '../web/src/entities.js';
import { Player } from '../web/src/player.js';
import { fireballEnemyContact } from '../web/src/enemies.js';

const playerSprite = { w: 16, h: 32, frames: 10, img: {} };
const shotSprite = { w: 16, h: 8, frames: 2, img: {} };
const config = { coordinateUnitPixels: 8 };

test('grounded fireball comes from upper body, not the collision-box feet', () => {
  const p = new Player(100, 113); // Feet at 128; rendered sprite top at 96.
  const origin = fireballOrigin(p, playerSprite, config);
  assert.deepEqual(origin, { x: 98, y: 104 });
  assert.equal(origin.y - (p.y + 8), -17);
  assert.ok(origin.y + shotSprite.h < p.y + p.h);
});

test('origin follows the actual drawn sprite in either direction and while airborne', () => {
  for (const facing of [-1, 1]) for (const y of [12.25, 70, 113]) {
    const p = new Player(100, y);
    p.facing = facing;
    let drawn;
    p.draw({ drawImage: (...args) => { drawn = args; } }, 0, 0,
      { x: 0, y: 0 }, playerSprite);
    const origin = fireballOrigin(p, playerSprite, config);
    assert.equal(Math.round(origin.x), drawn[5]);
    assert.equal(Math.round(origin.y) - 8, drawn[6]);
  }
});

test('straight shot retains corrected height; Corkscrew oscillates around it', () => {
  const p = new Player(100, 113);
  const origin = fireballOrigin(p, playerSprite, config);
  const straight = new Fireball(shotSprite, origin.x, origin.y, -1);
  straight.tick({}, 0);
  assert.equal(straight.y, 104);
  assert.equal(straight.x, origin.x - 16);
  const wave = new Fireball(shotSprite, origin.x, origin.y, 1, true);
  wave.tick({}, 0);
  assert.equal(wave.y, 112);
  wave.tick({}, 0);
  assert.equal(wave.y, 104);
});

test('an enemy just beyond either drawing edge can be hit by a shot still inside the original range', () => {
  const camera = 80;
  for (const [start, direction, enemyX] of [[20, 1, 23], [2, -1, -1]]) {
    const shot = new Fireball(shotSprite, camera + start * 8, 80, direction);
    shot.tick({}, camera);
    const enemy = { alive: true, xUnits: camera / 8 + enemyX, yUnits: 10 };
    assert.equal(shot.alive, true);
    assert.equal(fireballEnemyContact(shot, enemy), true);
  }
});

test('fireballs cross the complete visible playfield without disappearing early', () => {
  for (const camera of [0, 80, 81.5]) for (const direction of [-1, 1]) {
    for (const x of [-15, -1, 0, 175, 176, 184, 195]) {
      const shot = new Fireball(shotSprite, camera + x - direction * 16, 80, direction);
      shot.tick({}, camera, 196);
      assert.equal(shot.alive, true, `camera=${camera} direction=${direction} visible x=${x}`);
    }
  }
});

test('shots expire only after the whole sprite is more than 20px outside either edge', () => {
  for (const camera of [0, 80, 1840]) for (const width of [160, 196, 240]) for (const corkscrew of [false, true]) {
    for (const [direction, boundary] of [[-1, -20 - shotSprite.w], [1, width + 20]]) {
      for (const distance of [-0.25, 0, 0.25]) {
        const targetX = boundary + direction * distance;
        const shot = new Fireball(shotSprite, camera + targetX - direction * 16, 80, direction, corkscrew,
          { coordinateUnitPixels: 8, maxCameraXUnits: 22 });
        shot.tick({}, camera, width);
        assert.equal(shot.alive, distance <= 0, `camera=${camera} width=${width} dir=${direction} distance=${distance}`);
      }
    }
  }
});

test('both offscreen margins still allow enemy hits before the fireball expires', () => {
  const camera = 160;
  for (const [direction, targetX] of [[-1, -24], [1, 208]]) {
    const shot = new Fireball(shotSprite, camera + targetX - direction * 16, 80, direction);
    shot.tick({}, camera, 196);
    const enemy = { alive: true, xUnits: (camera + targetX) / 8, yUnits: 10 };
    assert.equal(shot.alive, true);
    assert.equal(fireballEnemyContact(shot, enemy), true);
    shot.tick({}, camera, 196);
    assert.equal(shot.alive, false);
  }
});

test('offscreen lifetime follows the current camera without rounding simulation positions', () => {
  const shot = new Fireball(shotSprite, 200, 80, 1);
  shot.tick({}, 0, 196); // x=216: exactly 20px beyond the right edge.
  assert.equal(shot.alive, true);
  shot.tick({}, 16.5, 196); // x=232, now only 19.5px outside the scrolled view.
  assert.equal(shot.alive, true);
  shot.tick({}, 16.5, 196);
  assert.equal(shot.alive, false);
});
