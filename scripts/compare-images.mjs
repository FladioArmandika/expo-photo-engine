// Compares two PNG exports of the same EditStack (e.g. iOS vs Android) and writes a diff map.
//
//   node scripts/compare-images.mjs ios.png android.png [diff.png]
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [a, b, diffPath = 'diff.png'] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: node scripts/compare-images.mjs ios.png android.png [diff.png]');
  process.exit(2);
}
const ia = PNG.sync.read(readFileSync(a));
const ib = PNG.sync.read(readFileSync(b));
if (ia.width !== ib.width || ia.height !== ib.height) {
  console.error(`size mismatch: ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`);
  process.exit(1);
}

const diff = new PNG({ width: ia.width, height: ia.height });
const histogram = new Array(256).fill(0);
let sum = 0;
let max = 0;
for (let i = 0; i < ia.data.length; i += 4) {
  let d = 0;
  for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(ia.data[i + c] - ib.data[i + c]));
  histogram[d]++;
  sum += d;
  max = Math.max(max, d);
  // Black = identical; brighter = larger difference (x16 so 1/255 is visible).
  const v = Math.min(255, d * 16);
  diff.data.set([v, v, v, 255], i);
}
writeFileSync(diffPath, PNG.sync.write(diff));

const pixels = ia.width * ia.height;
const over = (t) => histogram.slice(t + 1).reduce((s, n) => s + n, 0);
const pct = (n) => ((n / pixels) * 100).toFixed(3) + '%';
console.log(`${ia.width}x${ia.height}, per-pixel max channel difference (0-255):`);
console.log(`  mean ${(sum / pixels).toFixed(4)}   max ${max}`);
console.log(
  `  >0: ${pct(over(0))}   >1: ${pct(over(1))}   >2: ${pct(over(2))}   >4: ${pct(over(4))}`
);
console.log(`  diff map written to ${diffPath}`);
// Target for v1 parity: no pixel more than 2 levels apart.
process.exit(max <= 2 ? 0 : 1);
