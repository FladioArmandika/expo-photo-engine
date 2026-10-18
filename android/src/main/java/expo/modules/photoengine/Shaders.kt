package expo.modules.photoengine

// GLSL ES 3.00 source for the edit pipeline.
//
// The adjustment math must stay identical to ios/Shaders.swift (Metal). Both versions
// decode sRGB by hand instead of using sRGB texture formats, so the two GPUs see
// exactly the same numbers and no platform color conversion sneaks in.
internal object Shaders {
  // One quad as a 4-vertex triangle strip built from gl_VertexID (no vertex buffers).
  // uVParams.xy = scale in clip space, uVParams.z = 1 to flip vertically.
  const val VERTEX = """#version 300 es
uniform vec4 uVParams;
out vec2 vUv;
const vec2 corners[4] = vec2[4](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));
void main() {
  vec2 p = corners[gl_VertexID];
  gl_Position = vec4(p * uVParams.xy, 0.0, 1.0);
  // Clip-space top (y = +1) samples the first image row (v = 0).
  vUv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  if (uVParams.z > 0.5) { vUv.y = 1.0 - vUv.y; }
}
"""

  // uParams.x = exposure in EV stops.
  const val FRAGMENT = """#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uImage;
uniform vec4 uParams;
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

void main() {
  vec4 color = texture(uImage, vUv);
  vec3 linear = srgbToLinear(color.rgb);
  linear *= exp2(uParams.x);
  vec3 encoded = linearToSrgb(clamp(linear, 0.0, 1.0));
  fragColor = vec4(encoded, color.a);
}
"""
}
