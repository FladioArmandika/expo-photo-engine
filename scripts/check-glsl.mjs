// Checks the shader math two ways:
//
// 1. The SHARED ADJUSTMENTS block must be identical in ios/Shaders.swift and
//    android/.../Shaders.kt, so both platforms run the same code.
// 2. The Android GLSL shader (copied verbatim from Shaders.kt) runs in headless Chromium's WebGL2
//    (GLSL ES 3.00, the same language as GLES 3.0) on a test image, once per adjustment setting,
//    and every pixel is compared with a float64 JavaScript copy of the same math.
//
//   node scripts/check-glsl.mjs   (needs `playwright-core` and a Chromium)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const kotlin = read('android/src/main/java/expo/modules/photoengine/Shaders.kt');
const swift = read('ios/Shaders.swift');

const sharedBlock = (source, file) => {
  const match = source.match(/\/\/ BEGIN SHARED ADJUSTMENTS[\s\S]*?\/\/ END SHARED ADJUSTMENTS/);
  if (!match) throw new Error(`SHARED ADJUSTMENTS block not found in ${file}`);
  return match[0];
};
if (sharedBlock(kotlin, 'Shaders.kt') !== sharedBlock(swift, 'Shaders.swift')) {
  console.error('The SHARED ADJUSTMENTS blocks in Shaders.kt and Shaders.swift differ.');
  process.exit(1);
}
console.log('Shared adjustment block is identical on iOS and Android.');

const [vertex, fragment] = [...kotlin.matchAll(/"""([\s\S]*?)"""/g)].map((m) => m[1]);

// ---- float64 reference, line for line with applyAdjustments ----

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'saturation', 'vibrance', 'warmth', 'tint', 'sharpness', 'vignette'];

function applyAdjustments(srgb, blur, uv, aspect, a) {
  let c = srgb.map((v, i) => clamp01(v + (v - blur[i]) * (a.sharpness * 2)));

  const balance = [
    0.25 * a.warmth + 0.1 * a.tint,
    -0.2 * a.tint,
    0.1 * a.tint - 0.25 * a.warmth,
  ];
  const fx = (uv[0] - 0.5) * aspect;
  const fy = uv[1] - 0.5;
  const radius = Math.hypot(fx, fy) / Math.hypot(aspect * 0.5, 0.5);
  const vignette = 2 ** (a.vignette * 2 * smoothstep(0.35, 1, radius));
  c = c.map((v, i) => linearToSrgb(clamp01(srgbToLinear(v) * 2 ** (balance[i] + a.exposure) * vignette)));

  let luma = lumaOf(c);
  const dark = 1 - luma;
  const toneScale = 1 + 0.9 * (a.shadows * dark * dark + a.highlights * luma * dark);
  c = c.map((v) => clamp01(v * toneScale));

  c = c.map((v) => {
    const curve = a.contrast >= 0 ? v * v * (3 - 2 * v) : 0.5 + (v - 0.5) * 0.5;
    return v + (curve - v) * Math.abs(a.contrast);
  });

  luma = lumaOf(c);
  c = c.map((v) => luma + (v - luma) * (1 + a.saturation));
  const chroma = clamp01(Math.max(...c) - Math.min(...c));
  c = c.map((v) => luma + (v - luma) * (1 + a.vibrance * (1 - chroma)));
  return c.map(clamp01);
}

// ---- test image: smooth gradients plus pseudo-random colors, wider than tall ----

const W = 48;
const H = 32;
const image = new Uint8Array(W * H * 4);
let seed = 12345;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const px =
      y < 8
        ? [x * 5, x * 5, x * 5] // gray ramp
        : y < 16
          ? [x * 5, 255 - x * 5, (x * 11) % 256] // color ramp
          : [random() * 255, random() * 255, random() * 255].map(Math.round);
    image.set([...px, 255], i);
  }
}
const texel = (x, y) => {
  const cx = Math.min(W - 1, Math.max(0, x));
  const cy = Math.min(H - 1, Math.max(0, y));
  const i = (cy * W + cx) * 4;
  return [image[i] / 255, image[i + 1] / 255, image[i + 2] / 255];
};

const cases = [
  { name: 'neutral' },
  ...[-3, -1, -0.4, 0.4, 1, 3].map((v) => ({ name: `exposure ${v}`, exposure: v })),
  ...KEYS.filter((k) => k !== 'exposure' && k !== 'sharpness').flatMap((key) =>
    [-1, -0.5, 0.5, 1].map((v) => ({ name: `${key} ${v}`, [key]: v }))
  ),
  ...[0.3, 1].map((v) => ({ name: `sharpness ${v}`, sharpness: v })),
  {
    name: 'everything',
    exposure: 0.3, contrast: 0.25, highlights: -0.6, shadows: 0.5, saturation: 0.15,
    vibrance: 0.3, warmth: 0.2, tint: -0.1, sharpness: 0.4, vignette: -0.35,
  },
].map((c) => ({ ...Object.fromEntries(KEYS.map((k) => [k, 0])), ...c }));

const pack = (a) => [
  a.exposure, a.contrast, a.highlights, a.shadows,
  a.saturation, a.vibrance, a.warmth, a.tint,
  a.sharpness, a.vignette, 0, 0,
];

// ---- run on the GPU ----

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const results = await page.evaluate(
  ({ vertex, fragment, image, W, H, params }) => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('no webgl2');
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.bindVertexArray(gl.createVertexArray());

    // Same texture setup as the export path: nearest sampling, clamped edges, 1:1 output.
    const input = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(image));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const output = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, output);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);
    // Flipped like the export path, so output row y is input row y.
    gl.uniform4f(gl.getUniformLocation(program, 'uVParams'), 1, 1, 1, 0);
    gl.viewport(0, 0, W, H);

    const out = [];
    for (const p of params) {
      gl.uniform4fv(gl.getUniformLocation(program, 'uParams'), new Float32Array(p));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push(Array.from(px));
    }
    return { out, renderer: gl.getParameter(gl.RENDERER) };
  },
  { vertex, fragment, image: Array.from(image), W, H, params: cases.map(pack) }
);
await browser.close();

console.log(`GPU: ${results.renderer}`);
let worst = 0;
cases.forEach((a, n) => {
  const got = results.out[n];
  let maxDiff = 0;
  let off = 0;
  let changed = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const center = texel(x, y);
      const blur = [0, 1, 2].map(
        (ch) => (texel(x + 1, y)[ch] + texel(x - 1, y)[ch] + texel(x, y + 1)[ch] + texel(x, y - 1)[ch]) / 4
      );
      const uv = [(x + 0.5) / W, (y + 0.5) / H];
      const expected = applyAdjustments(center, blur, uv, W / H, a);
      for (let ch = 0; ch < 3; ch++) {
        const g = got[(y * W + x) * 4 + ch];
        const e = Math.round(expected[ch] * 255);
        const d = Math.abs(g - e);
        maxDiff = Math.max(maxDiff, d);
        if (d > 0) off++;
        if (g !== image[(y * W + x) * 4 + ch]) changed++;
      }
    }
  }
  worst = Math.max(worst, maxDiff);
  const total = W * H * 3;
  console.log(
    `${a.name.padEnd(16)} max |GPU - reference| = ${maxDiff}/255, off: ${String(off).padStart(4)}/${total}, changed by the edit: ${changed}/${total}`
  );
  // A non-neutral setting that changes nothing means the uniform never reached the shader.
  if (a.name !== 'neutral' && changed === 0) {
    console.error(`  ${a.name} had no effect`);
    worst = Infinity;
  }
});
process.exit(worst <= 1 ? 0 : 1);
