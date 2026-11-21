// Fit the original 320x200 image without changing its bitmap/simulation size.
export function fitGameScreen({ width, height, paddingX = 0, paddingY = 0,
  footerHeight = 0, controlsHeight = 0, statusHeight = 0, sideWidth = 0, gaps = 24 }) {
  const w = Math.max(1, width - paddingX - sideWidth);
  const h = Math.max(1, height - paddingY - footerHeight - controlsHeight - statusHeight - gaps);
  return Math.max(1, Math.floor(Math.min(w, h * 8 / 5)));
}

export class Presentation {
  constructor({ shell, fullscreenButton, touchButton, touchRoot, status, onResetInput, onInterrupt }) {
    Object.assign(this, { shell, fullscreenButton, touchButton, touchRoot, status, onResetInput, onInterrupt });
    this.expanded = false;
    this.pending = false;
    this.touchEnabled = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    this.applyTouchMode(false);
    fullscreenButton.addEventListener('click', () => this.toggleFullscreen());
    touchButton.addEventListener('click', () => { this.touchEnabled = !this.touchEnabled; this.applyTouchMode(); });
    const changed = () => {
      if (this.nativeFullscreen && this.expanded) {
        this.expanded = false;
        this.shell.classList.remove('is-expanded');
        document.body.classList.remove('expanded-game');
        this.status.hidden = true; this.status.textContent = '';
      }
      if (this.lastNative && !this.nativeFullscreen) { this.lastExitAt = performance.now(); this.onInterrupt(); }
      else this.onResetInput();
      this.lastNative = this.nativeFullscreen;
      this.updateFullscreenButton(); this.layout();
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    window.addEventListener('resize', () => { this.onResetInput(); this.layout(); });
    window.addEventListener('orientationchange', () => { this.onInterrupt(); this.layout(); });
    window.visualViewport?.addEventListener('resize', () => this.layout());
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.scheduleLayout());
      for (const element of [shell, shell.querySelector('footer'), touchRoot, status]) this.observer.observe(element);
    }
    this.layout();
  }
  get nativeFullscreen() { return (document.fullscreenElement ?? document.webkitFullscreenElement) === this.shell; }
  applyTouchMode(notify = true) {
    this.shell.classList.toggle('touch-mode', this.touchEnabled);
    // The canvas's size-query container would otherwise contain fixed-position
    // descendants. Keep the mobile score dialog at viewport level, not canvas size.
    const panel = this.shell.querySelector('#scores-screen');
    const parent = this.touchEnabled ? this.shell : this.shell.querySelector('#display');
    if (panel && panel.parentElement !== parent) parent.append(panel);
    this.touchRoot.hidden = !this.touchEnabled;
    this.touchButton.textContent = `Touch: ${this.touchEnabled ? 'on' : 'off'}`;
    this.touchButton.setAttribute('aria-pressed', String(this.touchEnabled));
    if (notify) this.onResetInput();
    this.layout();
  }
  updateFullscreenButton() {
    this.fullscreenButton.textContent = this.pending ? 'Changing view…'
      : this.nativeFullscreen ? 'Exit fullscreen' : this.expanded ? 'Exit expanded view' : 'Fullscreen';
    this.fullscreenButton.setAttribute('aria-pressed', String(this.nativeFullscreen || this.expanded));
    this.fullscreenButton.disabled = this.pending;
  }
  setExpanded(enabled) {
    this.expanded = enabled;
    this.shell.classList.toggle('is-expanded', enabled);
    document.body.classList.toggle('expanded-game', enabled);
    this.status.hidden = !enabled;
    this.status.textContent = enabled ? 'Native fullscreen is unavailable here. Expanded view is active; tap Exit expanded view to leave.' : '';
    if (enabled) this.onResetInput();
    else { this.lastExitAt = performance.now(); this.onInterrupt(); }
    this.updateFullscreenButton(); this.layout();
  }
  fullscreenOperation(operation, expected) {
    // Some embedded browsers expose the API but never settle its promise. Bound
    // the wait, and also support prefixed APIs which return no promise at all.
    return new Promise((resolve, reject) => {
      let done = false, timer;
      const finish = error => {
        if (done) return;
        done = true; clearTimeout(timer);
        document.removeEventListener('fullscreenchange', check);
        document.removeEventListener('webkitfullscreenchange', check);
        document.removeEventListener('fullscreenerror', failed);
        document.removeEventListener('webkitfullscreenerror', failed);
        if (error) reject(error); else resolve();
      };
      const check = () => { if (this.nativeFullscreen === expected) finish(); };
      const failed = () => finish(new Error('Fullscreen unavailable'));
      document.addEventListener('fullscreenchange', check);
      document.addEventListener('webkitfullscreenchange', check);
      document.addEventListener('fullscreenerror', failed);
      document.addEventListener('webkitfullscreenerror', failed);
      timer = setTimeout(() => finish(new Error('Fullscreen request timed out')), this.fullscreenTimeout ?? 1800);
      try { Promise.resolve(operation()).then(check, finish); check(); }
      catch (error) { finish(error); }
    });
  }
  async toggleFullscreen() {
    if (this.pending) return;
    this.onResetInput();
    if (this.expanded) { this.setExpanded(false); return; }
    this.pending = true; this.updateFullscreenButton();
    try {
      if (this.nativeFullscreen) {
        const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
        await this.fullscreenOperation(() => exit.call(document), false);
      } else {
        const request = this.shell.requestFullscreen ?? this.shell.webkitRequestFullscreen;
        if (!request) { this.setExpanded(true); return; }
        try { await this.fullscreenOperation(() => request.call(this.shell), true); }
        catch { this.setExpanded(true); }
      }
    } catch {
      this.status.hidden = false;
      this.status.textContent = 'Could not leave fullscreen. Use the browser’s fullscreen control or Escape.';
    } finally {
      this.pending = false; this.updateFullscreenButton(); this.layout();
    }
  }
  handleEscape() {
    if (this.expanded) { this.setExpanded(false); return true; }
    // Some browsers deliver the exit Escape after fullscreenchange. Do not let
    // that same key immediately resume the game we just paused on exit.
    return this.nativeFullscreen || performance.now() - (this.lastExitAt ?? -Infinity) < 200;
  }
  scheduleLayout() {
    if (this.layoutQueued) return;
    this.layoutQueued = true;
    requestAnimationFrame(() => { this.layoutQueued = false; this.layout(); });
  }
  layout() {
    const viewport = window.visualViewport;
    const height = viewport?.height ?? window.innerHeight;
    this.shell.style.setProperty('--view-height', `${height}px`);
    const style = getComputedStyle(this.shell);
    const side = this.touchEnabled && matchMedia('(orientation: landscape) and (max-height: 600px)').matches;
    const size = element => element.getBoundingClientRect();
    const width = fitGameScreen({ width: this.shell.clientWidth, height,
      paddingX: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
      paddingY: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      footerHeight: size(this.shell.querySelector('footer')).height,
      controlsHeight: this.touchEnabled && !side ? size(this.touchRoot).height : 0,
      statusHeight: this.status.hidden ? 0 : size(this.status).height,
      sideWidth: side ? size(this.touchRoot.querySelector('.touch-directions')).width
        + size(this.touchRoot.querySelector('.touch-actions')).width + 16 : 0,
    });
    this.shell.style.setProperty('--screen-width', `${width}px`);
  }
}
