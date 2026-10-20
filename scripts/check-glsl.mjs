// Checks the shader math two ways:
//
// 1. The SHARED GEOMETRY and SHARED ADJUSTMENTS blocks must be identical in ios/Shaders.swift and
//    android/.../Shaders.kt, so both platforms run the same code.
// 2. The Android GLSL shaders (copied verbatim from Shaders.kt) run in headless Chromium's WebGL2
//    (GLSL ES 3.00, the same language as GLES 3.0) on a test image, once per setting (adjustments,
//    crops and every built-in filter), and every pixel is compared with a float64 JavaScript copy
//    of the same math.
//
//   node scripts/check-glsl.mjs   (needs `playwright-core` and a Chromium)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

// The filter catalog is TypeScript; Node strips the types itself. Silence its notice about that.
process.removeAllListeners('warning');
const { BUILT_IN_FILTERS } = await import('../src/filters/catalog.ts');
const { packLook } = await import('../src/filters/looks.ts');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const kotlin = read('android/src/main/java/expo/modules/photoengine/Shaders.kt');
const swift = read('ios/Shaders.swift');

const sharedBlock = (source, file, name) => {
  const match = source.match(new RegExp(`// BEGIN SHARED ${name}[\\s\\S]*?// END SHARED ${name}`));
  if (!match) throw new Error(`SHARED ${name} block not found in ${file}`);
  return match[0];
};
for (const name of ['GEOMETRY', 'ADJUSTMENTS']) {
  if (sharedBlock(kotlin, 'Shaders.kt', name) !== sharedBlock(swift, 'Shaders.swift', name)) {
    console.error(`The SHARED ${name} blocks in Shaders.kt and Shaders.swift differ.`);
    process.exit(1);
  }
  console.log(`Shared ${name.toLowerCase()} block is identical on iOS and Android.`);
}

const [vertex, fragment] = [...kotlin.matchAll(/"""([\s\S]*?)"""/g)].map((m) => m[1]);

// ---- float64 reference, line for line with cropToSource and applyAdjustments ----

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'saturation', 'vibrance', 'warmth', 'tint', 'sharpness', 'vignette'];

const rotateClockwise = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

function zoomToFit(corner, center, size) {
  const room = [0, 1].map((i) => Math.max(size[i] - center[i], 0.000001));
  const before = [0, 1].map((i) => Math.max(center[i], 0.000001));
  return Math.max(corner[0] / room[0], -corner[0] / before[0], corner[1] / room[1], -corner[1] / before[1]);
}

function cropToSource(outUv, crop, srcAspect) {
  const { rect, turns, straighten, flipH, flipV } = crop;
  const angle = (straighten * Math.PI) / 180;
  const size = turns % 2 === 1 ? [1, srcAspect] : [srcAspect, 1];
  const center = [(rect[0] + rect[2] / 2) * size[0], (rect[1] + rect[3] / 2) * size[1]];
  const half = [(rect[2] / 2) * size[0], (rect[3] / 2) * size[1]];
  let zoom = 1;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    zoom = Math.max(zoom, zoomToFit(rotateClockwise([sx * half[0], sy * half[1]], -angle), center, size));
  }
  const offset = [(outUv[0] - 0.5) * rect[2] * size[0], (outUv[1] - 0.5) * rect[3] * size[1]];
  const r = rotateClockwise(offset, -angle);
  const q = [center[0] + r[0] / zoom, center[1] + r[1] / zoom];
  if (flipH) q[0] = size[0] - q[0];
  if (flipV) q[1] = size[1] - q[1];
  let p = q;
  if (turns === 1) p = [q[1], 1 - q[0]];
  if (turns === 2) p = [srcAspect - q[0], 1 - q[1]];
  if (turns === 3) p = [srcAspect - q[1], q[0]];
  return [p[0] / srcAspect, p[1]];
}

function outputSize(crop, w, h) {
  const [tw, th] = crop.turns % 2 === 1 ? [h, w] : [w, h];
  return [Math.max(1, Math.round(tw * crop.rect[2])), Math.max(1, Math.round(th * crop.rect[3]))];
}

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

