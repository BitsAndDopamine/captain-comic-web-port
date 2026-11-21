// Original completion path: 0x246d -> 0x1652 -> 0x1489..0x1535.
export class Victory {
  constructor(config) {
    this.config = config;
    this.stage = 'pending';
    this.countdown = config.countdownInitial;
    this.ticks = 0;
    this.awards = 0;
  }
  start(emit) {
    this.stage = 'departure'; this.ticks = 0;
    emit('teleport');
  }
  award(life, emit) {
    emit('victoryTally');
    life.addPoints(this.config.pointsPerTick);
    this.awards++;
  }
  enterTally(life, emit, stage) {
    this.stage = stage; this.awards = 0;
    this.award(life, emit);
  }
  nextLife(life, emit) {
    if (life.spares > 0) this.enterTally(life, emit, 'lifeTally');
    else {
      this.stage = 'ending'; this.ticks = 0;
      emit('intro');
    }
  }
  tick(life, emit = () => {}) {
    const c = this.config;
    switch (this.stage) {
      case 'pending':
        if (--this.countdown === c.countdownTrigger) this.start(emit);
        break;
      case 'departure':
        if (++this.ticks >= c.departureLeadTicks + c.effectFrames * c.effectTicksPerFrame + c.departureSettleTicks) {
          this.enterTally(life, emit, 'baseTally');
        }
        break;
      case 'baseTally':
        if (this.awards < c.baseAwardTicks) this.award(life, emit);
        else this.nextLife(life, emit);
        break;
      case 'lifeTally':
        if (this.awards < c.lifeAwardTicks) this.award(life, emit);
        else {
          // 0x2172 consumes only the icon/counter, NOT a death or shield reset.
          life.spares--;
          this.stage = 'lifePause'; this.ticks = 0;
        }
        break;
      case 'lifePause':
        if (++this.ticks >= c.lifePauseTicks) this.nextLife(life, emit);
        break;
      case 'ending':
        if (!this.canAdvance) this.ticks++;
        break;
    }
  }
  get active() { return this.stage !== 'pending'; }
  get canAdvance() {
    return this.stage === 'ending' && this.ticks >= this.config.paletteSteps.length + this.config.endingHoldTicks;
  }
  advance() {
    if (!this.canAdvance) return false;
    this.stage = 'gameOver'; return true;
  }
  get effectFrame() {
    if (this.stage !== 'departure') return null;
    const frame = Math.floor((this.ticks - this.config.departureLeadTicks) / this.config.effectTicksPerFrame);
    return frame >= 0 && frame < this.config.effectFrames ? frame : null;
  }
  get playerVisible() {
    return this.stage === 'departure' && this.ticks < this.config.departureLeadTicks
      + this.config.playerVisibleEffectFrames * this.config.effectTicksPerFrame;
  }
  get paletteStep() { return Math.min(this.ticks, this.config.paletteSteps.length - 1); }
}

export function hasAllTreasures(inventory, config) {
  return config.treasures.every(item => inventory.has(item));
}
