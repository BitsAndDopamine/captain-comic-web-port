import assert from 'node:assert/strict';
import test from 'node:test';
import { HighScores, RunMenu, cleanName, isPracticeSetup, SCORE_STORAGE_KEY } from '../web/src/high_scores.js';

function memoryStorage(initial = null) {
  let value = initial;
  return { getItem(key) { assert.equal(key, SCORE_STORAGE_KEY); return value; },
    setItem(key, data) { assert.equal(key, SCORE_STORAGE_KEY); value = data; } };
}

test('top ten ranks strictly above lower scores, after ties, never admits a zero', () => {
  const scores = new HighScores(memoryStorage());
  assert.equal(scores.rank(0), -1);
  for (let n = 1; n <= 10; n++) assert.ok(scores.add(`P${n}`, n * 100));
  assert.deepEqual(scores.entries().map(row => row.score), [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]);
  assert.equal(scores.add('tie last', 100), false);
  assert.equal(scores.rank(500), 6);
  assert.ok(scores.add('tie middle', 500));
  assert.equal(scores.entries()[5].name, 'P5');
  assert.equal(scores.entries()[6].name, 'tie middle');
  assert.equal(scores.entries().length, 10);
  assert.equal(scores.entries().at(-1).score, 200);
});

test('scores and separate practice board survive reload; returned rows cannot mutate storage', () => {
  const storage = memoryStorage(), scores = new HighScores(storage);
  scores.add('NORMAL', 2000);
  scores.add('PRACTICE', 99900, 'practice');
  const reload = new HighScores(storage);
  assert.deepEqual(reload.entries(), [{ name: 'NORMAL', score: 2000 }]);
  assert.deepEqual(reload.entries('practice'), [{ name: 'PRACTICE', score: 99900 }]);
  reload.entries()[0].name = 'changed';
  assert.equal(reload.entries()[0].name, 'NORMAL');
  assert.equal(reload.warning, false);
});

test('name buffer matches DOS 12 visible characters; control bytes and dollar terminator are stripped', () => {
  assert.equal(cleanName('abcdefghijklmnop'), 'abcdefghijkl');
  assert.equal(cleanName('  A\nB\0C$\u00e4  '), 'ABC');
  assert.equal(cleanName(''), '');
  // HTML-like input remains plain data, never markup (UI uses textContent).
  assert.equal(cleanName('<b>BOB</b>'), '<b>BOB</b>');
});

test('invalid scores never enter the table or persistence', () => {
  const scores = new HighScores(memoryStorage());
  for (const n of [-100, 1, 12.5, 100_000_000, NaN, Infinity, '2000', null]) {
    assert.equal(scores.add('bad', n), false);
  }
  assert.ok(scores.add('max', 99_999_900));
});

test('corrupt, unsupported, blocked and quota-full storage cannot break in-memory scoring', () => {
  for (const storage of [null, memoryStorage('{broken'), memoryStorage('null'),
    memoryStorage('{"version":99}'), { getItem() { throw Error('blocked'); } },
    { getItem() { return null; }, setItem() { throw Error('quota'); } }]) {
    const scores = new HighScores(storage);
    assert.ok(scores.add('local', 100));
    assert.deepEqual(scores.entries(), [{ name: 'local', score: 100 }]);
  }
  const full = new HighScores({ getItem() { return null; }, setItem() { throw Error('quota'); } });
  full.add('local', 100);
  assert.equal(full.warning, true);
});

test('stored entries are sanitized, sorted and limited; invalid rows are discarded', () => {
  const rows = Array.from({ length: 12 }, (_, n) => ({ name: 'abcdefghijklmnop', score: (n + 1) * 100 }));
  const scores = new HighScores(memoryStorage(JSON.stringify({ version: 1,
    normal: [...rows, null, { name: 'bad', score: -100 }, { score: 500 }], practice: [] })));
  assert.equal(scores.entries().length, 10);
  assert.deepEqual(scores.entries()[0], { name: 'abcdefghijkl', score: 1200 });
});

test('only state grants make URL runs practice; skipping intro alone does not', () => {
  const normal = { items: [], colas: null, weapon: null, shield: null, skipIntro: true };
  assert.equal(isPracticeSetup(null), false);
  assert.equal(isPracticeSetup(normal), false);
  for (const change of [{ items: ['boots'] }, { colas: 0 }, { weapon: 0 }, { shield: 6 }]) {
    assert.equal(isPracticeSetup({ ...normal, ...change }), true);
  }
});

test('pause/continue and opening scores return to the exact previous menu state', () => {
  const menu = new RunMenu(new HighScores());
  assert.equal(menu.pause(), true);
  assert.equal(menu.frozen, true);
  assert.equal(menu.pause(), false);
  menu.showScores();
  assert.equal(menu.mode, 'scores');
  menu.closeScores();
  assert.equal(menu.mode, 'paused');
  assert.equal(menu.resume(), true);
  assert.equal(menu.frozen, false);
  menu.showScores(); menu.closeScores();
  assert.equal(menu.mode, 'playing');
});

test('a finished run submits exactly once, with its original board and score', () => {
  const scores = new HighScores(), menu = new RunMenu(scores);
  assert.ok(menu.finish(2000, true));
  assert.equal(menu.mode, 'name');
  assert.equal(menu.finish(99900), false);
  menu.showScores('normal');
  assert.equal(menu.mode, 'name');
  assert.equal(menu.closeScores(), false);
  assert.ok(menu.submit('COMIC'));
  assert.equal(menu.submit('duplicate'), false);
  assert.equal(menu.finish(2000), false);
  assert.deepEqual(scores.entries('practice'), [{ name: 'COMIC', score: 2000 }]);
  assert.deepEqual(scores.entries(), []);
  menu.closeScores();
  assert.equal(menu.mode, 'playing');
  assert.equal(menu.finished, true);
  menu.reset();
  assert.equal(menu.finished, false);
  assert.ok(menu.finish(100));
});

test('non-qualifying runs show the table without asking for a name', () => {
  const menu = new RunMenu(new HighScores());
  menu.finish(0);
  assert.equal(menu.mode, 'scores');
  assert.equal(menu.finished, true);
  assert.equal(menu.pending, null);
});
