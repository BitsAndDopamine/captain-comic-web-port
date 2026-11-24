// TT2 tiles are opaque, including tile 0 (which is not an empty-cell sentinel).
// The DOS camera stops at 1856px, but the web HUD window is 196px wide: its
// final 4px would extend past a 2048px strip. Clamp rendering, not simulation.
export const renderCameraX = (cameraX, worldWidth, viewWidth) =>
  Math.max(0, Math.min(Math.round(cameraX), Math.max(0, worldWidth - viewWidth)));

export function drawTilemap(ctx, world, pf, camX, camY) {
  // Adjacent atlas blits must share an integer pixel grid. Subpixel destinations
  // can expose tile-edge seams depending on the browser's canvas/GPU backend.
  camX = renderCameraX(camX, world.w * 16, pf.w);
  camY = Math.round(camY);
  const ts = 16;
  const c0 = Math.max(0, Math.floor(camX / ts));
  const c1 = Math.min(world.w - 1, Math.ceil((camX + pf.w) / ts));
  for (let r = 0; r < world.h; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = world.strip[r * world.w + c];
      const sx = (t % world.tiles.cols) * ts;
      const sy = Math.floor(t / world.tiles.cols) * ts;
      ctx.drawImage(world.tiles.img, sx, sy, ts, ts,
        pf.x + c * ts - camX, pf.y + r * ts - camY, ts, ts);
    }
  }
}
