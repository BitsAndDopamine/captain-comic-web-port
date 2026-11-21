// Door records use original sprite top-left coordinates, not the web hitbox.

export function doorAtPlayer(player, sprite, doors, hasKey) {
  if (!hasKey) return null;
  const x = player.x + (player.w - sprite.w) / 2;
  const y = player.y + player.h - sprite.h;
  // Tiny tolerance avoids floor(95.999999 / 8) at an otherwise exact landing.
  const xUnits = Math.floor((x + 0.001) / 8);
  const yUnits = Math.floor((y + 0.001) / 8);
  return doors.find(door => door.yUnits === yUnits
    && xUnits >= door.xUnits && xUnits < door.xUnits + 3) ?? null;
}

export function doorArrival(player, sprite, door) {
  // DOS arrival is one horizontal unit right of the reciprocal door.
  return {
    x: (door.xUnits + 1) * 8 + (sprite.w - player.w) / 2,
    y: door.yUnits * 8 + sprite.h - player.h,
  };
}

export function doorAnimationFrame(transition, config) {
  let ticks = transition.elapsedTicks;
  for (const frame of config[transition.stage]) {
    if (ticks < frame.ticks) return frame;
    ticks -= frame.ticks;
  }
  return null;
}

export function drawDoorOpening(ctx, tiles, tileIds, door, frame, pf, camX, camY) {
  if (!frame.opening) return;
  const x = Math.round(pf.x + door.x - camX);
  const y = Math.round(pf.y + door.y - camY);
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, 32, 32);
  if (!frame.shutters) return;
  // EXE 0x1179: second half of tiles 0/2 on the left, first half of 1/3 on
  // the right. These are area-specific door graphics, not the teleport effect.
  for (let i = 0; i < 4; i++) {
    const id = tileIds[i];
    const right = i % 2;
    ctx.drawImage(tiles.img, (id % tiles.cols) * 16 + (1 - right) * 8,
      Math.floor(id / tiles.cols) * 16, 8, 16,
      x + right * 24, y + Math.floor(i / 2) * 16, 8, 16);
  }
}
