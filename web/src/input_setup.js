import { ACTION_LABELS, keyLabel } from './controls.js';

const padLabel = index => `Button ${index + 1}${({ 0: ' (A / Cross)', 1: ' (B / Circle)',
  2: ' (X / Square)', 3: ' (Y / Triangle)', 9: ' (Start / Options)' })[index] ?? ''}`;

// Accessible HTML menus, not a rasterized DOS keyboard/joystick driver.
export class InputSetup {
  constructor(root, keyboard, gamepad, { onOpen = () => {}, onClose = () => {} } = {}) {
    Object.assign(this, { root, keyboard, gamepad, onOpen, onClose });
    this.mode = null; this.capture = null; this.cancelledKeys = new Set();
    root.innerHTML = `
      <div class="input-setup-panel">
        <h2 id="input-setup-title"></h2>
        <p id="input-setup-help"></p>
        <div id="controller-options" hidden>
          <label><input id="controller-enabled" type="checkbox"> Enable controller alongside keyboard and touch</label>
          <label>Controller <select id="controller-device" aria-label="Controller"><option value="auto">Automatic</option></select></label>
          <label>Horizontal stick axis <select id="controller-axis" aria-label="Horizontal stick axis"></select></label>
          <p id="controller-status" role="status"></p>
          <p id="controller-preview" aria-live="off"></p>
        </div>
        <div id="input-bindings"></div>
        <p id="input-setup-message" role="status"></p>
        <p id="input-storage-warning"></p>
        <div class="input-setup-actions"><button id="input-defaults" type="button">Restore defaults</button><button id="input-back" type="button">Back to startup</button></div>
      </div>`;
    this.find = id => root.querySelector(`#${id}`);
    this.find('input-back').addEventListener('click', () => this.close());
    this.find('input-defaults').addEventListener('click', () => {
      this.cancelCapture();
      if (this.mode === 'keyboard') keyboard.reset(); else gamepad.resetDefaults();
      this.render(); this.message('Default controls restored.');
    });
    this.find('controller-enabled').addEventListener('change', event => {
      this.cancelCapture(); gamepad.config.enabled = event.target.checked; gamepad.save(); this.render();
    });
    this.find('controller-device').addEventListener('change', event => {
      this.cancelCapture(); gamepad.selected = event.target.value === 'auto' ? null : Number(event.target.value); gamepad.reset();
    });
    this.find('controller-axis').addEventListener('change', event => {
      gamepad.config.axis = Number(event.target.value); gamepad.save(); this.render();
    });
  }
  get active() { return this.mode !== null; }
  open(mode) {
    this.mode = mode; this.capture = null; this.padSignature = '';
    this.root.hidden = false;
    this.root.scrollTop = 0;
    for (const child of this.root.parentElement.children) if (child !== this.root) child.inert = true;
    this.render(); this.message(''); this.onOpen(); this.root.focus({ preventScroll: true });
  }
  close() {
    this.cancelCapture(); this.mode = null; this.root.hidden = true;
    for (const child of this.root.parentElement.children) if (child !== this.root) child.inert = false;
    this.onClose();
  }
  message(text) { this.find('input-setup-message').textContent = text; }
  cancelCapture() {
    if (this.capture) this.find(`bind-${this.capture}`)?.setAttribute('aria-pressed', 'false');
    this.capture = null;
  }
  render() {
    const keyboard = this.mode === 'keyboard';
    this.find('input-setup-title').textContent = keyboard ? 'Keyboard definition' : 'Joystick / USB controller';
    this.find('input-setup-help').textContent = keyboard
      ? 'Select an action, then press its new key. Esc cancels a change or returns. Tab/Enter navigate. Changes are saved automatically. Remapping can avoid keyboard rollover limits.'
      : 'Connect a USB/Bluetooth controller and press a button to let the browser detect it. Use the left stick or D-pad to move. Select an action to assign a button. The Pause button returns to startup. Keyboard and touch remain available.';
    this.find('controller-options').hidden = keyboard;
    this.find('controller-enabled').checked = this.gamepad.config.enabled;
    const axis = this.find('controller-axis');
    if (!axis.options.length) for (let n = 0; n < 16; n++) {
      const option = document.createElement('option'); option.value = n; option.textContent = `Axis ${n + 1}${n === 0 ? ' (standard left stick)' : ''}`; axis.append(option);
    }
    axis.value = String(this.gamepad.config.axis);
    const bindings = keyboard ? this.keyboard.bindings : this.gamepad.config.buttons;
    this.find('input-bindings').replaceChildren(...Object.keys(bindings).map(action => {
      const row = document.createElement('div'), label = document.createElement('span'), button = document.createElement('button');
      row.className = 'input-binding'; label.id = `label-${action}`; label.textContent = ACTION_LABELS[action] ?? 'Pause / Continue';
      button.type = 'button'; button.id = `bind-${action}`; button.setAttribute('aria-labelledby', `${label.id} ${button.id}`);
      button.setAttribute('aria-pressed', String(this.capture === action));
      button.textContent = keyboard ? keyLabel(bindings[action]) : padLabel(bindings[action]);
      button.addEventListener('click', () => {
        this.cancelCapture(); this.capture = action; button.setAttribute('aria-pressed', 'true');
        if (!keyboard) this.gamepad.reset();
        this.message(`Press ${keyboard ? 'a key' : 'and release all buttons, then press a controller button'} for ${label.textContent}. Esc cancels.`);
      });
      row.append(label, button); return row;
    }));
    this.find('input-storage-warning').textContent = (keyboard ? this.keyboard.warning : this.gamepad.warning)
      ? 'Settings storage unavailable or invalid. Changes remain usable in this tab.' : 'Settings are stored only in this browser.';
  }
  keydown(event) {
    if (!this.capture && (event.ctrlKey || event.metaKey)) return;
    if (this.capture) {
      event.preventDefault();
      this.cancelledKeys.add(event.code);
      if (event.repeat) return;
      if (event.code === 'Escape') { this.cancelCapture(); this.message('Change cancelled.'); return; }
      if (this.mode !== 'keyboard') return;
      if (event.ctrlKey || event.metaKey) { this.message('Browser Ctrl/Command shortcuts cannot be assigned.'); return; }
      const error = this.keyboard.assign(this.capture, event.code);
      if (error) { this.message(error); return; }
      const action = this.capture; this.cancelCapture(); this.render(); this.find(`bind-${action}`).focus();
      this.message(`${ACTION_LABELS[action]}: ${keyLabel(this.keyboard.bindings[action])}`); return;
    }
    if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) this.close(); }
    else if (event.code === 'Tab') {
      const elements = [...this.root.querySelectorAll('button, input, select')].filter(el => !el.disabled && !el.closest('[hidden]'));
      const index = elements.indexOf(document.activeElement);
      const next = event.shiftKey ? (index <= 0 ? elements.length - 1 : index - 1) : (index + 1) % elements.length;
      event.preventDefault(); elements[next]?.focus();
    }
  }
  updatePad(sample) {
    if (this.mode !== 'gamepad') return;
    const { pads, pad } = sample;
    const signature = JSON.stringify(pads.map(p => [p.index, p.id]));
    const select = this.find('controller-device');
    if (signature !== this.padSignature) {
      this.padSignature = signature;
      select.replaceChildren();
      for (const [value, text] of [['auto', 'Automatic (first connected)'], ...pads.map(p => [String(p.index), p.id])]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
      }
      if (this.gamepad.selected !== null && !pads.some(p => p.index === this.gamepad.selected)) {
        const option = document.createElement('option'); option.value = this.gamepad.selected; option.textContent = 'Selected controller disconnected'; select.append(option);
      }
      select.value = this.gamepad.selected === null ? 'auto' : String(this.gamepad.selected);
    }
    const status = sample.unavailable ? 'Gamepad API unavailable or blocked. Use HTTPS or localhost and allow controller access.'
      : !this.gamepad.config.enabled ? 'Controller input disabled.'
      : pad ? `${pad.id} — ${pad.mapping === 'standard' ? 'standard mapping' : 'non-standard: check axis and button assignments'}`
      : 'No controller detected. Connect it and press a button. The browser may require HTTPS or localhost.';
    if (this.find('controller-status').textContent !== status) this.find('controller-status').textContent = status;
    this.find('controller-preview').textContent = this.gamepad.armed
      ? `Input: ${Object.keys(sample.state).filter(action => sample.state[action]).join(', ') || 'neutral'}`
      : 'Release buttons and center the stick to enable input.';
    if (this.capture && sample.pressedButtons.length) {
      const action = this.capture, error = this.gamepad.assign(action, sample.pressedButtons[0]);
      if (error) this.message(error);
      else { this.cancelCapture(); this.render(); this.find(`bind-${action}`).focus(); this.message('Controller button saved.'); }
    } else if (!this.capture && sample.edges.pause) this.close();
  }
}
