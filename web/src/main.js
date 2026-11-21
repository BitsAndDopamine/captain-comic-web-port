// Captain Comic web port — entry point.
// The whole 320x200 screen chrome (gray background, white frame, HUD panel, score
// box, energy bars, bottom life-icon strip) is the original SYS003 screen, drawn as
// the base image; the level is blitted into the playfield window on top of it.
// Keys: left/right = walk, Up = jump, Space = fire, Alt+Key = door; 1/2/3 and [ ] debug.

import { loadAssets } from './assets.js';
import { Player, initialCamera } from './player.js';
import { Fireball, Pickup, pickupContact, pickupVisible, fireballOrigin } from './entities.js';
import { DeathSequence } from './death.js';
import { EnemySystem, playerSpriteUnits, fireballEnemyContact } from './enemies.js';
import { doorAtPlayer, doorArrival, doorAnimationFrame, drawDoorOpening } from './doors.js';
import { Startup, initialPlayerPosition } from './startup.js';
import { drawTilemap } from './tilemap.js';
import { LifeSystem, drawLifeIcons, drawEnergyCells, drawFireballCapacity } from './lives.js';
import { GameAudio } from './audio.js';
import { terrainIsDark, spritePosition, placeSprite, wandDestination, drawWandEffects } from './items.js';
import { parseTestOptions, applyTestOptions } from './test_options.js';
import { CONTROLS, gameplayInput, preventGameplayKeyDefault } from './controls.js';
import { HighScores, RunMenu, isPracticeSetup, SCORE_LIMIT } from './high_scores.js';
import { Victory, hasAllTreasures } from './victory.js';
import { createPaletteScreens } from './palette.js';
import { TouchControls } from './touch_controls.js';
import { Presentation } from './presentation.js';

const VIEW_W = 320, VIEW_H = 200;
let PF = { x: 7, y: 7, w: 196, h: 162 };      // playfield window (from hud.json, measured on SYS003)
const STEP = 1 / 60;

class World {
  constructor(assets, area, stripIndex) {
    this.assets = assets;
    this.area = area;
    this.stripIndex = stripIndex;
    this.level = assets.levels[area];
    this.areaData = assets.world.areas.find(a => a.area === area);
    this.stripData = this.areaData.strips[stripIndex];
    this.tiles = assets.tiles[area];
    this.w = this.level.w; this.h = this.level.h;
    this.wPx = this.w * 16; this.hPx = this.h * 16;
    this.strip = this.level.strips[stripIndex];
    this.solid = this.tiles.solid;
  }
  tile(c, r) {
    if (c < 0 || c >= this.w) return 1;
    if (r < 0) return 1;
    if (r >= this.h) return 0;
    return this.solid[this.strip[r * this.w + c]];
  }
  solidAtPx(px, py) { return this.tile(Math.floor(px / 16), Math.floor(py / 16)); }
  enemyTile(c, r) { return this.solid[this.strip[r * this.w + c]] ?? false; }

  findSpawn() {
    // leftmost walkable ground (solid tile with 2 air tiles above), scanning from the left
    for (let c = 2; c < this.w; c++) {
      for (let r = this.h - 1; r >= 2; r--) {
        if (this.tile(c, r) && !this.tile(c, r - 1) && !this.tile(c, r - 2)) {
          return { x: c * 16 + 2, y: r * 16 - 15 };
        }
      }
    }
    return { x: 32, y: 32 };
  }

  draw(ctx, camX, camY) {
    if (!this.dark) drawTilemap(ctx, this, PF, camX, camY);
  }
}

