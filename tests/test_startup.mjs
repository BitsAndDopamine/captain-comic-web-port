import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Startup, initialPlayerPosition } from '../web/src/startup.js';
import { Player } from '../web/src/player.js';

const config = JSON.parse(readFileSync(new URL('../web/assets/startup.json', import.meta.url)));
const sprites = JSON.parse(readFileSync(new URL('../web/assets/sprites.json', import.meta.url)));
const tick = 1 / config.timerTicksPerSecond;

test('notice/registration retain original text; K/J request separate input setup menus', () => {
  const startup = new Startup(config);
  assert.match(startup.text, /Revision 5/);
  assert.match(startup.text, /Shareware/);
  startup.press('KeyR');
  assert.equal(startup.text, config.registration);
  startup.press('Enter');
  assert.equal(startup.text, config.notice);
  assert.equal(startup.press('KeyK'), 'keyboard');
  assert.equal(startup.press('KeyJ'), 'gamepad');
  assert.equal(startup.text, config.notice);
  assert.equal(startup.textPage, null);
  assert.equal(startup.stage.id, 'notice');
});

test('startup follows code order, not SYS file order, and waits on both pages', () => {
  const startup = new Startup(config);
  assert.equal(startup.press('Enter'), 'theme');
  assert.equal(startup.stage.screen, 'SYS000');
  startup.press('Enter'); // Title is timed, not dismissible by this key.
  assert.equal(startup.stage.id, 'title');
  startup.step(18 * tick);
  assert.equal(startup.stage.id, 'title');
  startup.step(1.01 * tick);
  assert.equal(startup.stage.screen, 'SYS001');
  startup.step(60);
  assert.equal(startup.stage.id, 'story');
  startup.press('Enter');
  assert.equal(startup.stage.screen, 'SYS004');
  startup.step(60);
  assert.equal(startup.stage.id, 'legend');
  assert.equal(startup.press('Enter'), 'stopTheme');
  assert.equal(startup.stage.screen, 'SYS003');
  assert.ok(!config.stages.some(s => s.screen === 'SYS002'));
});

test('arrival waits, reveals the player halfway through the effect, then starts play', () => {
  const startup = new Startup(config);
  startup.press('Enter'); startup.step(20 * tick);
  startup.step(5 * tick); // Story reveal must finish before accepting its key.
  startup.press('Enter'); startup.press('Enter'); startup.step(8.01 * tick);
  assert.equal(startup.stage.id, 'arrival');
  assert.equal(startup.arrivalFrame, null);
  assert.equal(startup.arrivalPlayerVisible, false);
  startup.step(15.01 * tick);
  assert.equal(startup.arrivalFrame, 0);
  assert.equal(startup.arrivalPlayerVisible, false);
  startup.step(6 * tick);
  assert.equal(startup.arrivalFrame, 6);
  assert.equal(startup.arrivalPlayerVisible, true);
  startup.step(7 * tick);
  assert.equal(startup.active, false);
});

test('title/story palette reveals use five DOS ticks and story does not accept an early key', () => {
  const startup = new Startup(config);
  startup.press('Enter');
  for (let n = 0; n < 5; n++) {
    assert.equal(startup.paletteStep, n);
    assert.equal(startup.canAdvance, false);
    startup.step(tick);
  }
  assert.equal(startup.paletteStep, 4);
  startup.step(14 * tick);
  assert.equal(startup.stage.id, 'story');
  for (let n = 0; n < 5; n++) {
    startup.press('Enter');
    assert.equal(startup.stage.id, 'story');
    assert.equal(startup.paletteStep, n);
    assert.equal(startup.canAdvance, false);
    startup.step(tick);
  }
  assert.equal(startup.canAdvance, true);
  startup.press('Enter');
  assert.equal(startup.stage.id, 'legend');
  assert.equal(startup.paletteStep, null, 'legend is a page flip, not another fade');
  assert.equal(startup.canAdvance, true);
});

test('original spawn is applied to sprite coordinates, not the short web hitbox', () => {
  const player = new Player(0, 0);
  const position = initialPlayerPosition(config, sprites.PLAYER, player);
  assert.deepEqual(position, { x: 114, y: 113 });
  assert.equal(position.x + (player.w - sprites.PLAYER.w) / 2, 112);
  assert.equal(position.y + player.h - sprites.PLAYER.h, 96);
  assert.equal(position.y + player.h, 128);
  assert.equal(config.initialState.cameraX, 24);
  assert.equal(config.initialState.spritePosition.x - config.cameraFollowOffsetPixels, 24);
  assert.equal(config.initialState.area, 'FOREST');
  assert.equal(config.initialState.strip, 0);
});
