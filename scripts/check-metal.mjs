// Compiles the Metal source embedded in ios/Shaders.swift with Apple's offline compiler, so shader
// syntax errors fail CI instead of at runtime on a device. macOS with Xcode only.
//
//   node scripts/check-metal.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const swift = readFileSync(new URL('../ios/Shaders.swift', import.meta.url), 'utf8');
const match = swift.match(/"""\n([\s\S]*?)"""/);
if (!match) throw new Error('Metal source not found in ios/Shaders.swift');

const dir = mkdtempSync(join(tmpdir(), 'metal-'));
const source = join(dir, 'Shaders.metal');
writeFileSync(source, match[1]);
// -fno-fast-math matches the runtime compile options (MTLMathMode.safe).
execFileSync(
  'xcrun',
  ['-sdk', 'iphoneos', 'metal', '-fno-fast-math', '-c', source, '-o', join(dir, 'Shaders.air')],
  {
    stdio: 'inherit',
  }
);
console.log('Metal shaders compiled OK');
