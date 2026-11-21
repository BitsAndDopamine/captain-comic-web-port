// Each finger owns its own input. Releasing one never releases another finger
// (or the independent physical-keyboard state).
export class TouchState {
  constructor() { this.pointers = new Map(); }
  has(code) { return [...this.pointers.values()].includes(code); }
  press(id, code) {
    if (this.pointers.get(id) === code) return false;
    this.pointers.delete(id);
    const edge = !this.has(code);
    this.pointers.set(id, code);
    return edge;
  }
  release(id) { return this.pointers.delete(id); }
  clear() { this.pointers.clear(); }
}

export class TouchControls {
  constructor(root, { onPress = () => {}, onGesture = () => {} } = {}) {
    this.root = root;
    this.state = new TouchState();
    this.enabled = false;
    this.taps = new Map();
    this.buttons = [...root.querySelectorAll('[data-code]')];
    this.onPress = onPress;
    this.onGesture = onGesture;
    for (const button of this.buttons) {
      button.addEventListener('pointerdown', event => {
        if (!this.enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        this.press(event.pointerId, button.dataset.code);
        try { button.setPointerCapture(event.pointerId); } catch { /* Global release is the fallback. */ }
      });
      button.addEventListener('lostpointercapture', event => this.release(event.pointerId));
      button.addEventListener('contextmenu', event => event.preventDefault());
      button.addEventListener('click', event => {
        // Native keyboard/screen-reader activation has no pointerdown/up pair.
        if (!this.enabled || event.detail !== 0 || event.pointerType) return;
        const id = `tap:${button.dataset.code}`;
        clearTimeout(this.taps.get(id));
        this.press(id, button.dataset.code);
        this.taps.set(id, setTimeout(() => { this.release(id); this.taps.delete(id); }, 120));
      });
    }
    const release = event => this.release(event.pointerId);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }
  has(code) { return this.state.has(code); }
  press(id, code) {
    if (!this.enabled) return;
    this.onGesture();
    if (this.state.press(id, code)) this.onPress(code);
    this.paint();
  }
  release(id) { this.state.release(id); this.paint(); }
  paint() {
    for (const button of this.buttons) button.classList.toggle('is-held', this.has(button.dataset.code));
  }
  clear() {
    const ids = [...this.state.pointers.keys()].filter(id => typeof id === 'number');
    this.state.clear();
    for (const timer of this.taps.values()) clearTimeout(timer);
    this.taps.clear();
    for (const button of this.buttons) for (const id of ids) {
      try { if (button.hasPointerCapture?.(id)) button.releasePointerCapture(id); } catch { /* Already released. */ }
    }
    this.paint();
  }
  setEnabled(enabled) {
    if (this.enabled && !enabled) this.clear();
    this.enabled = enabled;
    for (const button of this.buttons) button.disabled = !enabled;
  }
}
