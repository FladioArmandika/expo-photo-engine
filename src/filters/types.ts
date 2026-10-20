export type RGB = [number, number, number];

/**
 * How a filter changes colors. Every field is optional; a missing one changes nothing.
 * Applied after the adjustments, in this order: mixer, slope/offset/power, contrast, saturation,
 * then the shadow and highlight tints. Values are sRGB-encoded, 0..1.
 */
export type FilterLook = {
  /**
   * Channel mixer: each output channel as a weighted sum of the input red, green and blue.
   * Rows are [red out, green out, blue out]. Three identical rows make a black-and-white filter.
   */
  mixer?: [RGB, RGB, RGB];
  /** Per-channel gain, `x * slope + offset`, then raised to `power` (the ASC CDL formula). */
  slope?: RGB;
  /** Per-channel offset. A small positive value lifts the blacks for a faded look. */
  offset?: RGB;
  /** Per-channel gamma. Above 1 darkens the midtones, below 1 brightens them. */
  power?: RGB;
  /** -1..1. Positive is an S-curve, negative flattens towards gray. */
  contrast?: number;
  /** 1 = unchanged, 0 = gray, 1.3 = 30% more saturated. */
  saturation?: number;
  /** Color added to the dark parts, e.g. [-0.03, 0, 0.04] for cool shadows. */
  shadowTint?: RGB;
  /** Color added to the bright parts. */
  highlightTint?: RGB;
};

export type FilterDefinition = {
  /** Stored in the edit stack as `filter.id`. Keep it stable once photos are saved with it. */
  id: string;
  label: string;
  look: FilterLook;
};
