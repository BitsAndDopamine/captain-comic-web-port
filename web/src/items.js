// Remaining tool abilities recovered from the unpacked COMIC.EXE.
const byte = n => n & 255;
const signed = n => (n & 128) ? (n & 255) - 256 : n & 255;

export function terrainIsDark(area, inventory, config) {
  return area === config.area && !inventory.has(config.requiredItem);
}

export function spritePosition(player, sprite) {
  return { x: player.x + (player.w - sprite.w) / 2, y: player.y + player.h - sprite.h };
}

export function placeSprite(player, sprite, position) {
  player.x = position.x + (sprite.w - player.w) / 2;
  player.y = position.y + sprite.h - player.h;
}

export function wandDestination(world, player, camera, config) {
  const from = { xUnits: player.xUnits, yUnits: player.yUnits };
  let x = player.xUnits, offset = byte(x - camera), shift = 0;
  const direction = player.facing > 0 ? 1 : -1;
  let search = true;
  if (direction < 0) {
    if (offset < config.distanceUnits) search = false;
    else {
      x = byte(x - config.distanceUnits);
      offset -= config.distanceUnits;
      if (offset < 10) shift = Math.min(camera, 10 - offset);
    }
  } else if (offset >= 17) search = false;
  else {
    x = byte(x + config.distanceUnits);
    offset = byte(offset + config.distanceUnits - 12);
    if (signed(offset) > 0) {
      const next = byte(camera + offset);
      // Original 0x12e9 is signed JLE, including its low-camera wrap quirk.
      shift = signed(next) <= signed(232) ? offset : byte(offset - byte(next - 232));
    }
  }
  let to = { ...from };
  if (search) {
    x &= 254;
    let y = config.searchStartYUnits;
    let clearance = 0, foundSurface = false;
    const tile = (cx, cy) => world.tile(cx, cy);
    while (y >= 0) {
      if (tile(x >> 1, y >> 1)) { foundSurface = true; clearance = 0; }
      else if (foundSurface && ++clearance === 2) { to = { xUnits: x, yUnits: y }; break; }
      y -= 2;
      if (!foundSurface && y === 0) break;
    }
  }
  return { from, to, shift, direction };
}

export function wandEffectFrames(phase, config) {
  return {
    origin: phase < config.effectFrames ? phase : null,
    destination: phase > 0 ? phase - 1 : null,
    atDestination: phase >= config.relocateAtTick,
  };
}

export function drawWandEffects(ctx, sprite, transition, pf, cameraX, config) {
  if (transition.renderPhase === null) return;
  const frames = wandEffectFrames(transition.renderPhase, config);
  for (const [position, frame] of [[transition.from, frames.origin], [transition.to, frames.destination]]) {
    if (frame === null) continue;
    const sourceFrame = sprite.animation[frame];
    ctx.drawImage(sprite.img, sourceFrame * sprite.w, 0, sprite.w, sprite.h,
      Math.round(pf.x + position.xUnits * 8 - cameraX), pf.y + position.yUnits * 8,
      sprite.w, sprite.h);
  }
}
