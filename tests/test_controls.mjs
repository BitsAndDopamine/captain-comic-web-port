import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTROLS, gameplayInput, preventGameplayKeyDefault } from '../web/src/controls.js';
import { TouchState } from '../web/src/touch_controls.js';

test('Up jumps and Space fires independently or together', () => {
  assert.equal(CONTROLS.jump, 'ArrowUp');
  assert.equal(CONTROLS.fire, 'Space');
  for (const [keys, jump, fire] of [[[], false, false], [['ArrowUp'], true, false],
    [['Space'], false, true], [['ArrowUp', 'Space'], true, true], [['KeyM'], false, false]]) {
    const input = gameplayInput(new Set(keys));
    assert.equal(input.jump, jump);
    assert.equal(input.fire, fire);
  }
});

test('touch and keyboard sources combine without releasing each other', () => {
const keyboard = new Set(['ArrowRight', 'Space']), touch = new TouchState();
  touch.press(1, 'ArrowRight'); touch.press(2, 'ArrowUp'); touch.press(3, 'Space');
  assert.deepEqual(gameplayInput(keyboard, { jumpPressed: true }, touch), {
    left: false, right: true, jump: true, fire: true,
    jumpPressed: true, doorPressed: false, teleportPressed: false,
  });
  touch.clear();
  assert.equal(gameplayInput(keyboard, {}, touch).right, true);
  touch.press(4, 'Space'); keyboard.clear();
  assert.equal(gameplayInput(keyboard, {}, touch).fire, true);
  touch.release(4);
  assert.equal(gameplayInput(keyboard, {}, touch).fire, false);
});

test('movement and one-shot action edges survive browser input mapping', () => {
  assert.deepEqual(gameplayInput(new Set(['ArrowLeft', 'ArrowRight']), {
    jumpPressed: true, doorPressed: true, teleportPressed: true,
  }), { left: true, right: true, jump: false, fire: false,
    jumpPressed: true, doorPressed: true, teleportPressed: true });
});

test('game keys suppress browser defaults on keydown AND keyup, including both door Alt keys', () => {
  for (const code of ['AltLeft', 'AltRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'CapsLock']) {
    for (const type of ['keydown', 'keyup']) {
      const event = new Event(type, { cancelable: true });
      Object.defineProperty(event, 'code', { value: code });
      preventGameplayKeyDefault(event);
      assert.equal(event.defaultPrevented, true, `${code} ${type}`);
    }
  }
});

test('browser focus navigation and unrelated keys retain their defaults', () => {
  for (const code of ['Tab', 'Enter', 'Escape', 'KeyA', 'ControlLeft', 'MetaLeft']) {
    const event = new Event('keyup', { cancelable: true });
    Object.defineProperty(event, 'code', { value: code });
    preventGameplayKeyDefault(event);
    assert.equal(event.defaultPrevented, false, code);
  }
});