function applyFilter(c, f) {
  const row = (n) => f.slice(n * 4, n * 4 + 3);
  const [intensity, saturation, contrast] = [f[3], f[7], f[11]];
  const [slope, offset, power, shadowTint, highlightTint] = [3, 4, 5, 6, 7].map(row);
  let m = [0, 1, 2].map((ch) => row(ch).reduce((sum, w, i) => sum + w * c[i], 0));
  m = m.map((v, i) => Math.min(1, Math.max(0.000001, v * slope[i] + offset[i])) ** power[i]);
  m = m.map((v) => {
    const curve = contrast >= 0 ? v * v * (3 - 2 * v) : 0.5 + (v - 0.5) * 0.5;
    return v + (curve - v) * Math.abs(contrast);
  });
  const luma = lumaOf(m);
  m = m.map((v) => luma + (v - luma) * saturation);
  m = m.map((v, i) => v + shadowTint[i] * (1 - luma) ** 2 + highlightTint[i] * luma ** 2);
  return c.map((v, i) => v + (clamp01(m[i]) - v) * intensity);
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
// What the GPU's sampler returns at uv: nearest, or bilinear between texel centers (clamped edges).
const sample = ([u, v], linear) => {
  if (!linear) return texel(Math.floor(u * W), Math.floor(v * H));
  const x = u * W - 0.5;
  const y = v * H - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const a = texel(x0, y0), b = texel(x0 + 1, y0), c = texel(x0, y0 + 1), d = texel(x0 + 1, y0 + 1);
  return [0, 1, 2].map((ch) => (a[ch] * (1 - fx) + b[ch] * fx) * (1 - fy) + (c[ch] * (1 - fx) + d[ch] * fx) * fy);
};

const noCrop = { rect: [0, 0, 1, 1], turns: 0, straighten: 0, flipH: false, flipV: false };
const neutral = Object.fromEntries(KEYS.map((k) => [k, 0]));

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
  // Geometry. Rects are chosen so the output is a whole number of pixels.
  ...[0, 1, 2, 3].map((turns) => ({ name: `rotate ${turns * 90}`, crop: { turns } })),
  { name: 'flip H', crop: { flipH: true } },
  { name: 'flip V', crop: { flipV: true } },
  { name: 'rotate 90 + flip H', crop: { turns: 1, flipH: true } },
  { name: 'crop', crop: { rect: [0.25, 0.25, 0.5, 0.5] } },
  { name: 'crop + rotate 90', crop: { rect: [0.25, 0.125, 0.5, 0.75], turns: 1 } },
  { name: 'crop + rotate 270 + flip V', crop: { rect: [0, 0.5, 0.75, 0.5], turns: 3, flipV: true } },
  { name: 'crop + vignette', crop: { rect: [0.5, 0, 0.5, 1] }, vignette: -1 },
  { name: 'crop + sharpness', crop: { rect: [0.25, 0.25, 0.5, 0.5], turns: 2 }, sharpness: 0.6 },
  // Straightened images fall between pixels, so these use linear sampling like the export does.
  { name: 'straighten 5', crop: { straighten: 5 }, linear: true },
  { name: 'straighten -30 + crop', crop: { rect: [0.25, 0.25, 0.5, 0.5], straighten: -30 }, linear: true },
  { name: 'straighten 12 + rotate 90', crop: { turns: 1, straighten: 12 }, linear: true },
  // Filters.
  ...BUILT_IN_FILTERS.map((f) => ({ name: `filter ${f.id}`, filter: packLook(f.look, 1) })),
  { name: 'filter film 0.5', filter: packLook(BUILT_IN_FILTERS.find((f) => f.id === 'film').look, 0.5) },
  { name: 'filter low contrast', filter: packLook({ contrast: -0.6, power: [0.8, 1, 1.2] }, 1) },
  {
    name: 'filter + adjustments + crop',
    filter: packLook(BUILT_IN_FILTERS[0].look, 0.8),
    exposure: 0.4, contrast: -0.2, saturation: 0.3,
    crop: { rect: [0.25, 0.25, 0.5, 0.5], turns: 1 },
  },
].map((c) => ({
  ...neutral,
  ...c,
  crop: { ...noCrop, ...c.crop },
  linear: !!c.linear,
  filter: c.filter ?? packLook({}, 0),
}));

const prepared = cases.map((c) => {
  const [ow, oh] = outputSize(c.crop, W, H);
  return {
    ...c,
    ow,
    oh,
    vparams: [1, 1, 1, W / H],
    cropUniform: [...c.crop.rect, c.crop.turns, (c.crop.straighten * Math.PI) / 180, +c.crop.flipH, +c.crop.flipV],
    params: [
      c.exposure, c.contrast, c.highlights, c.shadows,
      c.saturation, c.vibrance, c.warmth, c.tint,
      c.sharpness, c.vignette, ow / oh, 0,
    ],
  };
});

