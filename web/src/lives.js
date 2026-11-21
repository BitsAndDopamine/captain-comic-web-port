// Spare lives, shield recharge and score awards recovered from COMIC.EXE.
export class LifeSystem {
  constructor(config, onSound = () => {}) {
    this.config = config;
    this.onSound = onSound;
    this.spares = config.initialSpareLives;
    this.score = 0;
    this.scoreCarryProgress = 0;
    this.shield = 0;
    this.refillTicks = config.shieldRechargeTicks;
    this.gameOver = false;
  }
  addPoints(points) {
    // Score units are hundreds of displayed points. Each carry out of the low
    // base-100 group increments DS:0053; five carries award a spare life.
    const units = points / 100;
    const carries = Math.floor(((Math.floor(this.score / 100) % 100) + units) / 100);
    const total = this.score + points;
    this.score = total % 100_000_000;
    // The original carry loop runs past the three score bytes into DS:0053 on
    // eight-digit wrap, then increments that counter again at 0x2377.
    this.scoreCarryProgress += Math.floor(total / 100_000_000);
    for (let i = 0; i < carries; i++) {
      if (++this.scoreCarryProgress >= this.config.scoreCarriesPerExtraLife) {
        this.scoreCarryProgress = 0;
        this.awardLife();
      }
    }
  }
  awardLife() {
    this.onSound('extraLife');
    if (this.spares < this.config.maxSpareLives) {
      this.spares++;
      return;
    }
    this.refillTicks = this.config.shieldRechargeTicks;
    // Keep the three separate score calls: their carries can themselves award lives.
    for (let i = 0; i < 3; i++) this.addPoints(this.config.cappedLifeBonusPartPoints);
  }
  collectShield() {
    if (this.shield === this.config.shieldCap) this.awardLife();
    else this.refillTicks = this.config.shieldRechargeTicks;
  }
  tick() {
    if (this.gameOver || this.refillTicks === 0) return;
    this.refillTicks--;
    if (this.shield < this.config.shieldCap) this.shield++;
    else this.addPoints(this.config.fullShieldRechargePoints);
  }
  takeHit(deathGuard = false) {
    if (this.shield === 0 && !deathGuard) return true;
    this.onSound('damage');
    if (this.shield > 0) this.shield--;
    return false; // Draining the final shield unit is not itself fatal.
  }
  loseLife() {
    if (this.gameOver) return false;
    if (this.spares === 0) {
      this.gameOver = true;
      return false;
    }
    this.spares--;
    this.shield = 0;
    this.refillTicks = this.config.shieldRechargeTicks;
    return true;
  }
}

export function drawLifeIcons(ctx, sprite, spares, layout) {
  for (let i = 0; i < layout.count; i++) {
    ctx.drawImage(sprite.img, (i < spares ? 0 : 1) * sprite.w, 0, sprite.w, sprite.h,
      layout.x0 + i * layout.gap, layout.y, sprite.w, sprite.h);
  }
}

export function drawEnergyCells(ctx, sprite, weapon, shield, layout) {
  for (const [value, unitsPerCell, y] of [[weapon, 2, layout.weaponY], [shield, 1, layout.shieldY]]) {
    for (let i = 0; i < layout.count; i++) {
      const units = Math.max(0, Math.min(unitsPerCell, value - i * unitsPerCell));
      const frame = units === 0 ? 0 : units === unitsPerCell ? 2 : 1;
      ctx.drawImage(sprite.img, frame * sprite.w, 0, sprite.w, sprite.h,
        layout.x0 + i * sprite.w, y, sprite.w, sprite.h);
    }
  }
}

export function drawFireballCapacity(ctx, sprite, capacity, layout, alternate = false) {
  if (capacity <= 0) return; // SYS003's inventory cell is black before the first Cola.
  const frame = Math.min(capacity, layout.max) - 1 + (alternate ? layout.alternateFrameOffset : 0);
  ctx.drawImage(sprite.img, frame * sprite.w, 0, sprite.w, sprite.h,
    layout.x, layout.y, sprite.w, sprite.h);
}
