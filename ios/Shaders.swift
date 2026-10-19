// Metal Shading Language source for the edit pipeline.
//
// The adjustment math lives in the SHARED ADJUSTMENTS block, which is identical to the one in
// android/.../Shaders.kt (GLSL ES 3.00). Both platforms decode sRGB by hand instead of using
// *_srgb texture formats, so the two GPUs see exactly the same numbers and no platform color
// conversion sneaks in.
let photoEngineMetalSource = """
#include <metal_stdlib>
using namespace metal;

#define vec2 float2
#define vec3 float3
#define vec4 float4

struct VertexOut {
  float4 position [[position]];
  float2 uv;
};

// One quad as a 4-vertex triangle strip, scaled to aspect-fit the target.
// vparams.xy = scale in clip space, vparams.z = 1 to flip vertically.
vertex VertexOut photo_vertex(uint vid [[vertex_id]], constant float4 &vparams [[buffer(0)]]) {
  const float2 corners[4] = { float2(-1, -1), float2(1, -1), float2(-1, 1), float2(1, 1) };
  float2 p = corners[vid];
  VertexOut out;
  out.position = float4(p * vparams.xy, 0.0, 1.0);
  // Clip-space top (y = +1) samples the first image row (v = 0).
  out.uv = float2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  if (vparams.z > 0.5) { out.uv.y = 1.0 - out.uv.y; }
  return out;
}

float3 srgbToLinear(float3 c) {
  float3 lo = c / 12.92;
  float3 hi = pow((c + 0.055) / 1.055, float3(2.4));
  return select(hi, lo, c <= 0.04045);
}

float3 linearToSrgb(float3 c) {
  float3 lo = c * 12.92;
  float3 hi = 1.055 * pow(c, float3(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= 0.0031308);
}

// BEGIN SHARED ADJUSTMENTS
// This block is byte-for-byte identical in ios/Shaders.swift and android/.../Shaders.kt
// (scripts/check-glsl.mjs fails CI if they drift). It sticks to syntax both languages accept;
// Metal maps vec2/vec3/vec4 to float2/float3/float4 with #defines.
//
// p0 = (exposure, contrast, highlights, shadows)
// p1 = (saturation, vibrance, warmth, tint)
// p2 = (sharpness, vignette, unused, unused)
// srgb is the pixel, blur the average of its 4 neighbours, both sRGB-encoded 0..1.
// uv is the position in the image (0..1) and aspect its width / height.
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
// END SHARED ADJUSTMENTS

// params[0..2] = p0, p1, p2 of applyAdjustments.
fragment float4 photo_fragment(VertexOut in [[stage_in]],
                               texture2d<float> image [[texture(0)]],
                               sampler imageSampler [[sampler(0)]],
                               constant float4 *params [[buffer(0)]]) {
  float2 size = float2(image.get_width(), image.get_height());
  float4 color = image.sample(imageSampler, in.uv);
  float3 blur = color.rgb;
  // Only pay for the 4 extra reads when sharpening is on. The branch is uniform per draw.
  if (params[2].x > 0.0) {
    float2 texel = 1.0 / size;
    blur = (image.sample(imageSampler, in.uv + float2(texel.x, 0.0)).rgb
          + image.sample(imageSampler, in.uv - float2(texel.x, 0.0)).rgb
          + image.sample(imageSampler, in.uv + float2(0.0, texel.y)).rgb
          + image.sample(imageSampler, in.uv - float2(0.0, texel.y)).rgb) * 0.25;
  }
  float3 edited = applyAdjustments(
    color.rgb, blur, in.uv, size.x / size.y, params[0], params[1], params[2]);
  return float4(edited, color.a);
}
"""
