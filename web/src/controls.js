// Browser bindings; original machine-code traces use logical actions instead.
export const CONTROLS = { jump: 'ArrowUp', fire: 'Space' };
export const DEFAULT_BINDINGS = Object.freeze({ left: 'ArrowLeft', right: 'ArrowRight',
  jump: 'ArrowUp', fire: 'Space', door: 'AltLeft', teleport: 'CapsLock' });
export const ACTION_LABELS = Object.freeze({ left: 'Move left', right: 'Move right',
  jump: 'Jump', fire: 'Fire', door: 'Door', teleport: 'Wand teleport' });
export const KEYBOARD_STORAGE_KEY = 'captain-comic.keyboard.v1';
const canonicalKey = code => code === 'AltRight' ? 'AltLeft' : code;
export const keyLabel = code => ({ Space: 'Space', AltLeft: 'Alt', AltRight: 'Alt',
  ArrowLeft: 'Left arrow', ArrowRight: 'Right arrow', ArrowUp: 'Up arrow', ArrowDown: 'Down arrow',
  CapsLock: 'Caps Lock', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift' }[code]
  ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Numpad '));

export function actionForKey(code, bindings = DEFAULT_BINDINGS) {
  return Object.keys(DEFAULT_BINDINGS).find(action => canonicalKey(bindings[action]) === canonicalKey(code));
}

export function bindableKey(code) {
  // Keep navigation, pause, sound, browser shortcuts and developer keys available.
  return typeof code === 'string' && /^(Key[A-Z]|Digit[0456789]|Arrow(Left|Right|Up|Down)|Space|Alt(Left|Right)|Shift(Left|Right)|CapsLock|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal)|Home|End|PageUp|PageDown|Insert|Delete|Backspace)$/.test(code);
}

export class KeyboardBindings {
  constructor(storage = null) {
    this.storage = storage; this.warning = !storage;
    this.bindings = { ...DEFAULT_BINDINGS };
    try {
      const saved = storage?.getItem(KEYBOARD_STORAGE_KEY);
      if (saved) {
        const value = JSON.parse(saved);
        const actions = Object.keys(DEFAULT_BINDINGS);
        if (!actions.every(action => bindableKey(value?.[action]))
          || new Set(actions.map(action => canonicalKey(value[action]))).size !== actions.length) {
          throw Error('Invalid keyboard bindings');
        }
        this.bindings = Object.fromEntries(Object.keys(DEFAULT_BINDINGS).map(action => [action, value[action]]));
      }
    } catch { this.warning = true; }
  }
  assign(action, code) {
    if (!Object.hasOwn(DEFAULT_BINDINGS, action) || !bindableKey(code)) return 'That key is reserved. Choose a letter, arrow, Space, Shift, Alt or number 0/4–9.';
    const owner = actionForKey(code, this.bindings);
    if (owner && owner !== action) return `Already assigned to ${ACTION_LABELS[owner]}. Choose another key.`;
    this.bindings[action] = code; this.save(); return null;
  }
  reset() { this.bindings = { ...DEFAULT_BINDINGS }; this.save(); }
  save() {
    try {
      if (!this.storage) throw Error('Storage unavailable');
      this.storage.setItem(KEYBOARD_STORAGE_KEY, JSON.stringify(this.bindings));
      this.warning = false;
    } catch { this.warning = true; }
  }
}

// Cancel both edges: Firefox/Linux can activate its menu bar on Alt release,
// even when the keydown used to enter a door was already cancelled.
export function preventGameplayKeyDefault(event, bindings = DEFAULT_BINDINGS) {
  if (actionForKey(event.code, bindings)
    || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'AltLeft', 'AltRight', 'CapsLock'].includes(event.code)) {
    event.preventDefault();
  }
}

export function actionHeld(action, keys, touch = null, bindings = DEFAULT_BINDINGS, pad = {}) {
  return keys.has(bindings[action])
    || (canonicalKey(bindings[action]) === 'AltLeft' && (keys.has('AltLeft') || keys.has('AltRight')))
    || Boolean(touch?.has(DEFAULT_BINDINGS[action])) || Boolean(pad[action]);
}

export function gameplayInput(keys, edges = {}, touch = null, bindings = DEFAULT_BINDINGS, pad = {}) {
  const held = action => actionHeld(action, keys, touch, bindings, pad);
  return {
    left: held('left'), right: held('right'), jump: held('jump'), fire: held('fire'),
    jumpPressed: Boolean(edges.jumpPressed), doorPressed: Boolean(edges.doorPressed),
    teleportPressed: Boolean(edges.teleportPressed),
  };
}