// ---- run on the GPU ----

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const results = await page.evaluate(
  ({ vertex, fragment, image, W, H, cases }) => {
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
    // Same quad corners as the vertex buffer in GlPhotoProgram.kt.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Same texture setup as the export path: clamped edges, 1:1 output.
    const input = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(image));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());

    const out = [];
    for (const c of cases) {
      const filter = c.linear ? gl.LINEAR : gl.NEAREST;
      gl.bindTexture(gl.TEXTURE_2D, input);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

      const output = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, output);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, c.ow, c.oh);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
      gl.bindTexture(gl.TEXTURE_2D, input);
      gl.viewport(0, 0, c.ow, c.oh);

      // Flipped like the export path, so output row y is the y-th row from the top.
      gl.uniform4fv(gl.getUniformLocation(program, 'uVParams'), new Float32Array(c.vparams));
      gl.uniform4fv(gl.getUniformLocation(program, 'uCrop'), new Float32Array(c.cropUniform));
      gl.uniform4fv(gl.getUniformLocation(program, 'uParams'), new Float32Array(c.params));
      gl.uniform4fv(gl.getUniformLocation(program, 'uFilter'), new Float32Array(c.filter));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const px = new Uint8Array(c.ow * c.oh * 4);
      gl.readPixels(0, 0, c.ow, c.oh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push(Array.from(px));
      gl.deleteTexture(output);
    }
    return { out, renderer: gl.getParameter(gl.RENDERER) };
  },
  { vertex, fragment, image: Array.from(image), W, H, cases: prepared }
);
await browser.close();

console.log(`GPU: ${results.renderer}`);
let worst = 0;
prepared.forEach((a, n) => {
  const got = results.out[n];
  const { ow, oh } = a;
  let maxDiff = 0;
  let off = 0;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const uv = [(x + 0.5) / ow, (y + 0.5) / oh];
      const src = cropToSource(uv, a.crop, W / H);
      const center = sample(src, a.linear);
      const blur = [0, 1, 2].map(
        (ch) =>
          (sample([src[0] + 1 / W, src[1]], a.linear)[ch] +
            sample([src[0] - 1 / W, src[1]], a.linear)[ch] +
            sample([src[0], src[1] + 1 / H], a.linear)[ch] +
            sample([src[0], src[1] - 1 / H], a.linear)[ch]) /
          4
      );
      const adjusted = applyAdjustments(center, blur, uv, ow / oh, a);
      const expected = a.filter[3] > 0 ? applyFilter(adjusted, a.filter) : adjusted;
      for (let ch = 0; ch < 3; ch++) {
        const d = Math.abs(got[(y * ow + x) * 4 + ch] - Math.round(expected[ch] * 255));
        maxDiff = Math.max(maxDiff, d);
        if (d > 0) off++;
      }
    }
  }
  // Bilinear filtering runs at reduced precision on GPUs, so straightened cases get 2/255 of slack.
  const limit = a.linear ? 2 : 1;
  if (maxDiff > limit) worst = Infinity;
  const total = ow * oh * 3;
  console.log(
    `${a.name.padEnd(27)} ${String(ow).padStart(2)}x${String(oh).padEnd(2)} max |GPU - reference| = ${maxDiff}/255, off: ${String(off).padStart(4)}/${total}`
  );
});

// A setting that changes nothing means its uniform never reached the shader.
const baseline = results.out[0].join();
prepared.forEach((a, n) => {
  if (n > 0 && a.name !== 'rotate 0' && results.out[n].join() === baseline) {
    console.error(`${a.name} had no effect`);
    worst = Infinity;
  }
});
// The reference could share a mistake with the shader, so pin down the geometry's meaning with a
// few pixels whose answer is known: which source pixel lands in the output's top-left corner.
const pixelAt = (name, x, y) => {
  const n = prepared.findIndex((a) => a.name === name);
  const i = (y * prepared[n].ow + x) * 4;
  return results.out[n].slice(i, i + 3).join();
};
const sourceAt = (x, y) => Array.from(image.slice((y * W + x) * 4, (y * W + x) * 4 + 3)).join();
const known = [
  ['rotate 90', 0, 0, 0, H - 1, 'turning clockwise brings the bottom-left corner to the top-left'],
  ['rotate 270', 0, 0, W - 1, 0, 'turning counter-clockwise brings the top-right corner to the top-left'],
  ['flip H', 0, 0, W - 1, 0, 'a horizontal flip brings the top-right corner to the top-left'],
  ['crop', 0, 0, W / 4, H / 4, 'the crop starts a quarter of the way in'],
];
for (const [name, x, y, sx, sy, meaning] of known) {
  if (pixelAt(name, x, y) !== sourceAt(sx, sy)) {
    console.error(`${name}: wrong pixel at (${x}, ${y}); ${meaning}`);
    worst = Infinity;
  }
}

// Black-and-white filters must come out exactly gray.
for (const name of ['filter mono', 'filter noir']) {
  const px = results.out[prepared.findIndex((a) => a.name === name)];
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] !== px[i + 1] || px[i] !== px[i + 2]) {
      console.error(`${name}: pixel ${i / 4} is not gray`);
      worst = Infinity;
      break;
    }
  }
}

process.exit(Number.isFinite(worst) ? 0 : 1);
