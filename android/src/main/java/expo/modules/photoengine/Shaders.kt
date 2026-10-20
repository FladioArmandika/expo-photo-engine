package expo.modules.photoengine

// GLSL ES 3.00 source for the edit pipeline.
//
// The adjustment math lives in the SHARED ADJUSTMENTS block, which is identical to the one in
// ios/Shaders.swift (Metal). Both platforms decode sRGB by hand instead of using sRGB texture
// formats, so the two GPUs see exactly the same numbers and no platform color conversion
// sneaks in.
internal object Shaders {
  // One quad as a 4-vertex triangle strip (corners from a small vertex buffer), scaled to
  // aspect-fit the target. uVParams = (scale x, scale y, 1 to flip vertically,
  // texture width / height), uCrop = crop rect and geo (see cropToSource).
  const val VERTEX = """#version 300 es
uniform vec4 uVParams;
uniform vec4 uCrop[2];
out vec2 vUv;
layout(location = 0) in vec2 aCorner;
out vec2 vSrcUv;

// BEGIN SHARED GEOMETRY
// Identical in ios/Shaders.swift and android/.../Shaders.kt, like SHARED ADJUSTMENTS below.
//
// Maps a point of the output (0..1, y down) to the texture coordinate to read.
// rect = crop [x, y, width, height], 0..1 in the image after rotation and flips.
// geo = (clockwise quarter turns, straighten in radians clockwise, flipH, flipV).
// srcAspect = width / height of the texture.
// Lengths are in units of the texture's height. Rotation happens first, then the flips, then the
// crop. Straightening turns the picture about the crop center and zooms in just enough that the
// crop never shows anything outside the photo.

vec2 rotateClockwise(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

// Smallest zoom that keeps center + corner / zoom inside [0, size].
float zoomToFit(vec2 corner, vec2 center, vec2 size) {
  vec2 room = max(size - center, vec2(0.000001));
  vec2 roomBefore = max(center, vec2(0.000001));
  return max(max(corner.x / room.x, -corner.x / roomBefore.x),
             max(corner.y / room.y, -corner.y / roomBefore.y));
}

vec2 cropToSource(vec2 outUv, vec4 rect, vec4 geo, float srcAspect) {
  int turns = int(geo.x + 0.5);
  vec2 size = (turns == 1 || turns == 3) ? vec2(1.0, srcAspect) : vec2(srcAspect, 1.0);
  vec2 center = (rect.xy + rect.zw * 0.5) * size;
  vec2 halfSize = rect.zw * 0.5 * size;

  float zoom = 1.0;
  zoom = max(zoom, zoomToFit(rotateClockwise(vec2(-halfSize.x, -halfSize.y), -geo.y), center, size));
  zoom = max(zoom, zoomToFit(rotateClockwise(vec2(halfSize.x, -halfSize.y), -geo.y), center, size));
  zoom = max(zoom, zoomToFit(rotateClockwise(vec2(-halfSize.x, halfSize.y), -geo.y), center, size));
  zoom = max(zoom, zoomToFit(rotateClockwise(vec2(halfSize.x, halfSize.y), -geo.y), center, size));

  // Point in the rotated and flipped image.
  vec2 offset = (outUv - 0.5) * rect.zw * size;
  vec2 q = center + rotateClockwise(offset, -geo.y) / zoom;
  // Undo the flips.
  q.x = q.x + (size.x - 2.0 * q.x) * geo.z;
  q.y = q.y + (size.y - 2.0 * q.y) * geo.w;
  // Undo the quarter turns. A clockwise turn moves texture point (x, y) to (1 - y, x).
  vec2 p = q;
  if (turns == 1) { p = vec2(q.y, 1.0 - q.x); }
  if (turns == 2) { p = vec2(srcAspect - q.x, 1.0 - q.y); }
  if (turns == 3) { p = vec2(srcAspect - q.y, q.x); }
  return vec2(p.x / srcAspect, p.y);
}
// END SHARED GEOMETRY

void main() {
  vec2 p = aCorner;
  gl_Position = vec4(p * uVParams.xy, 0.0, 1.0);
  // Clip-space top (y = +1) shows the top of the output (v = 0).
  vUv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  if (uVParams.z > 0.5) { vUv.y = 1.0 - vUv.y; }
  // The mapping is affine, so computing it per corner and interpolating is exact.
  vSrcUv = cropToSource(vUv, uCrop[0], uCrop[1], uVParams.w);
}
"""

