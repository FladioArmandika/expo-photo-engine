/** Every adjustment the engine knows. Order is the UI order, not the pipeline order. */
export const ADJUSTMENT_KEYS = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'saturation',
  'vibrance',
  'warmth',
  'tint',
  'sharpness',
  'vignette',
] as const;

export type AdjustmentKey = (typeof ADJUSTMENT_KEYS)[number];

/** Missing key = neutral (0). */
export type Adjustments = Partial<Record<AdjustmentKey, number>>;

export type AdjustmentInfo = {
  min: number;
  max: number;
  /** Neutral value. Always 0, so an empty stack is an unedited photo. */
  default: 0;
  /** Suggested slider step. */
  step: number;
  label: string;
  /** False until the native shaders implement it; the value is stored but not rendered yet. */
  implemented: boolean;
};

export const ADJUSTMENTS: Readonly<Record<AdjustmentKey, Readonly<AdjustmentInfo>>> = {
  exposure: { min: -3, max: 3, default: 0, step: 0.01, label: 'Exposure', implemented: true },
  contrast: { min: -1, max: 1, default: 0, step: 0.01, label: 'Contrast', implemented: true },
  highlights: { min: -1, max: 1, default: 0, step: 0.01, label: 'Highlights', implemented: true },
  shadows: { min: -1, max: 1, default: 0, step: 0.01, label: 'Shadows', implemented: true },
  saturation: { min: -1, max: 1, default: 0, step: 0.01, label: 'Saturation', implemented: true },
  vibrance: { min: -1, max: 1, default: 0, step: 0.01, label: 'Vibrance', implemented: true },
  warmth: { min: -1, max: 1, default: 0, step: 0.01, label: 'Warmth', implemented: true },
  tint: { min: -1, max: 1, default: 0, step: 0.01, label: 'Tint', implemented: true },
  sharpness: { min: 0, max: 1, default: 0, step: 0.01, label: 'Sharpness', implemented: true },
  vignette: { min: -1, max: 1, default: 0, step: 0.01, label: 'Vignette', implemented: true },
};

export type CropRotation = 0 | 90 | 180 | 270;

/** `free`, `original`, or a ratio such as `4:5`. UI constraint only: `rect` is the truth. */
export type CropAspect = 'free' | 'original' | `${number}:${number}`;

export type Crop = {
  /**
   * Normalized [x, y, width, height] in the image after `rotation` and the flips are applied.
   * (0, 0) is the top-left corner, (1, 1) the bottom-right.
   */
  rect: [number, number, number, number];
  /** Clockwise quarter turns. */
  rotation: CropRotation;
  /** Fine rotation in degrees about the crop center, -45..45. */
  straighten: number;
  flipH: boolean;
  flipV: boolean;
  aspect: CropAspect;
};

export type FilterRef = {
  id: string;
  /** 0..1, 1 = full filter. */
  intensity: number;
};

export type EditStack = {
  version: 1;
  /** null = no crop, rotation or flip. */
  crop: Crop | null;
  adjustments: Adjustments;
  filter: FilterRef | null;
};

export const CURRENT_EDIT_STACK_VERSION = 1;

export const STRAIGHTEN_LIMIT = 45;
