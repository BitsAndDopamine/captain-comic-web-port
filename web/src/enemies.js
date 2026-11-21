// COMIC.EXE 0x1ac0..0x2003. State/positions use the original eight-pixel units.
const byte = n => n & 255;
const signed = n => (n & 128) ? (n & 255) - 256 : n & 255;

export function playerEnemyContact(player, enemy) {
  return Math.abs(enemy.xUnits - player.xUnits) < 2
    && byte(enemy.yUnits - player.yUnits) < 4;
}

export function fireballEnemyContact(fireball, enemy) {
  const dy = byte(Math.floor(fireball.y / 8) - enemy.yUnits);
  return enemy.alive && dy <= 1 && Math.abs(Math.floor(fireball.x / 8) - enemy.xUnits) <= 1;
}

export function playerSpriteUnits(player, sprite) {
  return {
    xUnits: Math.floor((player.x + (player.w - sprite.w) / 2) / 8),
    yUnits: Math.floor((player.y + player.h - sprite.h) / 8),
    facing: player.facing,
  };
}

export class Enemy {
  constructor(slot, descriptor, sprite) {
    this.slot = slot.slot;
    this.behavior = slot.behaviorCode;
    this.descriptor = descriptor;
    this.sprite = sprite;
    this.xUnits = 0; this.yUnits = 0;
    this.dx = 0; this.dy = 0;
    this.phase = slot.initialPhase2 ? 2 : 0;
    this.state = 0;
    this.counter = 20; // Inactive delay; active animation index uses the same byte.
    this.bank = 0;
    this.w = 16; this.h = 16;
  }
  get alive() { return this.state === 1; }
  get x() { return this.xUnits * 8; }
  get y() { return this.yUnits * 8; }
  get frame() {
    const d = this.descriptor;
    const pose = this.counter < d.cycleFrames ? this.counter : d.cycleFrames - 2;
    return pose + (this.bank && d.directionBanks === 2 ? d.cycleFrames : 0);
  }
  hit(contact = false) { this.state = contact ? 8 : 2; }
  draw(ctx, pf, camX, camY) {
    const state = this.renderState ?? this.state;
    if (!state || state === 7 || state === 13) return;
    const screenX = this.x - camX;
    if (screenX < 0 || screenX > 176) return;
    const x = Math.round(pf.x + screenX), y = Math.round(pf.y + this.y - camY);
    const stage = state > 7 ? state - 6 : state;
    if (stage <= 4) ctx.drawImage(this.sprite.img, this.frame * 16, 0, 16, 16, x, y, 16, 16);
    if (state > 1 && this.effects) {
      ctx.drawImage(this.effects.img, (state - 2) * 16, 0, 16, 16, x, y, 16, 16);
    }
  }
}