  // uParams[0..2] = p0, p1, p2 of applyAdjustments (uParams[2].z is the output's width / height),
  // uFilter[0..7] = f0..f7 of applyFilter, uHsl[0..6] = h0..h6 of applyHsl.
  const val FRAGMENT = """#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vSrcUv;
uniform sampler2D uImage;
uniform vec4 uParams[3];
uniform vec4 uFilter[8];
uniform vec4 uHsl[7];
out vec4 fragColor;

vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.04045))));
}

vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.0031308))));
}

// BEGIN SHARED ADJUSTMENTS
// This block is byte-for-byte identical in ios/Shaders.swift and android/.../Shaders.kt
// (scripts/check-glsl.mjs fails CI if they drift). It sticks to syntax both languages accept;
// Metal maps vec2/vec3/vec4 to float2/float3/float4 with #defines.
//
// p0 = (exposure, contrast, highlights, shadows)
// p1 = (saturation, vibrance, warmth, tint)
// p2 = (sharpness, vignette, output width / height, unused)
// srgb is the pixel, blur the average of its 4 neighbours, both sRGB-encoded 0..1.
// uv is the position in the output (0..1) and aspect its width / height.
// Returns the edited, sRGB-encoded color.
vec3 applyAdjustments(vec3 srgb, vec3 blur, vec2 uv, float aspect, vec4 p0, vec4 p1, vec4 p2) {
  // Sharpness: unsharp mask on the encoded values, before any tone change.
  vec3 c = clamp(srgb + (srgb - blur) * (p2.x * 2.0), 0.0, 1.0);

  // Exposure, white balance and vignette are plain multipliers in linear light.
  vec3 lin = srgbToLinear(c);
  float warmth = p1.z;
  float tint = p1.w;
  vec3 balance = vec3(0.25 * warmth + 0.1 * tint, -0.2 * tint, 0.1 * tint - 0.25 * warmth);
  lin *= exp2(balance + p0.x);
  // Distance from the center, 1.0 at the corners whatever the aspect ratio.
  vec2 fromCenter = (uv - 0.5) * vec2(aspect, 1.0);
  float radius = length(fromCenter) / length(vec2(aspect, 1.0) * 0.5);
  lin *= exp2(p2.y * 2.0 * smoothstep(0.35, 1.0, radius));
  c = linearToSrgb(clamp(lin, 0.0, 1.0));

  // The rest works on encoded values, which are close to how bright things look.
  vec3 lumaWeights = vec3(0.2126, 0.7152, 0.0722);

  // Highlights and shadows scale the pixel by a factor that is 1 at pure black and pure white,
  // so neither end moves and colors keep their hue.
  float luma = dot(c, lumaWeights);
  float dark = 1.0 - luma;
  c *= 1.0 + 0.9 * (p0.w * dark * dark + p0.z * luma * dark);
  c = clamp(c, 0.0, 1.0);

  // Contrast: towards an S-curve when positive, towards flat gray when negative.
  vec3 curve = p0.y >= 0.0 ? c * c * (3.0 - 2.0 * c) : 0.5 + (c - 0.5) * 0.5;
  c += (curve - c) * abs(p0.y);

  // Saturation scales every color's distance from gray. Vibrance does the same but mostly
  // moves muted colors and leaves already saturated ones (often skin) alone.
  luma = dot(c, lumaWeights);
  c = luma + (c - luma) * (1.0 + p1.x);
  float chroma = clamp(max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)), 0.0, 1.0);
  c = luma + (c - luma) * (1.0 + p1.y * (1.0 - chroma));
  return clamp(c, 0.0, 1.0);
}
// HSL: hue, saturation and luminance per color range, seven vec4s packed by
// src/edit-stack/hsl.ts. h0.x = 1 when anything is set. h1, h2 = hue, h3, h4 = saturation and
// h5, h6 = luminance, for red, orange, yellow, green (first vec4) and aqua, blue, purple,
// magenta (second vec4).

// How much a hue (degrees) belongs to the range centered on `center`. Each range fades out
// towards its neighbours' centers, `before` and `after` degrees away, and two neighbouring
// weights always add up to 1, so every hue is fully covered.
float hslWeight(float hue, float center, float before, float after) {
  float d = hue - center;
  if (d > 180.0) { d -= 360.0; }
  if (d < -180.0) { d += 360.0; }
  float t = clamp(d < 0.0 ? 1.0 + d / before : 1.0 - d / after, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec3 applyHsl(vec3 c, vec4 h1, vec4 h2, vec4 h3, vec4 h4, vec4 h5, vec4 h6) {
  float top = max(c.r, max(c.g, c.b));
  float delta = top - min(c.r, min(c.g, c.b));
  // Grays have no hue, so nothing to change.
  if (delta < 0.00001) { return c; }
  float hue = 0.0;
  if (top == c.r) {
    hue = (c.g - c.b) / delta;
    if (hue < 0.0) { hue += 6.0; }
  } else if (top == c.g) {
    hue = (c.b - c.r) / delta + 2.0;
  } else {
    hue = (c.r - c.g) / delta + 4.0;
  }
  hue *= 60.0;
  float sat = delta / top;

  vec4 wA = vec4(hslWeight(hue, 0.0, 60.0, 30.0), hslWeight(hue, 30.0, 30.0, 30.0),
                 hslWeight(hue, 60.0, 30.0, 60.0), hslWeight(hue, 120.0, 60.0, 60.0));
  vec4 wB = vec4(hslWeight(hue, 180.0, 60.0, 60.0), hslWeight(hue, 240.0, 60.0, 30.0),
                 hslWeight(hue, 270.0, 30.0, 30.0), hslWeight(hue, 300.0, 30.0, 60.0));
  float hueShift = dot(wA, h1) + dot(wB, h2);
  float satShift = dot(wA, h3) + dot(wB, h4);
  float lumShift = dot(wA, h5) + dot(wB, h6);

  // Hue turns up to 30 degrees towards the neighbouring color. Saturation scales the color's
  // strength. Both rebuild the pixel from hue, saturation and value (its brightest channel).
  float h = (hue + hueShift * 30.0) / 60.0;
  float s = clamp(sat * (1.0 + satShift), 0.0, 1.0);
  vec3 k = vec3(5.0, 3.0, 1.0) + h;
  k = k - 6.0 * floor(k / 6.0);
  vec3 rgb = top - top * s * clamp(min(k, 4.0 - k), 0.0, 1.0);

  // Luminance moves the color towards white or black. It is scaled by the original saturation,
  // so near-grays (whose hue is mostly noise) barely change.
  float amount = lumShift * sat * 0.5;
  rgb = amount > 0.0 ? rgb + (1.0 - rgb) * amount : rgb * (1.0 + amount);
  return clamp(rgb, 0.0, 1.0);
}

// Filters: a fixed look on top of the adjustments, eight vec4s packed by src/filters/looks.ts.
// f0, f1, f2 = channel mixer rows (xyz), with intensity in f0.w, saturation in f1.w and
// contrast in f2.w. f3, f4, f5 = slope, offset and power (the ASC CDL formula).
// f6, f7 = color added to the shadows and to the highlights.
// Intensity blends between the input (0) and the full look (1).
vec3 applyFilter(vec3 c, vec4 f0, vec4 f1, vec4 f2, vec4 f3, vec4 f4, vec4 f5, vec4 f6, vec4 f7) {
  vec3 m = vec3(dot(f0.xyz, c), dot(f1.xyz, c), dot(f2.xyz, c));
  // The small floor keeps pow away from 0, where GPUs disagree.
  m = pow(clamp(m * f3.xyz + f4.xyz, 0.000001, 1.0), f5.xyz);

  vec3 curve = f2.w >= 0.0 ? m * m * (3.0 - 2.0 * m) : 0.5 + (m - 0.5) * 0.5;
  m += (curve - m) * abs(f2.w);

  float luma = dot(m, vec3(0.2126, 0.7152, 0.0722));
  m = luma + (m - luma) * f1.w;
  m += f6.xyz * (1.0 - luma) * (1.0 - luma) + f7.xyz * luma * luma;
  return c + (clamp(m, 0.0, 1.0) - c) * f0.w;
}
// END SHARED ADJUSTMENTS

// Bilinear read done in the shader instead of by the GPU's sampler. Every GPU blends with its own
// weight precision, which made straightened crops differ by a few levels on hard edges between
// iOS and Android. Here the weights are rounded to 1/256 the same way on both, and at a pixel
// center they round to exactly 0 or 1, so an unstraightened crop copies pixels unchanged.
// Mirrors sampleImage in ios/Shaders.swift.
vec4 sampleImage(vec2 uv) {
  ivec2 size = textureSize(uImage, 0);
  ivec2 last = size - 1;
  vec2 pos = uv * vec2(size) - 0.5;
  vec2 base = floor(pos);
  vec2 f = floor((pos - base) * 256.0 + 0.5) / 256.0;
  ivec2 p0 = clamp(ivec2(base), ivec2(0), last);
  ivec2 p1 = clamp(ivec2(base) + 1, ivec2(0), last);
  vec4 a = texelFetch(uImage, p0, 0);
  vec4 b = texelFetch(uImage, ivec2(p1.x, p0.y), 0);
  vec4 c = texelFetch(uImage, ivec2(p0.x, p1.y), 0);
  vec4 d = texelFetch(uImage, p1, 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 size = vec2(textureSize(uImage, 0));
  vec4 color = sampleImage(vSrcUv);
  vec3 blur = color.rgb;
  // Only pay for the 4 extra reads when sharpening is on. The branch is uniform per draw.
  if (uParams[2].x > 0.0) {
    vec2 texel = 1.0 / size;
    blur = (sampleImage(vSrcUv + vec2(texel.x, 0.0)).rgb
          + sampleImage(vSrcUv - vec2(texel.x, 0.0)).rgb
          + sampleImage(vSrcUv + vec2(0.0, texel.y)).rgb
          + sampleImage(vSrcUv - vec2(0.0, texel.y)).rgb) * 0.25;
  }
  vec3 edited = applyAdjustments(
    color.rgb, blur, vUv, uParams[2].z, uParams[0], uParams[1], uParams[2]);
  if (uHsl[0].x > 0.0) {
    edited = applyHsl(edited, uHsl[1], uHsl[2], uHsl[3], uHsl[4], uHsl[5], uHsl[6]);
  }
  if (uFilter[0].w > 0.0) {
    edited = applyFilter(
      edited, uFilter[0], uFilter[1], uFilter[2], uFilter[3], uFilter[4], uFilter[5], uFilter[6], uFilter[7]);
  }
  fragColor = vec4(edited, color.a);
}
"""
}
