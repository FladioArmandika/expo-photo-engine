// Compares the golden-image exports from the iOS simulator and the Android emulator, case by case.
// Fails if a case is missing on either side, the sizes differ, or any pixel is more than
// MAX_DIFF levels (out of 255) apart in any channel. Writes a diff map per case to <diffDir>
// and a Markdown table to $GITHUB_STEP_SUMMARY when it is set.
//
//   node scripts/golden-compare.mjs <iosDir> <androidDir> [diffDir=golden-diff]
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

// Straightened crops are sampled between pixels, and GPUs filter at slightly different precision.
const MAX_DIFF = 2;

const [iosDir, androidDir, diffDir = 'golden-diff'] = process.argv.slice(2);
if (!iosDir || !androidDir) {
  console.error('usage: node scripts/golden-compare.mjs <iosDir> <androidDir> [diffDir]');
  process.exit(2);
}
mkdirSync(diffDir, { recursive: true });

const pngs = (dir) => new Set(readdirSync(dir).filter((f) => f.endsWith('.png')));
const ios = pngs(iosDir);
const android = pngs(androidDir);
const names = [...new Set([...ios, ...android])].sort();

let failed = false;
const rows = [];
for (const file of names) {
  const name = file.replace(/\.png$/, '');
  if (!ios.has(file) || !android.has(file)) {
    rows.push([name, '-', '-', '-', `missing on ${ios.has(file) ? 'Android' : 'iOS'}`]);
    failed = true;
    continue;
  }
  const a = PNG.sync.read(readFileSync(join(iosDir, file)));
  const b = PNG.sync.read(readFileSync(join(androidDir, file)));
  if (a.width !== b.width || a.height !== b.height) {
    rows.push([name, `${a.width}x${a.height} vs ${b.width}x${b.height}`, '-', '-', 'size differs']);
    failed = true;
    continue;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  let max = 0;
  let off = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
    max = Math.max(max, d);
    if (d > 0) off++;
    // Black = identical; brighter = bigger difference (x32 so 1/255 is visible).
    const v = Math.min(255, d * 32);
    diff.data.set([v, v, v, 255], i);
  }
  writeFileSync(join(diffDir, file), PNG.sync.write(diff));
  const pixels = a.width * a.height;
  const ok = max <= MAX_DIFF;
  if (!ok) failed = true;
  rows.push([
    name,
    `${a.width}x${a.height}`,
    `${max}/255`,
    `${((off / pixels) * 100).toFixed(2)}%`,
    ok ? 'ok' : `over ${MAX_DIFF}/255`,
  ]);
}

const header = ['Case', 'Size', 'Max difference', 'Pixels not identical', 'Result'];
const table = [header, header.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## iOS vs Android golden images\n\nSame photo and edits exported on both. Limit: ${MAX_DIFF}/255 per channel.\n\n${table}\n`
  );
}
if (names.length === 0) {
  console.error('no images found');
  failed = true;
}
process.exit(failed ? 1 : 0);
