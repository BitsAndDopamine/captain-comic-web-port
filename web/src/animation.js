// Presentation only. Neither class owns or changes any gameplay clock.
export const ANIMATION_STORAGE_KEY = 'captain-comic.animation.v1';

export class AnimationMode {
  constructor(storage = null) {
    this.storage = storage; this.mode = 'original'; this.warning = !storage;
    this.drawCount = 0; this.invalidate();
    try {
      const saved = storage?.getItem(ANIMATION_STORAGE_KEY);
      if (saved !== null && saved !== undefined) {
        if (!['original', '30fps'].includes(saved)) throw Error('Invalid animation mode');
        this.mode = saved;
      }
    } catch { this.warning = true; }
  }
  get smooth() { return this.mode === '30fps'; }
  set(mode) {
    if (!['original', '30fps'].includes(mode)) return false;
    this.mode = mode; this.invalidate();
    try {
      if (!this.storage) throw Error('Storage unavailable');
      this.storage.setItem(ANIMATION_STORAGE_KEY, mode); this.warning = false;
    } catch { this.warning = true; }
    return true;
  }
  toggle() { this.set(this.smooth ? 'original' : '30fps'); }
  invalidate() { this.nextDraw = null; this.lastNow = null; }
  shouldDraw(now) {
    if (!Number.isFinite(now)) return false;
    const interval = 1000 / 30;
    if (!this.smooth) { this.drawCount++; return true; }
    if (this.nextDraw === null || now < this.lastNow) this.nextDraw = now;
    this.lastNow = now;
    if (now + 0.01 < this.nextDraw) return false;
    this.nextDraw += Math.max(1, Math.floor((now - this.nextDraw + 0.01) / interval) + 1) * interval;
    this.drawCount++; return true;
  }
}

const phase = game => game.doorTransition ? `door:${game.doorTransition.stage}`
  : game.deathTransition ? `death:${game.deathTransition.stage}`
  : game.victory?.active ? `victory:${game.victory.stage}` : 'play';
const point = object => ({ x: object.x, y: object.y });
const blend = (a, b, alpha) => a + (b - a) * alpha;
const pose = (object, before, alpha, x = 'x', y = 'y', maxStep = 32) => {
  if (!before || Math.abs(object[x] - before[x]) > maxStep || Math.abs(object[y] - before[y]) > maxStep) return object;
  // A view inherits sprite frames/methods, but never writes to the game object.
  return Object.assign(Object.create(object), {
    [x]: blend(before[x], object[x], alpha), [y]: blend(before[y], object[y], alpha),
  });
};

export class VisualTimeline {
  constructor() { this.enabled = false; this.reset(); }
  reset() { this.previous = null; this.lastAlpha = 1; }
  capture(game) {
    if (!this.enabled) return;
    this.previous = {
      world: game.world, phase: phase(game), playerObject: game.player,
      camX: game.camX, camY: game.camY, player: point(game.player),
      enemies: new Map(game.enemies.map(enemy => [enemy, {
        xUnits: enemy.xUnits, yUnits: enemy.yUnits, state: enemy.state,
      }])),
      fireballs: new Map(game.fireballs.map(shot => [shot, point(shot)])),
    };
  }
  rememberFireball(shot) {
    if (this.enabled) this.previous?.fireballs.set(shot, point(shot));
  }
  sample(game, fraction) {
    const current = { camX: game.camX, camY: game.camY,
      player: game.player, enemies: game.enemies, fireballs: game.fireballs };
    const previous = this.previous;
    if (!this.enabled) return current;
    if (!previous || previous.world !== game.world || previous.playerObject !== game.player || previous.phase !== phase(game)) {
      this.reset(); return current;
    }
    const alpha = game.paused ? this.lastAlpha : Math.max(0, Math.min(1, fraction));
    this.lastAlpha = alpha;
    return {
      camX: Math.abs(previous.camX - game.camX) <= 32 ? blend(previous.camX, game.camX, alpha) : game.camX,
      camY: Math.abs(previous.camY - game.camY) <= 32 ? blend(previous.camY, game.camY, alpha) : game.camY,
      player: pose(game.player, previous.player, alpha),
      enemies: game.enemies.map(enemy => {
        const before = previous.enemies.get(enemy);
        // Do not slide new/recycled enemies across the map or move a killed
        // enemy back toward its pre-hit position.
        return before?.state === 1 && enemy.state === 1
          ? pose(enemy, before, alpha, 'xUnits', 'yUnits', 4) : enemy;
      }),
      fireballs: game.fireballs.map(shot => pose(shot, previous.fireballs.get(shot), alpha)),
    };
  }
}
