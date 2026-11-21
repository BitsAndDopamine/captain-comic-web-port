// Opt-in local testing setup. Query strings are data, never executable code.
const TOOLS = ['key', 'boots', 'wand', 'lantern', 'corkscrew'];
const INVENTORY = new Set([...TOOLS, 'gems', 'crown', 'gold']);

export function parseTestOptions(search, mechanics) {
  const params = new URLSearchParams(search);
  const requested = new Set(params.getAll('items').flatMap(value =>
    value.split(',').map(item => item.trim().toLowerCase())).filter(Boolean));
  const items = new Set();
  for (const item of requested) {
    if (item === 'all') for (const tool of TOOLS) items.add(tool);
    else if (INVENTORY.has(item)) items.add(item);
  }
  const number = (name, max, fallback) => {
    const value = params.get(name)?.trim();
    if (!value || !/^-?\d+$/.test(value)) return fallback;
    const n = Number(value);
    return Number.isSafeInteger(n) ? Math.max(0, Math.min(max, n)) : fallback;
  };
  const colas = number('colas', mechanics.fireball.maxCapacity, requested.has('cola') ? 1 : null);
  return {
    items: [...items], colas,
    weapon: number('weapon', mechanics.fireball.maxEnergy, colas > 0 ? mechanics.fireball.maxEnergy : null),
    shield: number('shield', mechanics.lives.shieldCap, requested.has('shield') ? mechanics.lives.shieldCap : null),
    skipIntro: ['1', 'true'].includes(params.get('skipIntro')?.trim().toLowerCase()),
  };
}

export function applyTestOptions(game, options) {
  if (!options) return;
  for (const item of options.items) game.inventory.add(item);
  if (options.colas !== null) game.colas = options.colas;
  if (options.weapon !== null) game.weapon = options.weapon;
  if (options.shield !== null) {
    game.shield = options.shield;
    game.life.refillTicks = 0; // Do not refill over an explicit test shield or award refill points.
  }
}