export class Game {
  constructor(assets, audio = null, testOptions = null) {
    this.assets = assets;
    this.audio = audio;
    this.areaNames = assets.areas.entries.map(e => e.area.toUpperCase());
    this.areaIdx = this.areaNames.indexOf(assets.startup.initialState.area);
    this.life = new LifeSystem(assets.mechanics.lives, event => this.playSound(event));
    const fireball = assets.mechanics.fireball;
    this.weapon = fireball.initialEnergy;
    this.colas = fireball.initialCapacity;
    this.inventory = new Set();
    this.collectedPickups = new Set();
    this.pickupPhase = 0; // DS:d490 persists across strips and ordinary deaths.
    this.camX = 0; this.camY = 0;
    this.dosTickAccumulator = 0;
    this.weaponRechargeTicks = 0;
    this.showDebug = false;
    this.paused = false;
    this.practice = isPracticeSetup(testOptions);
    this.enemyScheduler = { spawnOffset: 22, respawnDelay: 20 };
    this.victory = null;
    applyTestOptions(this, testOptions);
    this.loadStrip(assets.startup.initialState.strip);
    this.camX = assets.startup.initialState.cameraX;
    this.armVictory(); // Explicit URL treasure grants are a practice ending preview.
  }
  get area() { return this.areaNames[this.areaIdx]; }
  get runEnded() { return this.life.gameOver || this.victory?.stage === 'gameOver'; }
  armVictory() {
    if (!this.victory && hasAllTreasures(this.inventory, this.assets.mechanics.victory)) {
      this.victory = new Victory(this.assets.mechanics.victory);
    }
  }
  stepVictory() {
    this.dosTickAccumulator += STEP * this.assets.mechanics.victory.timerTicksPerSecond;
    while (this.dosTickAccumulator >= 1) {
      this.dosTickAccumulator--;
      this.victory.tick(this.life, event => this.playSound(event));
    }
  }
  playSound(event) { this.audio?.playEvent(event); }
  get lives() { return this.life.spares; }
  get score() { return this.life.score; }
  set score(value) { this.life.score = value; }
  get shield() { return this.life.shield; }
  set shield(value) { this.life.shield = value; }
  loadStrip(stripIndex) {
    this.doorTransition = null; // Debug strip/area changes cancel an in-flight animation.
    this.deathTransition = null;
    this.wandTransition = null;
    this.world = new World(this.assets, this.area, stripIndex);
    const initial = this.assets.startup.initialState;
    this.player = new Player(0, 0, this.assets.mechanics.playerPhysics, this.assets.sprites.PLAYER);
    if (this.inventory.has('boots')) this.player.vertical.boostCounter = this.assets.mechanics.playerPhysics.bootsJumpCounter;
    const s = this.area === initial.area && stripIndex === initial.strip
      ? initialPlayerPosition(this.assets.startup, this.assets.sprites.PLAYER, this.player)
      : this.world.findSpawn();
    Object.assign(this.player, { x: s.x, y: s.y, spawnX: s.x, spawnY: s.y });
    this.enemySystem = new EnemySystem(this.world.areaData, this.world.stripData,
      this.assets.sprites, this.enemyScheduler);
    this.enemies = this.enemySystem.enemies;
    const pickup = this.world.stripData.pickup;
    const pickupKey = `${this.area}:${stripIndex}`;
    this.pickups = this.collectedPickups.has(pickupKey) ? [] : [
      new Pickup(pickup.kind, this.assets.sprites.ITEMS, pickup.id, pickup.x, pickup.y, pickupKey),
    ];
    this.fireballs = [];
    this.updateCamera();
  }
  updateCamera() {
    const spriteX = this.player.x + (this.player.w - this.assets.sprites.PLAYER.w) / 2;
    // Strip/door/death initialization (0x0ceb); walking scrolls in Player.tick.
    this.camX = initialCamera(spriteX);
    this.player.cameraX = this.camX;
    this.camY = 0;
  }
  changeStrip(stripIndex, enterFrom) {
    const old = this.player;
    const oldY = old.y, facing = old.facing;
    this.loadStrip(stripIndex);
    placeSprite(this.player, this.assets.sprites.PLAYER, {
      x: enterFrom === 'right' ? 254 * 8 : 0,
      y: spritePosition(old, this.assets.sprites.PLAYER).y,
    });
    this.player.y = oldY;
    this.player.vy = 0;
    this.player.vertical = old.vertical;
    this.player.vertical.velocity = 0; // EXE 0x1a79 resets vertical velocity at a strip link.
    this.player.verticalTicks = old.verticalTicks;
    this.player.onGround = !this.player.vertical.airborne;
    this.player.vx = 0;
    this.player.facing = facing;
    this.player.momentum = old.momentum;
    this.player.animationPhase = old.animationPhase;
    this.player.pose = old.pose;
    this.player.spawnX = this.player.x;
    this.player.spawnY = this.player.y;
    this.updateCamera();
    this.playSound('stripChange');
  }
  crossConnectedStrip() {
    const p = this.player, links = this.world.stripData;
    if (p.pendingStrip === 'left' && links.leftStrip !== null) {
      this.changeStrip(links.leftStrip, 'right');
      return true;
    }
    if (p.pendingStrip === 'right' && links.rightStrip !== null) {
      this.changeStrip(links.rightStrip, 'left');
      return true;
    }
    return false;
  }
  enterLinkedDoor() {
    if (this.doorTransition || this.runEnded || this.victory?.active) return false;
    const p = this.player;
    const sprite = this.assets.sprites.PLAYER;
    const door = doorAtPlayer(p, sprite, this.world.stripData.doors,
      this.inventory.has(this.assets.mechanics.doors.requiredItem));
    if (!door) return false;

    const target = this.assets.world.areas[door.targetAreaId];
    const targetStrip = target.strips[door.targetStrip];
    // The game finds a reciprocal door pointing back to this area and strip.
    const returnDoor = targetStrip.doors.find(d =>
      d.targetAreaId === this.world.areaData.id && d.targetStrip === this.world.stripIndex);
    if (!returnDoor) return false;
    const areaIndex = this.areaNames.indexOf(target.area);
    if (areaIndex < 0) return false;
    p.vx = 0; p.vy = 0;
    this.doorTransition = {
      stage: 'departure', elapsedTicks: 0, door, returnDoor,
      areaIndex, stripIndex: door.targetStrip, facing: p.facing,
    };
    this.playSound('door');
    return true;
  }
  stepDoorTransition() {
    const transition = this.doorTransition;
    const config = this.assets.mechanics.doors;
    transition.elapsedTicks += STEP * config.timerTicksPerSecond;
    if (transition.stage === 'arrival' && !transition.soundPlayed
      && transition.elapsedTicks >= config.arrivalSoundDelayTicks) {
      this.playSound('door');
      transition.soundPlayed = true;
    }
    if (doorAnimationFrame(transition, config)) return;
    if (transition.stage === 'arrival') {
      this.doorTransition = null;
      return;
    }
    this.areaIdx = transition.areaIndex;
    this.loadStrip(transition.stripIndex);
    const arrival = doorArrival(this.player, this.assets.sprites.PLAYER, transition.returnDoor);
    Object.assign(this.player, arrival, {
      spawnX: arrival.x, spawnY: arrival.y, facing: transition.facing, onGround: true,
    });
    transition.stage = 'arrival';
    transition.elapsedTicks = 0;
    transition.soundPlayed = false;
    transition.door = transition.returnDoor;
    this.doorTransition = transition;
    this.updateCamera();
  }
  switchArea(d) {
    this.areaIdx = (this.areaIdx + d + this.areaNames.length) % this.areaNames.length;
    this.loadStrip(0);
  }
  useWand() {
    if (this.wandTransition || this.doorTransition || this.deathTransition || this.runEnded || this.victory?.active
      || !this.player.onGround || !this.inventory.has('wand')) return false;
    const position = spritePosition(this.player, this.assets.sprites.PLAYER);
    const result = wandDestination(this.world, {
      xUnits: Math.floor((position.x + 0.001) / 8),
      yUnits: Math.floor((position.y + 0.001) / 8), facing: this.player.facing,
    }, Math.max(0, Math.min(232, Math.floor(this.camX / 8))), this.assets.mechanics.items.wand);
    this.wandTransition = { ...result, phase: 0, renderPhase: null };
    this.player.vx = 0; this.player.vy = 0;
    this.playSound('teleportShift');
    return true;
  }
  stepWandTransition() {
    const t = this.wandTransition, config = this.assets.mechanics.items.wand;
    if (t.phase === config.durationTicks) { this.wandTransition = null; return; }
    t.renderPhase = t.phase;
    if (t.shift > 0) {
      this.camX += t.direction * 8;
      t.shift--;
    }
    if (t.phase === config.relocateAtTick) {
      placeSprite(this.player, this.assets.sprites.PLAYER, { x: t.to.xUnits * 8, y: t.to.yUnits * 8 });
    }
    t.phase++;
  }
  kill(cause = 'fall') {
    if (this.deathTransition || this.runEnded || this.victory?.active) return;
    this.deathTransition = Object.assign(new DeathSequence(this.assets.mechanics.death, cause,
      playerSpriteUnits(this.player, this.assets.sprites.PLAYER).yUnits), {
      spawnX: this.player.spawnX, spawnY: this.player.spawnY, facing: this.player.facing });
    this.player.vx = 0; this.player.vy = 0;
    this.wandTransition = null;
    if (cause === 'enemy') { this.playSound('contactDeath'); this.stepExplosion(); }
    else if (this.deathTransition.cropHeight) this.player.pose = 4;
  }
  stepExplosion() {
    this.enemySystem.tick(this.world, playerSpriteUnits(this.player, this.assets.sprites.PLAYER),
      Math.floor(this.camX / 8), () => { this.life.takeHit(true); });
    this.collectPickups();
  }
  stepDeathTransition() {
    this.dosTickAccumulator += STEP * this.assets.mechanics.death.timerTicksPerSecond;
    while (this.dosTickAccumulator >= 1 && this.deathTransition) {
      this.dosTickAccumulator--;
      this.tickDeath();
    }
  }
  tickDeath() {
    const action = this.deathTransition.tick();
    if (action === 'explosion') this.stepExplosion();
    else if (action === 'deathSound') this.playSound('death');
    else if (action === 'lifeCheck') this.finishDeath();
    else if (action === 'gameOver') {
      this.life.loseLife(); this.deathTransition = null; this.playSound('gameOver');
    }
  }
  finishDeath() {
    const death = this.deathTransition;
    if (this.life.spares === 0) { death.stage = 'gameOverWait'; death.ticks = 0; return; }
    const ceilingPush = this.player.vertical.ceilingPush;
    const enemies = this.enemies;
    this.life.loseLife();
    this.loadStrip(this.world.stripIndex);
    Object.assign(this.player, { x: death.spawnX, y: death.spawnY,
      spawnX: death.spawnX, spawnY: death.spawnY, facing: death.facing, onGround: true });
    this.player.vertical.boostCounter = this.assets.mechanics.death.resetJumpCounter;
    this.player.vertical.ceilingPush = ceilingPush;
    this.enemies.forEach((enemy, index) => {
      for (const key of ['xUnits', 'yUnits', 'dx', 'dy']) enemy[key] = enemies[index][key];
    });
    this.weaponRechargeTicks = 0;
    this.updateCamera();
  }
  collectPickups() {
    const player = playerSpriteUnits(this.player, this.assets.sprites.PLAYER);
    for (const pk of this.pickups) {
      if (pk.taken || !pickupVisible(pk, this.camX)) continue;
      if (!pickupContact(player, pk, this.camX)) {
        this.pickupPhase = (this.pickupPhase + 1) % 2;
        pk.bank = this.pickupPhase === 0 ? 16 : 0;
        continue;
      }
      pk.taken = true;
      this.playSound('pickup');
      this.collectedPickups.add(pk.stateKey);
      this.life.addPoints(2_000);
      if (pk.kind === 'cola') this.colas = Math.min(5, this.colas + 1);
      else if (pk.kind === 'shield') this.life.collectShield();
      else {
        this.inventory.add(pk.kind);
        if (['gems', 'gold', 'crown'].includes(pk.kind)) {
          this.life.awardLife(); this.armVictory();
        }
      }
    }
  }
  step(input) {
    if (this.paused || this.runEnded) return;
    if (this.victory?.active) { this.stepVictory(); return; }
    if (this.deathTransition) { this.stepDeathTransition(); return; }
    if (this.doorTransition) { this.stepDoorTransition(); return; }
    const p = this.player;
    if (!this.wandTransition) {
      if (input.doorPressed && this.enterLinkedDoor()) return;
      if (input.teleportPressed) this.useWand();
    }
    if (!this.wandTransition) {
      p.sampleInput(input, this.inventory.has('boots'));
    }

    // Original fire/energy/enemy logic runs on the BIOS timer (~18.2 Hz), not 60 Hz.
    const fireball = this.assets.mechanics.fireball;
    this.dosTickAccumulator += STEP * fireball.timerTicksPerSecond;
    while (this.dosTickAccumulator >= 1) {
      this.dosTickAccumulator -= 1;
      if (this.victory) {
        this.victory.tick(this.life, event => this.playSound(event));
        if (this.victory.active) { this.wandTransition = null; return; }
      }
      this.life.tick();
      if (!this.wandTransition) {
        p.tick(input, this.world, this.inventory.has('boots'), this.camX);
        this.camX = p.cameraX;
        if (p.dead) { this.kill(); return; }
        if (this.crossConnectedStrip()) return;
      }
      if (this.wandTransition?.phase === this.assets.mechanics.items.wand.durationTicks) {
        this.wandTransition = null; // Keep phase 5 visible until the next gameplay tick.
      }
      const teleporting = Boolean(this.wandTransition);
      if (teleporting) {
        p.animationPhase = p.animationPhase % 3 + 1;
        this.stepWandTransition();
      }
      else if (input.fire) {
        if (this.weapon > 0) {
          if (this.fireballs.length < this.colas) {
            const origin = fireballOrigin(p, this.assets.sprites.PLAYER, fireball);
            this.fireballs.push(new Fireball(this.assets.sprites[fireball.sprite],
              origin.x, origin.y, p.facing,
              this.inventory.has('corkscrew'), fireball));
            this.playSound('fire');
          }
          this.weapon = Math.max(0, this.weapon - fireball.energyCostPerShot);
        }
        this.weaponRechargeTicks = 0;
      } else if (++this.weaponRechargeTicks >= fireball.rechargeTicksPerEnergy) {
        this.weapon = Math.min(fireball.maxEnergy, this.weapon + 1);
        this.weaponRechargeTicks = 0;
      }
      this.enemySystem.tick(this.world, playerSpriteUnits(p, this.assets.sprites.PLAYER),
        Math.max(0, Math.min(232, Math.floor(this.camX / 8))), () => {
          if (this.life.takeHit()) { p.dead = true; return false; }
        });
      if (p.dead) { this.kill('enemy'); return; }
      for (const f of this.fireballs) f.tick(this.world, this.camX);
      // Original projectile hit windows use sprite coordinate units (0x20ed).
      for (const f of this.fireballs) {
        if (!f.alive) continue;
        const enemy = this.enemies.find(e => fireballEnemyContact(f, e));
        if (enemy) {
          f.alive = false; enemy.hit(); this.life.addPoints(300);
          this.playSound('enemyHit');
        }
      }
      this.fireballs = this.fireballs.filter(f => f.alive);
      this.collectPickups();
    }
  }
  draw(ctx, now, { showPlayer = true, showEnemies = true } = {}) {
    const victory = this.victory;
    if (victory?.stage === 'ending') {
      ctx.drawImage(this.assets.paletteScreens?.[victory.config.endingScreen]?.[victory.paletteStep]
        ?? this.assets.sys[victory.config.endingScreen].img, 0, 0);
      if (this.paused) ctx.drawImage(this.assets.sprites.PAUSE.img, 40, 64);
      return;
    }
    const worldActive = !victory?.active;
    const death = this.deathTransition;
    const entitiesVisible = worldActive && !this.runEnded && (!death || death.stage === 'explosion');
    const H = this.assets.hud;
    // Snap rendering only, once for every layer; physics keeps the precise camera.
    const camX = Math.round(this.camX), camY = Math.round(this.camY);
    // base: the original in-game chrome screen (frame, panel, bars, life strip)
    ctx.drawImage(this.assets.sys.SYS003.img, 0, 0);
    // Clear the window, then draw every opaque level tile (including tile 0).
    ctx.save();
    ctx.beginPath();
    ctx.rect(PF.x, PF.y, PF.w, PF.h);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(PF.x, PF.y, PF.w, PF.h);
    this.world.dark = terrainIsDark(this.area, this.inventory, this.assets.mechanics.items.lantern);
    this.world.draw(ctx, camX, camY);
    const transition = this.doorTransition;
    const doorFrame = transition && doorAnimationFrame(transition, this.assets.mechanics.doors);
    if (doorFrame) {
      drawDoorOpening(ctx, this.world.tiles, this.world.areaData.transitionTiles,
        transition.door, this.world.dark ? { ...doorFrame, shutters: false } : doorFrame, PF, camX, camY);
    }
    const explosionFrame = death?.explosionFrame ?? -1;
    const deathPlayerVisible = !death || death.playerVisible;
    if (showPlayer && !this.runEnded && (worldActive || victory.playerVisible)
      && deathPlayerVisible && (!doorFrame || doorFrame.player)) {
      if (death?.stage === 'fallCrop') {
        const position = spritePosition(this.player, this.assets.sprites.PLAYER);
        ctx.save(); ctx.beginPath();
        ctx.rect(PF.x, PF.y + position.y - camY, PF.w, death.cropHeight); ctx.clip();
        this.player.draw(ctx, camX, camY, PF, this.assets.sprites.PLAYER); ctx.restore();
      } else this.player.draw(ctx, camX, camY, PF, this.assets.sprites.PLAYER);
    }
    if (this.wandTransition) drawWandEffects(ctx, this.assets.sprites.WAND_SHIFT,
      this.wandTransition, PF, camX, this.assets.mechanics.items.wand);
    if (entitiesVisible && showEnemies) for (const e of this.enemies) e.draw(ctx, PF, camX, camY);
    if (entitiesVisible && !death) for (const f of this.fireballs) f.draw(ctx, PF, camX, camY);
    if (explosionFrame >= 0 && explosionFrame < this.assets.sprites.PLAYER_DEATH.frames) {
      const effect = this.assets.sprites.PLAYER_DEATH, p = this.player;
      ctx.drawImage(effect.img, explosionFrame * effect.w, 0, effect.w, effect.h,
        Math.round(PF.x + p.x + (p.w - effect.w) / 2 - camX),
        Math.round(PF.y + p.y + p.h - effect.h - camY), effect.w, effect.h);
    }
    if (victory && victory.effectFrame !== null) {
      const effect = this.assets.sprites[victory.config.effect], p = this.player;
      ctx.drawImage(effect.img, victory.effectFrame * effect.w, 0, effect.w, effect.h,
        Math.round(PF.x + p.x + (p.w - effect.w) / 2 - camX),
        Math.round(PF.y + p.y + p.h - effect.h - camY), effect.w, effect.h);
    }
    if (entitiesVisible) for (const pk of this.pickups) pk.draw(ctx, PF, camX, camY, now);
    ctx.restore();
    // dynamic HUD on top of the chrome: score digits in the black box
    const sd = this.assets.mechanics.hud.scoreDigits;
    const font = this.assets.sprites.SCORE_DIGITS;
    // Six dynamic base-100 digits; the two trailing zeroes are part of SYS003.
    const s = String(Math.floor(this.score / 100) % 1_000_000).padStart(sd.count, '0');
    for (let i = 0; i < sd.count; i++) {
      const digit = Number(s[i]);
      ctx.drawImage(font.img, digit * font.w, 0, font.w, font.h,
        sd.x + i * sd.pitch, sd.y, font.w, font.h);
    }
    const lifeConfig = this.assets.mechanics.lives;
    drawEnergyCells(ctx, this.assets.sprites[lifeConfig.energyCells.sprite],
      this.weapon, this.shield, lifeConfig.energyCells);
    drawLifeIcons(ctx, this.assets.sprites[lifeConfig.icons.sprite], this.life.spares, lifeConfig.icons);
    // inventory: item icons in the big black box of the panel
    const pb = H.panelBox;
    let i = 0;
    for (const item of this.inventory) {
      const ii = this.assets.hudImgs.items[item];
      if (!ii) continue;
      const cx = pb.x + 4 + (i % 4) * 16 + (16 - ii.w) / 2;
      // Reserve the original capacity display at (232,112).
      const cy = pb.y + 26 + Math.floor(i / 4) * 18 + (16 - ii.h) / 2;
      ctx.drawImage(ii.img, Math.round(cx), Math.round(cy));
      i++;
    }
    const capacityLayout = lifeConfig.fireballCapacity;
    drawFireballCapacity(ctx, this.assets.sprites[capacityLayout.sprite], this.colas, capacityLayout,
      Boolean(Math.floor(now * lifeConfig.timerTicksPerSecond / 1000) & 1));
    if (this.runEnded) {
      const rect = lifeConfig.gameOver, graphic = this.assets.sprites[rect.sprite];
      ctx.drawImage(graphic.img, rect.x, rect.y);
    }
    if (this.paused && !this.runEnded) ctx.drawImage(this.assets.sprites.PAUSE.img, 40, 64);
    // dev overlay (toggle with `)
    if (this.showDebug) {
      ctx.fillStyle = '#fff';
      ctx.font = '8px monospace';
      const p = this.player;
      ctx.fillText(`${this.area} s${this.world.stripIndex} L:${this.lives} S:${this.score} sh:${this.shield} w:${Math.round(this.weapon)} cola:${this.colas} inv:${[...this.inventory]} x:${p.x | 0} y:${p.y | 0}`, 8, 16);
    }
  }
}

