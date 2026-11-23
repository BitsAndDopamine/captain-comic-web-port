import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BINDINGS, KeyboardBindings, KEYBOARD_STORAGE_KEY, actionForKey, actionHeld,
  bindableKey, gameplayInput, preventGameplayKeyDefault } from '../web/src/controls.js';
import { GamepadInput, GAMEPAD_STORAGE_KEY, DEFAULT_PAD_BUTTONS } from '../web/src/gamepad.js';
import { TouchState } from '../web/src/touch_controls.js';

const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const makePad = (index = 0, id = 'USB test controller') => ({ index, id, connected: true,
  mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) });
const press = (pad, ...indices) => { pad.buttons.forEach((b, i) => { b.pressed = indices.includes(i); b.value = Number(b.pressed); }); };

test('keyboard defaults and remaps persist without modifying the defaults', () => {
  const store = storage(), keyboard = new KeyboardBindings(store);
  assert.deepEqual(keyboard.bindings, DEFAULT_BINDINGS);
  for (const [action, code] of Object.entries({ left: 'KeyA', right: 'KeyD', jump: 'KeyW', fire: 'KeyF', door: 'KeyE', teleport: 'KeyT' })) {
    assert.equal(keyboard.assign(action, code), null);
    assert.equal(actionForKey(code, keyboard.bindings), action);
  }
  assert.deepEqual(new KeyboardBindings(store).bindings, keyboard.bindings);
  assert.equal(DEFAULT_BINDINGS.fire, 'Space');
  keyboard.reset(); assert.deepEqual(new KeyboardBindings(store).bindings, DEFAULT_BINDINGS);
});

test('reserved/duplicate keys, including equivalent Alt keys, cannot be assigned', () => {
  const keyboard = new KeyboardBindings();
  for (const code of ['Escape', 'Enter', 'Tab', 'F1', 'F2', 'Digit1', 'Digit2', 'Digit3', 'Backquote', 'BracketLeft', 'MetaLeft', 'ControlLeft', 'Unidentified']) {
    assert.equal(bindableKey(code), false, code);
    assert.ok(keyboard.assign('fire', code));
  }
  assert.ok(keyboard.assign('fire', 'AltRight'));
  assert.ok(keyboard.assign('missing', 'KeyF'));
  assert.equal(actionForKey('AltRight'), 'door');
  assert.equal(keyboard.assign('door', 'AltRight'), null);
  assert.equal(actionForKey('AltLeft', keyboard.bindings), 'door');
});

test('invalid/corrupt stored keymaps fall back completely; inaccessible storage keeps working', () => {
  for (const raw of ['not json', '{}', 'null', JSON.stringify({ ...DEFAULT_BINDINGS, fire: 'AltRight' }), JSON.stringify({ ...DEFAULT_BINDINGS, jump: 'Escape' })]) {
    const store = storage(); store.setItem(KEYBOARD_STORAGE_KEY, raw);
    const keyboard = new KeyboardBindings(store);
    assert.deepEqual(keyboard.bindings, DEFAULT_BINDINGS); assert.equal(keyboard.warning, true);
  }
  const denied = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  const keyboard = new KeyboardBindings(denied);
  assert.equal(keyboard.assign('fire', 'KeyF'), null);
  assert.equal(keyboard.bindings.fire, 'KeyF'); assert.equal(keyboard.warning, true);
});

test('remapped keyboard, canonical touch and controller inputs combine without cross-source releases', () => {
  const bindings = { ...DEFAULT_BINDINGS, left: 'KeyA', jump: 'KeyW', fire: 'KeyF', door: 'KeyE' };
  const keys = new Set(['KeyA', 'KeyW', 'KeyF']), touch = new TouchState();
  let input = gameplayInput(keys, {}, touch, bindings);
  assert.equal(input.left && input.jump && input.fire, true);
  touch.press(1, 'Space'); keys.delete('KeyF');
  assert.equal(gameplayInput(keys, {}, touch, bindings).fire, true);
  touch.clear(); assert.equal(gameplayInput(keys, {}, touch, bindings, { fire: true }).fire, true);
  assert.equal(gameplayInput(new Set(['Space']), {}, null, bindings).fire, false, 'old key no longer fires');
  touch.press(2, 'AltLeft'); assert.equal(actionHeld('door', keys, touch, bindings), true);
  assert.equal(actionHeld('door', new Set(['KeyE']), null, bindings), true);
});

test('assigned keys suppress browser defaults on both edges', () => {
  for (const type of ['keydown', 'keyup']) {
    const event = new Event(type, { cancelable: true }); Object.defineProperty(event, 'code', { value: 'Backspace' });
    preventGameplayKeyDefault(event, { ...DEFAULT_BINDINGS, fire: 'Backspace' });
    assert.equal(event.defaultPrevented, true);
  }
});

