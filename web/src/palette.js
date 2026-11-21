// BIOS mode 0Dh is 200-line RGBI-compatible output, not 350-line six-bit RGB.
// Bits 3/5 alias; bit 4 adds common intensity. Non-intense yellow becomes brown.
export function egaMode0dColor(value) {
  const intensity = value & 16 ? 85 : 0;
  const rgb = [(value & 4 ? 170 : 0) + intensity,
    (value & 2 ? 170 : 0) + intensity,
    (value & 1 ? 170 : 0) + intensity];
  if ((value & 23) === 6) rgb[1] = 85;
  return rgb;
}

export function recolorPalette(pixels, palette, indices, registers) {
  const output = new Uint8ClampedArray(pixels);
  const colors = registers.map(egaMode0dColor);
  for (let i = 0; i < output.length; i += 4) {
    const index = indices.findIndex(index => palette[index].every((value, n) => value === pixels[i + n]));
    if (index >= 0) output.set(colors[index], i);
  }
  return output;
}

// Cache each reveal once at load time. No per-frame readbacks, CSS filters or
// scaling/subpixel changes; every image still blits onto the same integer grid.
export function createPaletteScreens(image, palette, reveal) {
  const source = document.createElement('canvas'); source.width = 320; source.height = 200;
  const ctx = source.getContext('2d'); ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, 320, 200).data;
  return reveal.steps.map(registers => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext('2d'), frame = ctx.createImageData(320, 200);
    frame.data.set(recolorPalette(pixels, palette, reveal.indices, registers));
    ctx.putImageData(frame, 0, 0); return canvas;
  });
}
