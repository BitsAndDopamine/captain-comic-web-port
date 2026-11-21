// Historical hand-placed enemy data, no longer imported by the game.
// Runtime spawning/AI now uses world.json + enemies.js. Retained for reference.
// types: enemy sprite base names (as in areas.json)

export const SPAWNS = {
  FOREST: {
    0: {
      enemies: [
        { type: 'bird', x: 420, y: 40, vx: 0.7 },
        { type: 'bird2', x: 700, y: 126, vx: -0.6 },
        { type: 'bird', x: 1150, y: 45, vx: 0.8 },
        { type: 'bug', x: 1560, y: 128, vx: 0.5, ground: true },
      ],
    },
    1: {
      enemies: [{ type: 'bird2', x: 500, y: 60, vx: 0.7 }, { type: 'bug', x: 1200, y: 128, vx: -0.5, ground: true }],
    },
    2: {
      enemies: [{ type: 'bird', x: 700, y: 50, vx: -0.7 }],
    },
  },
};

export function spawnsFor(area, strip) {
  return (SPAWNS[area] && SPAWNS[area][strip]) || { enemies: [] };
}
