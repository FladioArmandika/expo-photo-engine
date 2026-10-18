// Metal Shading Language source for the edit pipeline.
//
// The adjustment math must stay identical to android/.../Shaders.kt (GLSL ES 3.00).
// Both versions decode sRGB by hand instead of using *_srgb texture formats, so the
// two GPUs see exactly the same numbers and no platform color conversion sneaks in.
let photoEngineMetalSource = """
#include <metal_stdlib>
using namespace metal;

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

static float3 srgb_to_linear(float3 c) {
  float3 lo = c / 12.92;
  float3 hi = pow((c + 0.055) / 1.055, float3(2.4));
  return select(hi, lo, c <= 0.04045);
}

static float3 linear_to_srgb(float3 c) {
  float3 lo = c * 12.92;
  float3 hi = 1.055 * pow(c, float3(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= 0.0031308);
}

// params.x = exposure in EV stops.
fragment float4 photo_fragment(VertexOut in [[stage_in]],
                               texture2d<float> image [[texture(0)]],
                               sampler imageSampler [[sampler(0)]],
                               constant float4 &params [[buffer(0)]]) {
  float4 color = image.sample(imageSampler, in.uv);
  float3 linear = srgb_to_linear(color.rgb);
  linear *= exp2(params.x);
  float3 encoded = linear_to_srgb(clamp(linear, 0.0, 1.0));
  return float4(encoded, color.a);
}
"""
