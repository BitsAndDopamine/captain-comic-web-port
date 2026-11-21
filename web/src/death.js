// Original 0x1248 and 0x181b..0x18a1. Tick zero is rendered immediately.
export class DeathSequence {
  constructor(config, cause, spriteYUnits) {
    this.config = config;
    this.cause = cause;
    this.frame = 0;
    this.ticks = 0;
    this.cropHeight = spriteYUnits >= config.fallCropMinYUnits && spriteYUnits <= config.fallCropMaxYUnits
      ? (config.fallBottomYUnits - spriteYUnits) * 8 : 0;
    this.stage = cause === 'enemy' ? 'explosion' : this.cropHeight ? 'fallCrop' : 'blankWait';
  }
  get playerVisible() { return this.stage === 'fallCrop' || (this.stage === 'explosion' && this.frame < 4); }
  get explosionFrame() { return this.stage === 'explosion' ? this.frame : null; }
  tick() {
    switch (this.stage) {
      case 'explosion':
        if (++this.frame < this.config.explosionFrames) return 'explosion';
        this.stage = 'blankWait'; this.ticks = 0; break;
      case 'fallCrop': this.stage = 'blankWait'; this.ticks = 0; break;
      case 'blankWait':
        if (++this.ticks >= this.config.blankWaitTicks) {
          this.stage = 'deathWait'; this.ticks = 0; return 'deathSound';
        }
        break;
      case 'deathWait':
        if (++this.ticks >= this.config.deathWaitTicks) { this.stage = 'checkLives'; return 'lifeCheck'; }
        break;
      case 'gameOverWait':
        if (++this.ticks >= this.config.gameOverWaitTicks) { this.stage = 'done'; return 'gameOver'; }
        break;
    }
    return null;
  }
}
