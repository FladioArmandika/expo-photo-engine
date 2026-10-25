import type { EditStack } from './types';

/** The eight color ranges of the HSL panel, in hue order (red is 0°, magenta 300°). */
export const HSL_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
] as const;

export type HslColor = (typeof HSL_COLORS)[number];

export const HSL_CHANNELS = ['hue', 'saturation', 'luminance'] as const;

export type HslChannel = (typeof HSL_CHANNELS)[number];

/**
 * Changes to one color range, each -1..1 (0 = unchanged, missing = 0).
 * hue: shifts the color towards its neighbours, up to 30°.
 * saturation: -1 turns it gray, 1 doubles it.
 * luminance: -1 darkens it, 1 lightens it.
 */
export type HslShift = Partial<Record<HslChannel, number>>;

/** Missing color = unchanged. */
export type HslAdjustments = Partial<Record<HslColor, HslShift>>;

/** Number of floats the shaders read for HSL: seven vec4s. */
export const HSL_UNIFORM_COUNT = 28;

const clamp1 = (v: number) => Math.min(1, Math.max(-1, v));

/**
 * Returns a new stack with one HSL value set (clamped to -1..1). Zeros are removed, and so is
 * a color with nothing left, so equal edits always serialize the same way.
 */
export function withHsl(
  stack: EditStack,
  color: HslColor,
  channel: HslChannel,
  value: number
): EditStack {
  const shift = { ...stack.hsl?.[color] };
  const clamped = clamp1(value);
  if (clamped === 0) delete shift[channel];
  else shift[channel] = clamped;

  const hsl: HslAdjustments = { ...stack.hsl };
  if (Object.keys(shift).length > 0) hsl[color] = shift;
  else delete hsl[color];

  const { hsl: _, ...rest } = stack;
  return Object.keys(hsl).length > 0 ? { ...rest, hsl } : rest;
}

/** True when no color is changed. */
export function isHslNeutral(hsl: HslAdjustments | undefined): boolean {
  if (!hsl) return true;
  return HSL_COLORS.every((color) => HSL_CHANNELS.every((ch) => !hsl[color]?.[ch]));
}

/**
 * Packs HSL into the seven vec4s that applyHsl in the shaders reads:
 * h0.x = 1 when anything is set (the shader skips HSL otherwise), then hue for the eight colors
 * (h1, h2), saturation (h3, h4) and luminance (h5, h6), in HSL_COLORS order.
 */
export function packHsl(hsl: HslAdjustments | undefined): number[] {
  if (isHslNeutral(hsl)) return new Array(HSL_UNIFORM_COUNT).fill(0);
  const channel = (ch: HslChannel) => HSL_COLORS.map((color) => clamp1(hsl?.[color]?.[ch] ?? 0));
  return [1, 0, 0, 0, ...channel('hue'), ...channel('saturation'), ...channel('luminance')];
}
