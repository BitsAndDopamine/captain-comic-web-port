// Browser Gamepad API adapter. Physical input never overwrites keyboard/touch state.
export const GAMEPAD_STORAGE_KEY = 'captain-comic.gamepad.v1';
export const DEFAULT_PAD_BUTTONS = Object.freeze({ jump: 0, fire: 2, door: 1, teleport: 3, pause: 9 });
const pressed = button => Boolean(button?.pressed || button?.value > 0.5);
const empty = () => ({ left: false, right: false, jump: false, fire: false, door: false, teleport: false, pause: false });

export class GamepadInput {
  constructor(storage = null, getPads = () => navigator.getGamepads()) {
    this.storage = storage; this.getPads = getPads; this.warning = !storage;
    this.config = { enabled: true, axis: 0, buttons: { ...DEFAULT_PAD_BUTTONS } };
    this.selected = null; this.lastDevice = null; this.reset();
    try {
      const raw = storage?.getItem(GAMEPAD_STORAGE_KEY);
      if (raw) {
        const value = JSON.parse(raw), indices = Object.keys(DEFAULT_PAD_BUTTONS).map(action => value?.buttons?.[action]);
        if (typeof value?.enabled !== 'boolean' || !Number.isInteger(value.axis) || value.axis < 0 || value.axis > 15
          || indices.some(n => !Number.isInteger(n) || n < 0 || n > 63 || [14, 15].includes(n)) || new Set(indices).size !== indices.length) throw Error('Invalid controller settings');
        this.config = { enabled: value.enabled, axis: value.axis,
          buttons: Object.fromEntries(Object.keys(DEFAULT_PAD_BUTTONS).map(action => [action, value.buttons[action]])) };
      }
    } catch { this.warning = true; }
  }
  save() {
    try {
      if (!this.storage) throw Error('Storage unavailable');
      this.storage.setItem(GAMEPAD_STORAGE_KEY, JSON.stringify(this.config)); this.warning = false;
    } catch { this.warning = true; }
    this.reset();
  }
  assign(action, button) {
    if (!Object.hasOwn(DEFAULT_PAD_BUTTONS, action) || !Number.isInteger(button) || button < 0 || button > 63) return 'Invalid controller button.';
    const owner = Object.keys(this.config.buttons).find(key => key !== action && this.config.buttons[key] === button);
    if (owner) return `Button ${button + 1} is already assigned to ${owner}.`;
    if ([14, 15].includes(button)) return 'Left/right D-pad buttons are reserved for movement.';
    this.config.buttons[action] = button; this.save(); return null;
  }
  resetDefaults() { this.config = { enabled: true, axis: 0, buttons: { ...DEFAULT_PAD_BUTTONS } }; this.save(); }
  reset() { this.armed = false; this.previous = empty(); this.previousButtons = new Set(); this.state = empty(); }
  poll(active = true) {
    let pads;
    try { pads = Array.from(this.getPads() ?? []).filter(pad => pad?.connected !== false && pad); }
    catch {
      const disconnected = this.lastDevice !== null;
      this.lastDevice = null; this.reset();
      return { pads: [], unavailable: true, disconnected, state: this.state, pressedButtons: [], edges: {} };
    }
    const pad = this.selected === null ? pads[0] : pads.find(p => p.index === this.selected);
    const device = pad ? `${pad.index}:${pad.id}` : null;
    const disconnected = this.lastDevice !== null && this.lastDevice !== device;
    if (device !== this.lastDevice) this.reset();
    this.lastDevice = device;
    if (!pad || !active || !this.config.enabled) {
      this.reset(); return { pads, pad, disconnected, state: this.state, pressedButtons: [], edges: {} };
    }
    const buttons = new Set(Array.from(pad.buttons, (b, i) => pressed(b) ? i : -1).filter(i => i >= 0));
    const axis = Number.isFinite(pad.axes[this.config.axis]) ? pad.axes[this.config.axis] : 0;
    const current = { left: axis < -0.3 || buttons.has(14), right: axis > 0.3 || buttons.has(15) };
    for (const [action, index] of Object.entries(this.config.buttons)) current[action] = buttons.has(index);
    // A held button on focus/reconnect/menu exit must never act as a fresh press.
    if (!this.armed) {
      if (!buttons.size && Math.abs(axis) < 0.2) this.armed = true;
      return { pads, pad, disconnected, state: this.state, pressedButtons: [], edges: {} };
    }
    const edges = Object.fromEntries(Object.keys(current).map(action => [action, current[action] && !this.previous[action]]));
    const pressedButtons = [...buttons].filter(i => !this.previousButtons.has(i));
    this.previous = current; this.previousButtons = buttons; this.state = current;
    return { pads, pad, disconnected, state: current, edges, pressedButtons };
  }
}
