// Original jump/fall state (0x172e, 0x18a4..0x19bb), in 8px sprite units.
// Horizontal callbacks run between vertical displacement and terrain probes.
export class VerticalMotion {
  constructor(config) {
    this.config = config;
    this.airborne = false;
    this.velocity = 0;
    this.boostCounter = config.normalJumpCounter;
    this.ceilingPush = 0;
  }
  tick(y, x, jump, boots, world, move = x => x, stopped = () => false) {
    const c = this.config;
    const row = dy => world.tile(x >> 1, dy >> 1)
      || ((x & 1) && world.tile((x >> 1) + 1, dy >> 1));
    if (!this.airborne) {
      if (!jump) this.boostCounter = boots ? c.bootsJumpCounter : c.normalJumpCounter;
      if (jump && this.boostCounter !== 1) this.airborne = true;
      else {
        x = move(x, y, false);
        if (stopped()) return { x, y, dead: false };
        if (!row(y + 4)) {
          this.airborne = true;
          this.velocity = c.edgeFallInitialVerticalVelocity;
          this.boostCounter = 1;
        }
        return { x, y, dead: false };
      }
    }
    if (--this.boostCounter === 0) { this.boostCounter = 1; this.ceilingPush = 0; }
    else if (jump) this.velocity -= c.heldJumpVelocitySubtract;
    else this.ceilingPush = 0;
    y = Math.max(0, y + (this.velocity >> 3)) + this.ceilingPush;
    this.ceilingPush = 0;
    if (y >= 17) return { x, y, dead: true };
    this.velocity = Math.min(c.verticalVelocityCap,
      this.velocity + (world.area === 'SPACE' ? c.spaceGravityPerTick : c.gravityPerTick));
    x = move(x, y, true);
    if (stopped()) return { x, y, dead: false };
    if (row(y) && this.velocity <= 0) {
      this.velocity = 0;
      this.ceilingPush = 1;
    } else if (this.velocity > 0 && y < 15 && row(y + 5)) {
      y = (y + 1) & 254;
      this.airborne = false;
      this.velocity = 0;
    }
    return { x, y, dead: false };
  }
}
