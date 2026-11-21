import assert from 'node:assert/strict';
import test from 'node:test';
import { fitGameScreen, Presentation } from '../web/src/presentation.js';
import { TouchState, TouchControls } from '../web/src/touch_controls.js';

test('screen fit preserves 8:5 and stays within portrait, landscape and desktop space', () => {
  for (const spec of [
    { width: 390, height: 844, paddingX: 16, paddingY: 16, footerHeight: 114, controlsHeight: 152 },
    { width: 320, height: 568, paddingX: 16, paddingY: 16, footerHeight: 164, controlsHeight: 152 },
    { width: 844, height: 390, paddingX: 16, paddingY: 16, footerHeight: 64, sideWidth: 286 },
    { width: 1920, height: 1080, paddingX: 16, paddingY: 16, footerHeight: 44 },
    { width: 960, height: 768, footerHeight: 64 },
  ]) {
    const width = fitGameScreen(spec);
    assert.ok(Number.isInteger(width) && width > 0);
    assert.ok(width <= spec.width - (spec.paddingX ?? 0) - (spec.sideWidth ?? 0));
    assert.ok(width * 5 / 8 <= spec.height - (spec.paddingY ?? 0)
      - spec.footerHeight - (spec.controlsHeight ?? 0) - 24);
  }
  assert.equal(fitGameScreen({ width: 0, height: 0 }), 1);
});

test('multiple fingers on one action produce one edge and stay held until the last release', () => {
  const state = new TouchState();
  assert.equal(state.press(1, 'ArrowUp'), true);
  assert.equal(state.press(1, 'ArrowUp'), false);
  assert.equal(state.press(2, 'ArrowUp'), false);
  state.release(1); assert.equal(state.has('ArrowUp'), true);
  state.release(2); assert.equal(state.has('ArrowUp'), false);
  assert.equal(state.press(3, 'ArrowUp'), true);
  state.clear(); assert.equal(state.pointers.size, 0);
});

test('reusing a pointer changes only that pointer’s action', () => {
  const state = new TouchState();
  state.press(1, 'ArrowLeft'); state.press(2, 'Space');
  state.press(1, 'ArrowRight');
  assert.equal(state.has('ArrowLeft'), false);
  assert.equal(state.has('ArrowRight'), true);
  assert.equal(state.has('Space'), true);
});

class Button extends EventTarget {
  constructor(code) {
    super(); this.dataset = { code }; this.captured = new Set(); this.classes = new Set();
    this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
  }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
}
const event = (type, props = {}) => Object.assign(new Event(type, { cancelable: true }), props);

test('pointer capture, cancellation, simultaneous actions and disabled menus do not leave stuck keys', () => {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    const buttons = [new Button('ArrowRight'), new Button('ArrowUp'), new Button('Space')], edges = [];
    const controls = new TouchControls({ querySelectorAll: () => buttons }, { onPress: code => edges.push(code) });
    buttons[0].dispatchEvent(event('pointerdown', { pointerId: 1, pointerType: 'touch' }));
    assert.equal(controls.has('ArrowRight'), false, 'startup/menu controls begin disabled');
    controls.setEnabled(true);
    buttons.forEach((button, n) => button.dispatchEvent(event('pointerdown', { pointerId: n + 1, pointerType: 'touch' })));
    assert.deepEqual(edges, ['ArrowRight', 'ArrowUp', 'Space']);
    assert.ok(buttons.every(button => button.classes.has('is-held')));
    window.dispatchEvent(event('pointercancel', { pointerId: 2 }));
    assert.equal(controls.has('ArrowUp'), false);
    assert.equal(controls.has('ArrowRight'), true);
    buttons[0].dispatchEvent(event('lostpointercapture', { pointerId: 1 }));
    assert.equal(controls.has('ArrowRight'), false);
    assert.equal(controls.has('Space'), true);
    controls.setEnabled(false);
    assert.equal(controls.state.pointers.size, 0);
    assert.ok(buttons.every(button => button.disabled && !button.classes.has('is-held')));
    assert.equal(buttons[2].captured.size, 0);
    window.dispatchEvent(event('pointerup', { pointerId: 3 }));
    assert.equal(controls.has('Space'), false);
  } finally { globalThis.window = previous; }
});

