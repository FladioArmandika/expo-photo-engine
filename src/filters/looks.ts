import type { FilterLook } from './types';

/** Number of floats the shaders read for a filter: eight vec4s. */
export const LOOK_UNIFORM_COUNT = 32;

/**
 * Packs a look into the eight vec4s that applyFilter in the shaders reads:
 * f0..f2 = mixer rows with intensity, saturation and contrast in .w,
 * f3 = slope, f4 = offset, f5 = power, f6 = shadow tint, f7 = highlight tint.
 */
export function packLook(look: FilterLook, intensity: number): number[] {
  const [r, g, b] = look.mixer ?? [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  // prettier-ignore
  return [
    ...r, intensity,
    ...g, look.saturation ?? 1,
    ...b, look.contrast ?? 0,
    ...(look.slope ?? [1, 1, 1]), 0,
    ...(look.offset ?? [0, 0, 0]), 0,
    ...(look.power ?? [1, 1, 1]), 0,
    ...(look.shadowTint ?? [0, 0, 0]), 0,
    ...(look.highlightTint ?? [0, 0, 0]), 0,
  ];
}
