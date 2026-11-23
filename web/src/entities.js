// Fireballs and pickups. Original enemy slots/AI live in enemies.js.

export function fireballOrigin(player, playerSprite, config) {
  // The EXE fires at (spriteX, spriteY + 8), not at the web hitbox top.
  return {
    x: player.x + (player.w - playerSprite.w) / 2,
    y: player.y + player.h - playerSprite.h + config.coordinateUnitPixels,
  };
}

export class Fireball {
  constructor(sprite, x, y, dir, corkscrew = false, config = {}) {
    this.sprite = sprite;
    this.x = x; this.y = y;
    this.w = sprite.w ?? 16; this.h = sprite.h ?? 8;
    this.dir = dir;
    this.corkscrew = corkscrew;
    this.config = config;
    this.waveTicks = config.corkscrewWavePeriodTicks ?? 2;
    this.frame = 0; this.frameTick = 0;
    this.alive = true;
  }
  tick(world, cameraX, playfieldWidth = 196) {
    if (!this.alive) return;
    // PIT/timer logic moves 2 eight-pixel coordinate units per ~18.2 Hz tick.
    const unit = this.config.coordinateUnitPixels ?? 8;
    this.x += this.dir * (this.config.horizontalUnitsPerTick ?? 2) * unit;
    if (this.corkscrew) {
      if (--this.waveTicks) this.y += unit * (this.config.corkscrewVerticalOffsetUnits ?? 1);
      else {
        this.y -= unit * (this.config.corkscrewVerticalOffsetUnits ?? 1);
        this.waveTicks = this.config.corkscrewWavePeriodTicks ?? 2;
      }
    }
    // Web-port range extension: retain the whole sprite through the edge and
    // another 20px beyond it. Use pixels, not the EXE's 0..22-unit draw window.
    const screenX = this.x - cameraX;
    if (screenX + this.w < -20 || screenX > playfieldWidth + 20) {
      this.alive = false;
      return;
    }
    this.frame = (this.frame + 1) % (this.config.frameCount ?? 2);
  }
  draw(ctx, pf, camX, camY) {
    if (!this.alive) return;
    const s = this.sprite;
    ctx.drawImage(s.img, this.frame * this.w, 0, this.w, this.h,
      Math.round(pf.x + this.x - camX), Math.round(pf.y + this.y - camY), this.w, this.h);
  }
}

export class Pickup {
  constructor(kind, sprite, frame, x, y, stateKey) {
    this.kind = kind;
    this.sprite = sprite;
    this.frame = frame;
    this.stateKey = stateKey;
    this.x = x; this.y = y;
    this.w = 16; this.h = 16;
    this.taken = false;
    this.bank = 0;
  }
  draw(ctx, pf, camX, camY, t) {
    if (this.taken || !pickupVisible(this, camX)) return;
    ctx.drawImage(this.sprite.img, (this.frame + this.bank) * 16, 0, 16, 16,
      Math.round(pf.x + this.x - camX), Math.round(pf.y + this.y - camY), 16, 16);
  }
}

export function pickupVisible(pickup, cameraX) {
  return pickup.frame !== 255 && (((Math.floor(pickup.x / 8) - Math.floor(cameraX / 8)) & 255) <= 22);
}

export function pickupContact(player, pickup, cameraX) {
  const x = Math.floor(pickup.x / 8), y = Math.floor(pickup.y / 8);
  return !pickup.taken && pickupVisible(pickup, cameraX) && Math.abs(x - player.xUnits) < 2
    && y >= player.yUnits && y - player.yUnits < 4;
}

export function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