test('capture failure still releases globally and right-click never fires', () => {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    const button = new Button('Space'); button.setPointerCapture = () => { throw Error('no capture'); };
    const controls = new TouchControls({ querySelectorAll: () => [button] }); controls.setEnabled(true);
    button.dispatchEvent(event('pointerdown', { pointerId: 4, pointerType: 'mouse', button: 2 }));
    assert.equal(controls.has('Space'), false);
    button.dispatchEvent(event('pointerdown', { pointerId: 5, pointerType: 'touch' }));
    assert.equal(controls.has('Space'), true);
    window.dispatchEvent(event('pointerup', { pointerId: 5 }));
    assert.equal(controls.has('Space'), false);
    button.dispatchEvent(event('click', { detail: 0 }));
    assert.equal(controls.has('Space'), true, 'keyboard/assistive activation supplies a short tap');
    controls.clear();
    assert.equal(controls.taps.size, 0);
    assert.equal(controls.has('Space'), false);
  } finally { globalThis.window = previous; }
});

async function fullscreenCase(run) {
  const previous = globalThis.document;
  const classes = () => ({ toggle() {} });
  const document = Object.assign(new EventTarget(), { fullscreenElement: null, body: { classList: classes() } });
  globalThis.document = document;
  const shell = { classList: classes() }, button = { setAttribute(name, value) { this[name] = value; } };
  const view = Object.assign(Object.create(Presentation.prototype), {
    shell, fullscreenButton: button, status: {}, pending: false, expanded: false,
    resets: 0, interrupts: 0,
    onResetInput() { this.resets++; }, onInterrupt() { this.interrupts++; }, layout() {},
  });
  try { await run({ view, document, shell, button }); }
  finally { globalThis.document = previous; }
}

test('native fullscreen requests the entire game shell and can exit without changing game state', () => fullscreenCase(async ({ view, document, shell, button }) => {
  shell.requestFullscreen = async function() { assert.equal(this, shell); document.fullscreenElement = shell; };
  document.exitFullscreen = async function() { assert.equal(this, document); document.fullscreenElement = null; };
  await view.toggleFullscreen();
  assert.equal(view.nativeFullscreen, true);
  assert.equal(button.textContent, 'Exit fullscreen');
  assert.equal(button['aria-pressed'], 'true');
  assert.equal(view.handleEscape(), true, 'browser owns native fullscreen Escape');
  await view.toggleFullscreen();
  assert.equal(view.nativeFullscreen, false);
  assert.equal(button.textContent, 'Fullscreen');
  assert.equal(button.disabled, false);
}));

test('unsupported and rejected native fullscreen use an honest expanded-view fallback', async () => {
  for (const reject of [false, true]) await fullscreenCase(async ({ view, shell, button }) => {
    if (reject) shell.requestFullscreen = async () => { throw Error('not allowed'); };
    await view.toggleFullscreen();
    assert.equal(view.expanded, true);
    assert.equal(button.textContent, 'Exit expanded view');
    assert.match(view.status.textContent, /Native fullscreen is unavailable/);
    assert.equal(view.status.hidden, false);
    assert.equal(view.handleEscape(), true);
    assert.equal(view.expanded, false);
    assert.equal(view.interrupts, 1);
    assert.equal(view.status.hidden, true);
  });
});

test('duplicate fullscreen clicks are ignored until the first request settles', () => fullscreenCase(async ({ view, shell, document }) => {
  let complete, calls = 0;
  shell.requestFullscreen = () => { calls++; return new Promise(resolve => { complete = () => { document.fullscreenElement = shell; resolve(); }; }); };
  const first = view.toggleFullscreen();
  assert.equal(view.pending, true);
  await view.toggleFullscreen();
  assert.equal(calls, 1);
  complete(); await first;
  assert.equal(view.pending, false);
}));

test('an embedded browser that never settles fullscreen falls back instead of sticking', () => fullscreenCase(async ({ view, shell, button }) => {
  view.fullscreenTimeout = 5;
  shell.requestFullscreen = () => new Promise(() => {});
  await view.toggleFullscreen();
  assert.equal(view.pending, false);
  assert.equal(view.expanded, true);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Exit expanded view');
}));

test('failed fullscreen exit keeps the exit control usable and reports the problem', () => fullscreenCase(async ({ view, document, shell, button }) => {
  document.fullscreenElement = shell;
  document.exitFullscreen = async () => { throw Error('exit failed'); };
  await view.toggleFullscreen();
  assert.equal(view.nativeFullscreen, true);
  assert.equal(button.disabled, false);
  assert.match(view.status.textContent, /Could not leave fullscreen/);
}));

test('prefixed fullscreen APIs use the same shell and exit path', () => fullscreenCase(async ({ view, document, shell }) => {
  shell.webkitRequestFullscreen = function() { document.webkitFullscreenElement = this; };
  document.webkitExitFullscreen = function() { this.webkitFullscreenElement = null; };
  await view.toggleFullscreen(); assert.equal(view.nativeFullscreen, true);
  await view.toggleFullscreen(); assert.equal(view.nativeFullscreen, false);
}));
