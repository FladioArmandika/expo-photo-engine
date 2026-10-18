// Runs the Android GLSL shader (copied verbatim from Shaders.kt) in headless Chromium's
// WebGL2 (GLSL ES 3.00, same language as GLES 3.0) and compares every 8-bit input value
// against a float64 JavaScript reference of the same math.
//
//   node scripts/check-glsl.mjs   (needs `playwright-core` and a Chromium)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const kotlin = readFileSync(
  new URL('../android/src/main/java/expo/modules/photoengine/Shaders.kt', import.meta.url),
  'utf8'
);
const [vertex, fragment] = [...kotlin.matchAll(/"""([\s\S]*?)"""/g)].map((m) => m[1]);

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const reference = (v, ev) =>
  Math.round(linearToSrgb(clamp01(srgbToLinear(v / 255) * 2 ** ev)) * 255);

const exposures = [-3, -2, -1, -0.5, -0.1, 0, 0.1, 0.4, 0.5, 1, 2, 3];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const results = await page.evaluate(
  ({ vertex, fragment, exposures }) => {
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

    // 256x1 ramp: pixel i = (i, i, i, 255).
    const ramp = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) ramp.set([i, i, i, 255], i * 4);
    const input = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, ramp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const output = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, output);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, 1);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);
    gl.uniform4f(gl.getUniformLocation(program, 'uVParams'), 1, 1, 1, 0);
    gl.viewport(0, 0, 256, 1);

    const out = {};
    for (const ev of exposures) {
      gl.uniform4f(gl.getUniformLocation(program, 'uParams'), ev, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const px = new Uint8Array(256 * 4);
      gl.readPixels(0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out[ev] = Array.from({ length: 256 }, (_, i) => px[i * 4]);
    }
    return { out, renderer: gl.getParameter(gl.RENDERER) };
  },
  { vertex, fragment, exposures }
);
await browser.close();

console.log(`GPU: ${results.renderer}`);
let worst = 0;
for (const ev of exposures) {
  const got = results.out[ev];
  let maxDiff = 0;
  let off = 0;
  got.forEach((g, i) => {
    const d = Math.abs(g - reference(i, ev));
    maxDiff = Math.max(maxDiff, d);
    if (d > 0) off++;
  });
  worst = Math.max(worst, maxDiff);
  console.log(
    `EV ${String(ev).padStart(4)}: max |GPU - reference| = ${maxDiff}/255, values off by any amount: ${off}/256`
  );
}
process.exit(worst <= 1 ? 0 : 1);
