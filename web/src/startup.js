// Startup sequencing recovered from the DOS entry path, independent of the DOM.

export function initialPlayerPosition(config, sprite, hitbox) {
  const position = config.initialState.spritePosition;
  return {
    x: position.x + (sprite.w - hitbox.w) / 2,
    y: position.y + sprite.h - hitbox.h,
  };
}

export class Startup {
  constructor(config) {
    this.config = config;
    this.index = 0;
    this.elapsedTicks = 0;
    this.textPage = null;
  }
  get active() { return this.index < this.config.stages.length; }
  get stage() { return this.config.stages[this.index]; }
  get canAdvance() {
    return Boolean(this.active && (this.textPage || (this.stage.advance === 'key'
      && this.elapsedTicks + 1e-9 >= (this.stage.keyDelayTicks ?? 0))));
  }
  get paletteStep() {
    return this.stage?.revealTicks ? Math.min(this.stage.revealTicks - 1, Math.floor(this.elapsedTicks + 1e-9)) : null;
  }
  get text() {
    if (this.textPage === 'registration') return this.config.registration;
    if (this.textPage === 'controls') {
      return 'Browser controls\n\nLeft/Right arrows: move\nUp arrow: jump (higher with Boots)\nSpace: fire (requires Blastola Cola)\nAlt: use door (requires Door Key)\nCaps Lock: teleport (requires Wand)\nEsc: pause; any other key / Continue resumes\nWhile paused, Q quits to title\nHigh scores: footer button (saved in this browser)\n\nThe DOS keyboard-definition and joystick menus are not emulated.\n\nPress any key or click Continue to return.';
    }
    if (this.textPage === 'exit') return 'Press any key or click Continue to return to the start menu.';
    return this.stage?.id === 'notice' ? this.config.notice : null;
  }
  advance() {
    this.index++;
    this.elapsedTicks = 0;
  }
  skip() {
    this.index = this.config.stages.length;
    this.elapsedTicks = 0;
    this.textPage = null;
  }
  press(code) {
    if (!this.active) return null;
    if (this.textPage) { this.textPage = null; return null; }
    if (this.stage.id === 'notice') {
      if (code === 'KeyR') { this.textPage = 'registration'; return null; }
      if (code === 'KeyK' || code === 'KeyJ') { this.textPage = 'controls'; return null; }
      if (code === 'Escape') { this.textPage = 'exit'; return null; }
      this.advance();
      return 'theme';
    }
    if (this.stage.advance === 'key') {
      if (!this.canAdvance) return null;
      const stopTheme = this.stage.id === 'legend';
      this.advance();
      return stopTheme ? 'stopTheme' : null;
    }
    return null;
  }
  step(seconds) {
    if (!this.active || this.textPage) return;
    this.elapsedTicks += seconds * this.config.timerTicksPerSecond;
    if (this.stage.ticks !== undefined && this.elapsedTicks + 1e-9 >= this.stage.ticks) {
      this.advance();
    } else if (this.stage.id === 'arrival') {
      const end = this.stage.waitTicks + this.stage.effectFrames * this.stage.effectTicksPerFrame
        + this.stage.settleTicks;
      if (this.elapsedTicks + 1e-9 >= end) this.advance();
    }
  }
  get arrivalFrame() {
    if (this.stage?.id !== 'arrival') return null;
    const frame = Math.floor((this.elapsedTicks - this.stage.waitTicks) / this.stage.effectTicksPerFrame);
    return frame >= 0 && frame < this.stage.effectFrames ? frame : null;
  }
  get arrivalPlayerVisible() {
    if (this.stage?.id !== 'arrival') return false;
    return this.elapsedTicks >= this.stage.waitTicks
      + this.stage.playerVisibleFromFrame * this.stage.effectTicksPerFrame;
  }
  get hint() {
    if (this.textPage) return 'Press any key or click Continue to return';
    switch (this.stage?.id) {
      case 'notice': return 'Enter / click Continue to begin · R: registration · K: browser controls';
      case 'title': return 'The Adventures of Captain Comic';
      case 'story': return this.canAdvance ? 'Press any key or click Continue' : 'The story of Captain Comic…';
      case 'legend': return 'Press any key or click Continue';
      case 'planet': case 'arrival': return 'Arriving on Tambi…';
      default: return '← → Move · ↑ Jump · Space Fire · Alt Door · Caps Lock Teleport · Esc Pause';
    }
  }
}