export class EnemySystem {
  constructor(area, strip, sprites, shared = { spawnOffset: 22, respawnDelay: 20 }) {
    this.shared = shared; // Original DS:d440/d441 persist across strip loads.
    this.enemies = strip.enemySlots.map(slot => {
      const d = area.sprites.find(s => s.slot === slot.spriteSlot);
      const e = new Enemy(slot, d, sprites[d.file.split('.')[0].toUpperCase()]);
      e.effects = sprites.ENEMY_EFFECTS;
      return e;
    });
  }
  recycle(e) {
    e.state = 0;
    e.renderState = 0;
    e.counter = this.shared.respawnDelay;
    this.shared.respawnDelay += 20;
    if (this.shared.respawnDelay >= 120) this.shared.respawnDelay = 20;
  }
  spawn(e, world, player, camera) {
    e.counter = 0;
    if (this.spawned) return;
    let offset = this.shared.spawnOffset + 2;
    if (offset >= 31) offset = 24;
    this.shared.spawnOffset = offset;
    let x;
    if (player.facing > 0) {
      x = byte(camera + offset);
      // The original uses JO (signed overflow), not JC (unsigned carry).
      if ((~(camera ^ offset) & (camera ^ x) & 128) !== 0) return;
    } else {
      const delta = byte(offset - 22);
      if (camera < delta) return;
      x = byte(camera - delta);
    }
    let y = (player.yUnits & 254) + 4;
    // The spawn scanner tests one tile column, not the straddling 16px footprint.
    while (y > 0 && !world.tile(x >> 1, y >> 1)) y -= 2;
    if (y <= 0) return;
    do { y -= 2; } while (y >= 0 && world.tile(x >> 1, y >> 1));
    if (y < 0) return;
    e.xUnits = x; e.yUnits = y; e.state = 1;
    this.spawned = true;
    if (e.behavior === 127) {
      e.state = 0; e.counter = 100; this.spawned = false;
    } else if (e.behavior === 1 || e.behavior === 5) e.dx = e.dy = -1;
    else e.dx = e.dy = 0;
  }
  tick(world, player, camera, onContact = () => {}) {
    this.spawned = false;
    for (const e of this.enemies) {
      e.renderState = 0;
      if (e.state === 0) {
        if (--e.counter < 0) this.spawn(e, world, player, camera);
        continue;
      }
      if (e.state > 1) {
        const relativeX = signed(e.xUnits - camera);
        if (e.state === 7 || e.state === 13 || relativeX < 0 || relativeX > 22) this.recycle(e);
        else { e.renderState = e.state; e.state++; }
        continue;
      }
      e.counter = (e.counter + 1) % e.descriptor.animationSteps;
      this.move(e, world, player, camera);
      e.renderState = e.state;
      if (Math.abs(e.xUnits - player.xUnits) >= 30) { this.recycle(e); continue; }
      if (onContact && playerEnemyContact(player, e)) {
        e.hit(true);
        e.renderState = 8;
        if (onContact(e) === false) return; // Fatal contact stops the gameplay tick.
        e.state++; // Contact's first effect frame is drawn in the original hit tick.
      }
    }
  }
  move(e, world, player, camera) {
    // DBA: one tile row across 16px. DF4: one tile column across 16px.
    const tile = (c, r) => world.enemyTile ? world.enemyTile(c, r) : world.tile(c, r);
    const row = (x, y) => tile(byte(x) >> 1, byte(y) >> 1)
      || ((byte(x) & 1) && tile((byte(x) >> 1) + 1, byte(y) >> 1));
    const col = (x, y) => tile(byte(x) >> 1, byte(y) >> 1)
      || ((byte(y) & 1) && tile(byte(x) >> 1, (byte(y) >> 1) + 1));
    let x = e.xUnits, y = e.yUnits;
    const horizontal = (bank = true) => {
      if (e.dx === 1) {
        if (bank) e.bank = 5;
        const blocked = col(x + 2, y);
        if (!blocked) x = byte(x + 1);
        const relative = byte(x - camera);
        if (blocked || (x >= camera && relative >= 22)) e.dx = -1;
      } else {
        if (bank) e.bank = 0;
        if (x === 0 || col(x - 1, y)) e.dx = 1;
        else { x--; if (x <= camera) e.dx = 1; }
      }
    };
    const verticalUp = () => { if (y === 0 || row(x, y - 1)) e.dy = 1; else { y--; if (!y) e.dy = 1; } };
    const verticalDown = () => {
      if (signed(y) >= 18 || row(x, y + 2)) e.dy = -1;
      else { y++; if (signed(y) >= 18) e.dy = -1; }
    };
    const halfTick = () => {
      if (e.phase === 1) { e.phase = 0; return false; }
      e.phase = byte(e.phase + 1); return true;
    };
    switch (e.behavior) {
      case 1:
      case 5:
        if (signed(e.phase) <= 1 && !halfTick()) break;
        horizontal();
        if (e.behavior === 1) {
          if (e.dy === 1) verticalDown(); else verticalUp();
        } else {
          // Retreat upwards when Comic is looking toward this side of him.
          const looking = (player.xUnits > x && player.facing < 0)
            || (player.xUnits < x && player.facing > 0);
          if (looking || player.yUnits < y) verticalUp();
          else if (player.yUnits > y) verticalDown();
        }
        break;
      case 2: {
        if (e.dy === 0 && row(x, y + 2)) {
          e.dx = player.xUnits >= x ? 1 : -1;
          e.dy = -7;
          break;
        }
        if (e.dy < 0) {
          const next = y - -(e.dy >> 3);
          if (next >= 0 && !row(x, next)) y = next;
        } else if (e.dy > 0) {
          const next = byte(y + (e.dy >> 3));
          if (signed(next) >= 18) { e.yUnits = 18; e.state = 7; return; }
          if (!row(x, next + 1)) y = next;
        }
        e.dy += 2;
        if (e.dy >= 24) e.dy = 23;
        if (halfTick()) horizontal(false);
        if (e.dy > 0 && row(x, y + 3)) { y = (y + 1) & 254; e.dy = 0; }
        break;
      }
      case 3:
        if (e.dy > 0) {
          y++;
          if (signed(y) >= 17) { e.yUnits = 18; e.state = 7; return; }
        } else e.dx = Math.sign(player.xUnits - x);
        if (halfTick()) {
          if (!e.dx) e.phase = 0;
          else if (e.dx > 0) { if (!col(x + 2, y)) x = byte(x + 1); }
          else if (!col(x - 1, y)) x = byte(x - 1);
        }
        if (!row(x, y + 3)) e.dy = 1;
        else if (e.dy) { y = (y + 1) & 254; e.dy = 0; }
        break;
      case 4:
        if (halfTick()) {
          let blocked = true;
          if (player.xUnits > x) {
            e.bank = 5;
            blocked = Boolean(col(x + 2, y));
            if (!blocked) x = byte(x + 1);
          } else if (player.xUnits < x) {
            e.bank = 0;
            blocked = Boolean(col(x - 1, y));
            if (!blocked) x = byte(x - 1);
          }
          // Vertical pursuit happens only when X is aligned or blocked.
          if (blocked && player.yUnits !== y) {
            if (player.yUnits > y) { if (!row(x, y + 2)) y = byte(y + 1); else e.phase = 0; }
            else if (!row(x, y - 1)) y = byte(y - 1);
            else e.phase = 0;
          } else if (blocked) e.phase = 0;
        }
        break;
    }
    e.xUnits = byte(x); e.yUnits = byte(y);
  }
}