test('standard USB controller supports left+jump+fire simultaneously, with one-shot edges', () => {
  const pad = makePad(), gamepad = new GamepadInput(null, () => [null, pad]);
  gamepad.poll(); pad.axes[0] = -1; press(pad, 0, 2);
  const sample = gamepad.poll();
  assert.equal(sample.state.left && sample.state.jump && sample.state.fire, true);
  assert.equal(sample.edges.jump, true);
  assert.deepEqual(sample.pressedButtons, [0, 2]);
  assert.equal(gamepad.poll().edges.jump, false);
  pad.axes[0] = 0; press(pad, 2);
  const next = gamepad.poll(); assert.equal(next.state.left, false); assert.equal(next.state.jump, false); assert.equal(next.state.fire, true);
});

test('controller D-pad, analog trigger threshold and stick dead zone are independent', () => {
  const pad = makePad(), gamepad = new GamepadInput(null, () => [pad]); gamepad.poll();
  pad.axes[0] = 0.2; assert.equal(gamepad.poll().state.right, false);
  pad.axes[0] = 0.4; assert.equal(gamepad.poll().state.right, true);
  pad.axes[0] = 0; press(pad, 14); assert.equal(gamepad.poll().state.left, true);
  press(pad, 15); assert.equal(gamepad.poll().state.right, true);
  press(pad); pad.buttons[2].value = 0.6; assert.equal(gamepad.poll().state.fire, true);
});

test('controller remapping, duplicate rejection, axis and enabled preference persist', () => {
  const store = storage(), pad = makePad(), gamepad = new GamepadInput(store, () => [pad]);
  assert.ok(gamepad.assign('fire', 0)); assert.ok(gamepad.assign('fire', 14)); assert.ok(gamepad.assign('fire', 15));
  assert.ok(gamepad.assign('fire', -1)); assert.ok(gamepad.assign('bad', 5));
  assert.equal(gamepad.assign('fire', 5), null);
  gamepad.config.axis = 1; gamepad.save(); gamepad.poll(); pad.axes[1] = -1; press(pad, 5);
  assert.equal(gamepad.poll().state.fire, true); assert.equal(gamepad.state.left, true);
  const restored = new GamepadInput(store); assert.equal(restored.config.buttons.fire, 5); assert.equal(restored.config.axis, 1);
  gamepad.config.enabled = false; gamepad.save(); assert.equal(gamepad.poll().state.fire, false);
  assert.equal(new GamepadInput(store).config.enabled, false);
  gamepad.resetDefaults(); assert.deepEqual(gamepad.config.buttons, DEFAULT_PAD_BUTTONS);
});

test('controller blocked API, corrupt storage and failed saves degrade without breaking keyboard input', () => {
  const gamepad = new GamepadInput(null, () => { throw Error('SecurityError'); });
  assert.equal(gamepad.poll().unavailable, true);
  for (const raw of ['{}', 'null', 'bad', JSON.stringify({ enabled: true, axis: 0, buttons: { ...DEFAULT_PAD_BUTTONS, fire: 14 } })]) {
    const store = storage(); store.setItem(GAMEPAD_STORAGE_KEY, raw);
    const bad = new GamepadInput(store, () => []);
    assert.equal(bad.warning, true); assert.deepEqual(bad.config.buttons, DEFAULT_PAD_BUTTONS);
  }
  assert.equal(gamepad.assign('fire', 5), null); assert.equal(gamepad.warning, true);
  assert.equal(gameplayInput(new Set(['Space'])).fire, true);
});

test('held inputs are disarmed until neutral after blur, reset, reconnect and device change', () => {
  let pads = [makePad()]; const gamepad = new GamepadInput(null, () => pads);
  press(pads[0], 0); assert.equal(gamepad.poll().state.jump, false);
  press(pads[0]); gamepad.poll(); press(pads[0], 0); assert.equal(gamepad.poll().edges.jump, true);
  gamepad.reset(); assert.equal(gamepad.poll().state.jump, false);
  press(pads[0]); gamepad.poll(); press(pads[0], 0); assert.equal(gamepad.poll(false).state.jump, false);
  assert.equal(gamepad.poll(true).state.jump, false);
  pads = []; assert.equal(gamepad.poll().disconnected, true); assert.equal(gamepad.poll().disconnected, false);
  pads = [makePad()]; press(pads[0], 0); assert.equal(gamepad.poll().state.jump, false);
  press(pads[0]); gamepad.poll(); press(pads[0], 0); assert.equal(gamepad.poll().state.jump, true);
  pads = [makePad(1, 'Other controller')]; assert.equal(gamepad.poll().disconnected, true);
});

test('explicit controller selection does not silently switch to a different device on disconnect', () => {
  const first = makePad(0), second = makePad(2, 'Second USB pad'); let pads = [first, null, second];
  const gamepad = new GamepadInput(null, () => pads); gamepad.selected = 2; gamepad.poll();
  press(first, 0); press(second, 2); assert.equal(gamepad.poll().state.fire, true); assert.equal(gamepad.state.jump, false);
  pads = [first]; const sample = gamepad.poll(); assert.equal(sample.pad, undefined); assert.equal(sample.disconnected, true);
});
