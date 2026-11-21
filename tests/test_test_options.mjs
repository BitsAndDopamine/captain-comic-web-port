import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseTestOptions, applyTestOptions } from '../web/src/test_options.js';
import { LifeSystem } from '../web/src/lives.js';
import { Startup } from '../web/src/startup.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const mechanics = json('../web/assets/mechanics.json');
const parse = search => parseTestOptions(search, mechanics);

test('empty URLs and old test labels preserve normal startup and starting values', () => {
  const expected = { items: [], colas: null, weapon: null, shield: null, skipIntro: false };
  assert.deepEqual(parse(''), expected);
  assert.deepEqual(parse('?remaining-items=20261121&unknown=1'), expected);
});

test('URL inventory supports all tools, treasures, repeated parameters, case and duplicates', () => {
  assert.deepEqual(parse('?items=Boots,%20WAND,boots,not-an-item&items=lantern,gems,crown,gold').items,
    ['boots', 'wand', 'lantern', 'gems', 'crown', 'gold']);
  assert.deepEqual(parse('?items=all').items, ['key', 'boots', 'wand', 'lantern', 'corkscrew']);
  assert.deepEqual(parse('?items=').items, []);
  assert.deepEqual(parse('?items=%3Cscript%3E').items, []);
});

test('Cola gives usable weapon energy; explicit weapon overrides and consumable aliases work', () => {
  assert.deepEqual(parse('?items=boots,wand,lantern&colas=5&skipIntro=1'), {
    items: ['boots', 'wand', 'lantern'], colas: 5, weapon: 12, shield: null, skipIntro: true,
  });
  assert.equal(parse('?colas=3&weapon=0').weapon, 0);
  assert.equal(parse('?colas=0').weapon, null);
  const consumables = parse('?items=cola,shield');
  assert.equal(consumables.colas, 1);
  assert.equal(consumables.weapon, 12);
  assert.equal(consumables.shield, 6);
  assert.deepEqual(consumables.items, []);
});

test('numeric options clamp to original caps and ignore malformed values', () => {
  assert.equal(parse('?colas=999').colas, 5);
  assert.equal(parse('?weapon=999').weapon, 12);
  assert.equal(parse('?shield=999').shield, 6);
  assert.equal(parse('?colas=-10&weapon=-2&shield=-3').shield, 0);
  assert.equal(parse('?colas=-10').colas, 0);
  for (const invalid of ['', 'NaN', 'Infinity', '1.5', '1e2', '2cans', '99999999999999999999999']) {
    const options = parse(`?colas=${invalid}&shield=${invalid}&weapon=${invalid}`);
    assert.equal(options.colas, null, invalid);
    assert.equal(options.shield, null, invalid);
    assert.equal(options.weapon, null, invalid);
  }
  assert.equal(parse('?skipIntro=TRUE').skipIntro, true);
  assert.equal(parse('?skipIntro=0').skipIntro, false);
  assert.equal(parse('?skipIntro=no').skipIntro, false);
});

test('setup is repeatable for New game, grants no points/lives and leaves pickups available', () => {
  const options = parse('?items=all,gems&colas=5&shield=6');
  for (let run = 0; run < 2; run++) {
    const life = new LifeSystem(mechanics.lives);
    const game = { life, inventory: new Set(), collectedPickups: new Set(), colas: 0, weapon: 0,
      get shield() { return life.shield; }, set shield(n) { life.shield = n; } };
    applyTestOptions(game, options);
    assert.equal(game.colas, 5);
    assert.equal(game.weapon, 12);
    assert.equal(game.shield, 6);
    assert.equal(life.refillTicks, 0);
    assert.equal(life.score, 0);
    assert.equal(life.spares, 4);
    assert.equal(game.collectedPickups.size, 0);
    assert.ok(game.inventory.has('gems'));
  }
});

test('default setup keeps the normal shield refill, explicit zero suppresses it', () => {
  const game = { inventory: new Set(), life: { refillTicks: 6 }, shield: 0 };
  applyTestOptions(game, parse(''));
  assert.equal(game.life.refillTicks, 6);
  applyTestOptions(game, parse('?shield=0'));
  assert.equal(game.life.refillTicks, 0);
});

test('skipIntro bypasses every startup screen without requesting a theme or arrival cue', () => {
  const startup = new Startup(json('../web/assets/startup.json'));
  startup.textPage = 'controls';
  startup.skip();
  assert.equal(startup.active, false);
  assert.equal(startup.text, null);
  assert.equal(startup.arrivalFrame, null);
  assert.equal(startup.press('Enter'), null);
  startup.step(1);
  assert.equal(startup.active, false);
});