async function main() {
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const assets = await loadAssets();
  assets.paletteScreens = Object.fromEntries(assets.palette.reveal.screens.map(name =>
    [name, createPaletteScreens(assets.sys[name].img, assets.palette.colors, assets.palette.reveal)]));
  PF = assets.hud.playfield;   // measured playfield window from SYS003
  const audio = new GameAudio();
  window.__audio = audio;
  const testOptions = parseTestOptions(window.location.search, assets.mechanics);
  window.__testOptions = testOptions;
  let game = new Game(assets, audio, testOptions);
  window.__game = game;
  const startup = new Startup(assets.startup);
  if (testOptions.skipIntro) startup.skip();
  window.__startup = startup;
  const textPanel = document.getElementById('startup-text');
  const textCopy = document.getElementById('startup-copy');
  const hint = document.getElementById('game-hint-copy');
  const repoLink = document.getElementById('repo-link');
  const continueButton = document.getElementById('continue');
  const soundButton = document.getElementById('sound-toggle');
  const pauseButton = document.getElementById('pause');
  const scoresButton = document.getElementById('high-scores');
  const quitButton = document.getElementById('quit');
  const scoresPanel = document.getElementById('scores-screen');
  const scoreRows = document.getElementById('score-rows');
  const scoreEntry = document.getElementById('score-entry');
  const scoreName = document.getElementById('score-name');
  const scoreBoard = document.getElementById('score-board');
  const scoreClose = document.getElementById('score-close');
  const scoreStorage = document.getElementById('score-storage');
  const fullscreenButton = document.getElementById('fullscreen');
  const touchButton = document.getElementById('touch-toggle');
  let storage = null;
  try { storage = window.localStorage; } catch { /* Private/blocked storage: keep scores in memory. */ }
  const scores = new HighScores(storage), menu = new RunMenu(scores);
  window.__menu = menu;
  let menuSignature = '';
  let gameRenderTime = 0;
  let arrivalSoundPlayed = false;

  function advanceStartup(code) {
    const action = startup.press(code);
    if (action === 'theme') {
      audio.playEvent('intro');
    } else if (action === 'stopTheme') {
      audio.stop();
    }
  }
  continueButton.addEventListener('click', () => {
    audio.unlock();
    if (menu.mode === 'paused') resumeGame();
    else if (startup.active) advanceStartup('Enter');
    else if (game.runEnded) acknowledgeGameOver();
    else if (game.victory?.canAdvance) advanceEnding();
  });
  canvas.addEventListener('click', () => {
    audio.unlock();
    if (startup.active) advanceStartup('Enter');
    else if (!menu.frozen && game.victory?.canAdvance) advanceEnding();
  });
  soundButton.addEventListener('click', () => {
    audio.setEnabled(!audio.enabled);
    audio.unlock();
  });
  pauseButton.addEventListener('click', pauseGame);
  scoresButton.addEventListener('click', () => {
    if (game.runEnded && !menu.finished) { acknowledgeGameOver(); return; }
    menu.showScores(game.practice ? 'practice' : 'normal');
    freezeInput();
  });
  quitButton.addEventListener('click', quitToTitle);
  scoreBoard.addEventListener('click', () => {
    menu.board = menu.board === 'normal' ? 'practice' : 'normal';
  });
  scoreClose.addEventListener('click', () => {
    if (menu.returnMode === 'gameOver') restartGame();
    else { menu.closeScores(); clearInput(); resetClock(); syncMenu(); }
  });
  scoreEntry.addEventListener('submit', event => {
    event.preventDefault();
    menu.submit(scoreName.value);
    syncMenu();
  });

  function syncMenu() {
    game.paused = menu.frozen;
    touchControls.setEnabled(presentation.touchEnabled && !startup.active && !menu.frozen
      && !game.runEnded && !game.victory?.active && !game.doorTransition && !game.deathTransition);
    const isScores = menu.mode === 'scores' || menu.mode === 'name';
    scoresPanel.hidden = !isScores;
    const signature = `${menu.mode}:${menu.board}:${menu.finished}:${scores.warning}`;
    if (signature === menuSignature) return;
    const previous = menuSignature.split(':')[0];
    menuSignature = signature;
    if (!isScores) {
      if (menu.mode === 'paused') continueButton.hidden = false;
      if (previous === 'scores' || previous === 'name') (menu.mode === 'paused' ? continueButton : pauseButton).focus();
      return;
    }
    scoreEntry.hidden = menu.mode !== 'name';
    scoreRows.hidden = menu.mode === 'name';
    scoreBoard.hidden = menu.mode === 'name';
    scoreClose.hidden = menu.mode === 'name';
    document.getElementById('scores-title').textContent = menu.board === 'practice' ? 'Practice high scores' : 'High scores';
    scoreBoard.textContent = menu.board === 'practice' ? 'Show normal scores' : 'Show practice scores';
    scoreClose.textContent = menu.returnMode === 'gameOver' ? 'New game' : 'Back';
    scoreStorage.textContent = scores.warning ? 'Storage unavailable or unreadable. Scores are kept for this tab only.' : 'Scores saved in this browser.';
    const rows = scores.entries(menu.board);
    scoreRows.replaceChildren(...Array.from({ length: SCORE_LIMIT }, (_, i) => {
      const li = document.createElement('li'), name = document.createElement('span'), points = document.createElement('span');
      name.className = 'score-name'; name.textContent = rows[i]?.name || '             ';
      points.textContent = String(rows[i]?.score ?? 0).padStart(8, '0');
      li.append(name, points); return li;
    }));
    if (menu.mode === 'name' && previous !== 'name') { scoreName.value = ''; scoreName.focus(); }
    else if (previous !== menu.mode) scoresPanel.focus();
  }

  function drawOpening(now) {
    syncMenu();
    const isScores = menu.mode === 'scores' || menu.mode === 'name';
    const text = startup.text;
    repoLink.hidden = !startup.active || isScores || menu.mode === 'paused';
    textPanel.hidden = isScores || !text;
    if (text && textCopy.textContent !== text) textCopy.textContent = text;
    hint.textContent = isScores ? (menu.mode === 'name' ? 'Enter a name to record your score' : 'Top ten · stored locally in this browser')
      : menu.mode === 'paused' ? 'Paused · Q: quit to title · Any other key / Continue: resume'
      : game.runEnded ? (menu.finished ? `${game.life.gameOver ? 'Game over' : 'Mission complete'} · Enter / New game to restart`
        : `${game.life.gameOver ? 'Game over' : 'Mission complete'} · Enter / High scores to continue`)
      : !startup.active && game.victory?.active ? (game.victory.stage === 'ending'
        ? (game.victory.canAdvance ? 'Mission complete · Press a key / Continue' : 'Mission complete…')
        : 'Treasures recovered · Returning home and tallying bonus…') : startup.hint;
    if (presentation.touchEnabled && !isScores) {
      hint.textContent = menu.mode === 'paused' ? 'Paused · Tap Continue'
        : startup.active ? (startup.canAdvance ? 'Tap Continue' : 'Please wait…')
        : game.runEnded ? (menu.finished ? 'Tap New game' : 'Tap High scores')
        : game.victory?.active ? (game.victory.canAdvance ? 'Mission complete · Continue' : 'Returning home…')
        : 'Move · Jump · Fire · Door · Wand';
    }
    const endingPage = !startup.active && game.victory?.stage === 'ending';
    continueButton.hidden = isScores || (!startup.active && !game.runEnded && !endingPage && menu.mode !== 'paused');
    continueButton.textContent = game.runEnded ? (menu.finished ? 'New game' : 'High scores') : 'Continue';
    continueButton.disabled = !game.runEnded && menu.mode !== 'paused' && !(endingPage && game.victory.canAdvance)
      && !startup.canAdvance;
    pauseButton.hidden = isScores || startup.active || game.runEnded || menu.mode === 'paused';
    scoresButton.hidden = isScores;
    quitButton.hidden = menu.mode !== 'paused';
    soundButton.hidden = isScores;
    fullscreenButton.hidden = isScores;
    touchButton.hidden = isScores;
    soundButton.textContent = audio.failed ? 'Sound unavailable' : `Sound: ${audio.enabled ? 'on' : 'off'}`;
    soundButton.setAttribute('aria-pressed', String(!audio.enabled));
    if (isScores) {
      ctx.drawImage(assets.sys.SYS005.img, 0, 0);
    } else if (!startup.active) {
      game.draw(ctx, gameRenderTime);
    } else if (startup.stage.screen) {
      ctx.drawImage(assets.paletteScreens[startup.stage.screen]?.[startup.paletteStep]
        ?? assets.sys[startup.stage.screen].img, 0, 0);
      if (startup.stage.id === 'planet') {
        const layout = assets.mechanics.lives.icons;
        drawLifeIcons(ctx, assets.sprites[layout.sprite], Math.min(5, Math.floor(startup.elapsedTicks)), layout);
      }
    } else if (startup.stage.id === 'arrival') {
      game.draw(ctx, now, { showPlayer: startup.arrivalPlayerVisible, showEnemies: false });
      const index = startup.arrivalFrame;
      if (index !== null) {
        if (!arrivalSoundPlayed) {
          audio.playEvent('teleport');
          arrivalSoundPlayed = true;
        }
        const effect = assets.sprites[startup.stage.effect];
        const p = game.player, sprite = assets.sprites.PLAYER;
        ctx.save();
        ctx.beginPath(); ctx.rect(PF.x, PF.y, PF.w, PF.h); ctx.clip();
        ctx.drawImage(effect.img, index * effect.w, 0, effect.w, effect.h,
          Math.round(PF.x + p.x + (p.w - sprite.w) / 2 - Math.round(game.camX)),
          Math.round(PF.y + p.y + p.h - sprite.h - Math.round(game.camY)), effect.w, effect.h);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  const keys = new Set();
  window.__keys = keys;
  let jumpPressed = false;
  let doorPressed = false;
  let teleportPressed = false;
  const touchControls = new TouchControls(document.getElementById('touch-controls'), {
    onGesture: () => audio.unlock(),
    onPress(code) {
      if (keys.has(code)) return;
      if (code === CONTROLS.jump) jumpPressed = true;
      if (code === 'AltLeft') doorPressed = true;
      if (code === 'CapsLock') teleportPressed = true;
    },
  });
  const presentation = new Presentation({
    shell: document.getElementById('game-shell'), fullscreenButton, touchButton,
    touchRoot: document.getElementById('touch-controls'), status: document.getElementById('presentation-status'),
    onResetInput: clearInput,
    onInterrupt() { clearInput(); pauseGame(); },
  });
  window.__touchControls = touchControls;
  window.__presentation = presentation;
  function clearInput() {
    keys.clear(); jumpPressed = false; doorPressed = false; teleportPressed = false;
    touchControls.clear();
    game.player.jumpQueued = false;
  }
  function resetClock() { acc = 0; last = performance.now(); }
  function freezeInput() { clearInput(); resetClock(); audio.stop(); syncMenu(); }
  function pauseGame() {
    if (startup.active || game.runEnded || !menu.pause()) return;
    freezeInput();
    continueButton.hidden = false;
    continueButton.disabled = false;
    continueButton.focus();
  }
  function resumeGame() {
    if (!menu.resume()) return;
    clearInput(); resetClock(); syncMenu();
    canvas.focus();
  }
  function quitToTitle() {
    if (menu.mode !== 'paused') return;
    restartGame();
    startup.index = 0; startup.elapsedTicks = 0; startup.textPage = null;
    arrivalSoundPlayed = false;
  }
  function acknowledgeGameOver() {
    if (menu.finished) restartGame();
    else { menu.finish(game.score, game.practice); freezeInput(); }
  }
  function advanceEnding() {
    if (game.victory?.advance()) { clearInput(); resetClock(); }
  }
  function restartGame() {
    audio.stop();
    game = new Game(assets, audio, testOptions);
    window.__game = game;
    menu.reset(); clearInput(); resetClock(); syncMenu();
    gameRenderTime = 0;
  }
  addEventListener('keydown', e => {
    if (e.code === 'Escape' && presentation.handleEscape()) {
      if (!presentation.nativeFullscreen) e.preventDefault();
      return;
    }
    if (menu.mode === 'name' || menu.mode === 'scores') {
      // Keep native typing/Enter for the form; never leak menu keys into gameplay.
      if (e.code === 'Tab') {
        const focusable = [...scoresPanel.querySelectorAll('input, button')].filter(el => !el.hidden && !el.closest('[hidden]'));
        const index = focusable.indexOf(document.activeElement);
        const next = e.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length;
        e.preventDefault(); focusable[next]?.focus();
      } else if (menu.mode === 'scores' && e.code === 'Escape') {
        e.preventDefault(); scoreClose.click();
      } else if (menu.mode === 'scores' && e.code === 'Enter' && e.target === scoresPanel) {
        e.preventDefault(); scoreClose.click();
      }
      return;
    }
    audio.unlock();
    if (e.code === 'F1' || e.code === 'F2') {
      e.preventDefault();
      audio.setEnabled(e.code === 'F1');
      audio.unlock();
      return;
    }
    if (e.target instanceof HTMLButtonElement && ['Enter', 'Space'].includes(e.code)) return;
    if (e.target instanceof HTMLAnchorElement && e.code === 'Enter') return;
    if (menu.mode === 'paused') {
      if (e.code === 'Tab') return;
      e.preventDefault();
      if (!e.repeat) { if (e.code === 'KeyQ') quitToTitle(); else resumeGame(); }
      return;
    }
    if (startup.active) {
      if (e.code === 'Tab') return; // Reach the repository link and footer controls.
      e.preventDefault();
      if (!e.repeat) advanceStartup(e.code);
      return;
    }
    if (game.runEnded) {
      e.preventDefault();
      if (!e.repeat) acknowledgeGameOver();
      return;
    }
    if (e.code === 'Escape') { e.preventDefault(); if (!e.repeat) pauseGame(); return; }
    if (game.victory?.active) {
      e.preventDefault();
      if (!e.repeat && game.victory.canAdvance) advanceEnding();
      return;
    }
    preventGameplayKeyDefault(e);
    if (e.repeat && !keys.has(e.code)) return; // Held keys cleared by pause need a fresh press.
    const held = keys.has(e.code) || touchControls.has(e.code);
    if (e.code === CONTROLS.jump && !held) jumpPressed = true;
    if (['AltLeft', 'AltRight'].includes(e.code) && !held) doorPressed = true;
    if (e.code === 'CapsLock' && !held && !e.repeat) teleportPressed = true;
    keys.add(e.code);
    if (e.code === 'Digit1') { game.practice = true; game.loadStrip(0); }
    if (e.code === 'Digit2') { game.practice = true; game.loadStrip(1); }
    if (e.code === 'Digit3') { game.practice = true; game.loadStrip(2); }
    if (e.code === 'BracketLeft') { game.practice = true; game.switchArea(-1); }
    if (e.code === 'BracketRight') { game.practice = true; game.switchArea(1); }
    if (e.code === 'Backquote') game.showDebug = !game.showDebug;
  });
  addEventListener('keyup', e => {
    if (menu.mode !== 'name' && menu.mode !== 'scores') preventGameplayKeyDefault(e);
    keys.delete(e.code);
  });
  addEventListener('blur', () => { clearInput(); pauseGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); pauseGame(); } });

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.25));
    last = now;
    acc += dt;
    while (acc >= STEP) {
      if (menu.frozen) { /* Discard elapsed time: never catch up after Continue. */ }
      else if (startup.active) startup.step(STEP);
      else {
        gameRenderTime += STEP * 1000;
        game.step(gameplayInput(keys, {
        jumpPressed,
        doorPressed,
        teleportPressed,
        }, touchControls));
      }
      jumpPressed = false;
      doorPressed = false;
      teleportPressed = false;
      acc -= STEP;
    }
    drawOpening(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') main().catch(err => {
  const message = document.createElement('pre');
  message.className = 'load-error';
  message.textContent = `ASSET LOAD ERROR\n\n${err.stack || err}`;
  document.body.replaceChildren(message);
});
