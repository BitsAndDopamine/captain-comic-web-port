// Player update recovered from 0x1698..0x1a92. Terrain/motion use 8px sprite units.
import { VerticalMotion } from './vertical_motion.js';
import { spritePosition, placeSprite } from './items.js';

export const initialCamera = x => Math.max(0, Math.min(232, Math.floor(x / 8) - 11)) * 8;

export class Player {
  constructor(x, y, verticalConfig = null, sprite = { w: 16, h: 32 }) {
    this.w = 12; this.h = 15;          // legacy coordinate adapter, NOT pickup/terrain probes
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.facing = 1;                   // 1 = right, -1 = left
    this.spawnX = x; this.spawnY = y;
    this.dead = false;
    this.sprite = sprite;
    this.vertical = verticalConfig ? new VerticalMotion(verticalConfig) : null;
    this.verticalTicks = 0;
    this.jumpQueued = false;
    this.momentum = 0;
    this.cameraX = initialCamera(x - (sprite.w - this.w) / 2);
    this.pendingStrip = null;
    this.pose = 0;
    this.animationPhase = 0;
  }

  respawn() {
    this.x = this.spawnX; this.y = this.spawnY;
    this.vx = 0; this.vy = 0;
    this.dead = false;
    if (this.vertical) this.vertical = new VerticalMotion(this.vertical.config);
    this.verticalTicks = 0; this.jumpQueued = false;
    this.momentum = 0; this.pendingStrip = null; this.pose = 0;
    this.onGround = false;
  }

  // input: {left, right, jump, jumpPressed}
  sampleInput(input, boots = false) {
    if (!this.vertical) return;
    if (!this.vertical.airborne && !input.jump) {
      this.vertical.boostCounter = boots ? this.vertical.config.bootsJumpCounter : this.vertical.config.normalJumpCounter;
    }
    if (input.jumpPressed && !this.vertical.airborne) {
      this.vertical.boostCounter = boots ? this.vertical.config.bootsJumpCounter : this.vertical.config.normalJumpCounter;
      this.jumpQueued = true;
    }
  }

  // Standalone 60Hz adapter; Game calls tick on its shared combat/movement clock.
  step(input, world, boots = false) {
    this.sampleInput(input, boots);
    if (!this.vertical) return;
    this.verticalTicks += this.vertical.config.timerTicksPerSecond / 60;
    while (this.verticalTicks >= 1) {
      this.verticalTicks--;
      this.tick(input, world, boots);
      if (this.dead || this.pendingStrip) break;
    }
  }

  tick(input, world, boots = false, cameraX = this.cameraX) {
    if (!this.vertical || this.dead) return;
    const config = this.vertical.config;
    this.cameraX = cameraX;
    this.pendingStrip = null;
    this.pose = 0;
    this.animationPhase = this.animationPhase % 3 + 1;
    const position = spritePosition(this, this.sprite);
    let movedInAir = false;
    const move = (x, y, air) => {
      movedInAir = air;
      const step = direction => {
        if (!air && this.facing !== direction) { this.facing = direction; return; }
        const boundary = direction < 0 ? 0 : 254;
        if (x === boundary) {
          const link = world.stripData?.[direction < 0 ? 'leftStrip' : 'rightStrip'];
          if (link !== null && link !== undefined) this.pendingStrip = direction < 0 ? 'left' : 'right';
          else this.momentum = 0;
          return;
        }
        if (world.tile((x + (direction < 0 ? -1 : 2)) >> 1, (y + 3) >> 1)) {
          this.momentum = 0;
          return;
        }
        x += direction;
        this.pose = this.animationPhase;
        const camera = this.cameraX / 8, offset = (x - camera) & 255;
        if (direction < 0 && camera > 0 && offset < 10) this.cameraX -= 8;
        if (direction > 0 && camera < 232 && offset < 128 && offset > 12) this.cameraX += 8;
      };
      if (!air) {
        this.momentum = 0;
        if (input.left) { this.momentum = -config.horizontalMomentumCap; step(-1); }
        if (input.right && !this.pendingStrip) { this.momentum = config.horizontalMomentumCap; step(1); }
      } else {
        if (input.left) { this.facing = -1; this.momentum = Math.max(-config.horizontalMomentumCap, this.momentum - 1); }
        if (input.right) { this.facing = 1; this.momentum = Math.min(config.horizontalMomentumCap, this.momentum + 1); }
        if (this.momentum < 0) { this.momentum++; step(-1); }
        if (this.momentum > 0 && !this.pendingStrip) { this.momentum--; step(1); }
      }
      return x;
    };
    const result = this.vertical.tick(Math.max(0, Math.floor((position.y + 0.001) / 8)),
      Math.max(0, Math.floor((position.x + 0.001) / 8)), Boolean(input.jump || this.jumpQueued), boots, world,
      move, () => Boolean(this.pendingStrip));
    this.jumpQueued = false;
    if (!movedInAir && !result.dead && !this.pendingStrip && this.vertical.airborne) {
      this.momentum = Math.sign(this.momentum) * config.edgeFallHorizontalMomentum;
    }
    if (movedInAir && this.vertical.airborne && !result.dead && !this.pendingStrip) this.pose = 4;
    if (this.pendingStrip) this.vertical.velocity = 0;
    placeSprite(this, this.sprite, { x: result.x * 8, y: result.y * 8 });
    this.vx = result.x * 8 - position.x;
    this.vy = this.vertical.velocity;
    this.onGround = !this.vertical.airborne;
    this.dead = result.dead;
  }

  draw(ctx, camX, camY, pf, sprite) {
    if (sprite) {
      // Original EXE frames: idle, three walk poses, air pose, then the left bank.
      // Bottom-center alignment converts the interface box to sprite coordinates.
      const sw = sprite.w, sh = sprite.h;
      const poses = sprite.animations?.[this.facing > 0 ? 'right' : 'left'];
      const frame = poses
        ? (this.pose === 4 ? poses.air : this.pose ? poses.walk[this.pose - 1] : poses.idle)
        : this.facing > 0 ? 0 : 1;
      const dx = Math.round(pf.x + this.x + this.w / 2 - sw / 2 - camX);
      const dy = Math.round(pf.y + this.y + this.h - sh - camY);
      ctx.drawImage(sprite.img, frame * sw, 0, sw, sh, dx, dy, sw, sh);
      return;
    }
    // fallback placeholder if the sprite asset is missing
    const x = Math.round(pf.x + this.x - camX), y = Math.round(pf.y + this.y - camY);
    ctx.fillStyle = '#ccc';
    ctx.fillRect(x + 2, y, 8, 5);
    ctx.fillStyle = '#00c';
    ctx.fillRect(x + 1, y + 5, 10, 7);
  }
}
