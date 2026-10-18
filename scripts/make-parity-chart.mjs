// Generates example/assets/parity-chart.png: gray ramps, RGB ramps and saturated patches.
// A synthetic PNG removes JPEG decoder differences, so a parity diff shows shader differences only.
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const width = 2048;
const height = 1536;
const png = new PNG({ width, height });
const bands = [
  (t) => [t, t, t],
  (t) => [t, 0, 0],
  (t) => [0, t, 0],
  (t) => [0, 0, t],
  (t) => [t, t * 0.8, t * 0.6], // skin-ish
  (t) => [t * 0.3, t * 0.6, t], // sky-ish
];
const patches = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
  [255, 255, 255],
  [128, 128, 128],
  [0, 0, 0],
  [230, 160, 120],
  [90, 140, 200],
  [40, 90, 40],
];
const bandHeight = 192;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    let rgb;
    if (y < bands.length * bandHeight) {
      // Each band steps through all 256 levels, 8px per level.
      rgb = bands[Math.floor(y / bandHeight)](Math.floor((x / width) * 256));
    } else {
      rgb = patches[Math.floor((x / width) * patches.length)];
    }
    png.data.set([...rgb.map((v) => Math.round(v)), 255], (y * width + x) * 4);
  }
}
const out = new URL('../example/assets/parity-chart.png', import.meta.url);
writeFileSync(out, PNG.sync.write(png));
console.log(`wrote ${out.pathname}`);
