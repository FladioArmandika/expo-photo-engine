import {
  HSL_CHANNELS,
  HSL_COLORS,
  type HslAdjustments,
  type HslChannel,
  type HslColor,
} from './hsl';
import {
  ADJUSTMENT_KEYS,
  ADJUSTMENTS,
  CURRENT_EDIT_STACK_VERSION,
  STRAIGHTEN_LIMIT,
  type Adjustments,
  type AdjustmentKey,
  type Crop,
  type CropAspect,
  type EditStack,
  type FilterRef,
} from './types';

export type ValidationResult =
  { ok: true; value: EditStack; warnings: string[] } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const ASPECT_PATTERN = /^\d+(\.\d+)?:\d+(\.\d+)?$/;

export function isAdjustmentKey(key: string): key is AdjustmentKey {
  return (ADJUSTMENT_KEYS as readonly string[]).includes(key);
}

/** Clamps one value to its documented range. */
export function clampAdjustment(key: AdjustmentKey, value: number): number {
  const { min, max } = ADJUSTMENTS[key];
  return clamp(value, min, max);
}

/**
 * Checks an edit stack of the current version and returns a normalized copy.
 *
 * Recoverable problems (out-of-range values, unknown adjustment keys) are fixed and reported as
 * warnings. Structural problems (wrong types, a crop rect outside the image) are errors.
 * Use `migrateEditStack` for input that may come from an older version.
 */
export function validateEditStack(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ['edit stack must be an object'] };
  }
  if (input.version !== CURRENT_EDIT_STACK_VERSION) {
    return { ok: false, errors: [`unsupported version ${String(input.version)}`] };
  }

  const adjustments = validateAdjustments(input.adjustments, errors, warnings);
  const crop = input.crop == null ? null : validateCrop(input.crop, errors, warnings);
  const filter = input.filter == null ? null : validateFilter(input.filter, errors, warnings);
  const hsl = input.hsl == null ? {} : validateHsl(input.hsl, errors, warnings);

  for (const key of Object.keys(input)) {
    if (!['version', 'adjustments', 'crop', 'filter', 'hsl'].includes(key)) {
      warnings.push(`dropped unknown field "${key}"`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const value: EditStack = { version: 1, crop, adjustments, filter };
  if (Object.keys(hsl).length > 0) value.hsl = hsl;
  return { ok: true, value, warnings };
}

function validateHsl(input: unknown, errors: string[], warnings: string[]): HslAdjustments {
  const result: HslAdjustments = {};
  if (!isRecord(input)) {
    errors.push('hsl must be an object');
    return result;
  }
  for (const [color, shift] of Object.entries(input)) {
    if (!(HSL_COLORS as readonly string[]).includes(color)) {
      warnings.push(`dropped unknown hsl color "${color}"`);
      continue;
    }
    if (!isRecord(shift)) {
      errors.push(`hsl.${color} must be an object`);
      continue;
    }
    const kept: Partial<Record<HslChannel, number>> = {};
    for (const [channel, value] of Object.entries(shift)) {
      if (!(HSL_CHANNELS as readonly string[]).includes(channel)) {
        warnings.push(`dropped unknown hsl channel "${color}.${channel}"`);
        continue;
      }
      if (!isFiniteNumber(value)) {
        errors.push(`hsl.${color}.${channel} must be a finite number`);
        continue;
      }
      const clamped = clamp(value, -1, 1);
      if (clamped !== value) {
        warnings.push(`hsl.${color}.${channel} clamped from ${value} to ${clamped}`);
      }
      if (clamped !== 0) kept[channel as HslChannel] = clamped;
    }
    if (Object.keys(kept).length > 0) result[color as HslColor] = kept;
  }
  return result;
}

function validateAdjustments(input: unknown, errors: string[], warnings: string[]): Adjustments {
  const result: Adjustments = {};
  if (input === undefined) return result;
  if (!isRecord(input)) {
    errors.push('adjustments must be an object');
    return result;
  }
  for (const [key, value] of Object.entries(input)) {
    if (!isAdjustmentKey(key)) {
      warnings.push(`dropped unknown adjustment "${key}"`);
      continue;
    }
    if (!isFiniteNumber(value)) {
      errors.push(`adjustments.${key} must be a finite number`);
      continue;
    }
    const clamped = clampAdjustment(key, value);
    if (clamped !== value) warnings.push(`adjustments.${key} clamped from ${value} to ${clamped}`);
    // Neutral values are omitted so equal edits always serialize the same way.
    if (clamped !== 0) result[key] = clamped;
  }
  return result;
}

function validateCrop(input: unknown, errors: string[], warnings: string[]): Crop | null {
  if (!isRecord(input)) {
    errors.push('crop must be an object or null');
    return null;
  }
  const start = errors.length;

  const rect = input.rect;
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(isFiniteNumber)) {
    errors.push('crop.rect must be [x, y, width, height]');
  } else {
    const [x, y, w, h] = rect as number[] as [number, number, number, number];
    const eps = 1e-6;
    if (w <= 0 || h <= 0) errors.push('crop.rect width and height must be > 0');
    if (x < -eps || y < -eps || x + w > 1 + eps || y + h > 1 + eps) {
      errors.push('crop.rect must lie inside the image (0..1)');
    }
  }

  const rotation = input.rotation ?? 0;
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    errors.push('crop.rotation must be 0, 90, 180 or 270');
  }

  let straighten = input.straighten ?? 0;
  if (!isFiniteNumber(straighten)) {
    errors.push('crop.straighten must be a finite number');
    straighten = 0;
  } else if (Math.abs(straighten) > STRAIGHTEN_LIMIT) {
    const clamped = clamp(straighten, -STRAIGHTEN_LIMIT, STRAIGHTEN_LIMIT);
    warnings.push(`crop.straighten clamped from ${straighten} to ${clamped}`);
    straighten = clamped;
  }

  const flipH = input.flipH ?? false;
  const flipV = input.flipV ?? false;
  if (typeof flipH !== 'boolean') errors.push('crop.flipH must be a boolean');
  if (typeof flipV !== 'boolean') errors.push('crop.flipV must be a boolean');

  const aspect = input.aspect ?? 'free';
  if (
    typeof aspect !== 'string' ||
    !(aspect === 'free' || aspect === 'original' || ASPECT_PATTERN.test(aspect))
  ) {
    errors.push('crop.aspect must be "free", "original" or "W:H"');
  }

  for (const key of Object.keys(input)) {
    if (!['rect', 'rotation', 'straighten', 'flipH', 'flipV', 'aspect'].includes(key)) {
      warnings.push(`dropped unknown crop field "${key}"`);
    }
  }

  if (errors.length > start) return null;
  return {
    rect: [...(rect as [number, number, number, number])],
    rotation: rotation as Crop['rotation'],
    straighten: straighten as number,
    flipH: flipH as boolean,
    flipV: flipV as boolean,
    aspect: aspect as CropAspect,
  };
}

function validateFilter(input: unknown, errors: string[], warnings: string[]): FilterRef | null {
  if (!isRecord(input)) {
    errors.push('filter must be an object or null');
    return null;
  }
  if (typeof input.id !== 'string' || input.id.length === 0) {
    errors.push('filter.id must be a non-empty string');
    return null;
  }
  const intensity = input.intensity ?? 1;
  if (!isFiniteNumber(intensity)) {
    errors.push('filter.intensity must be a finite number');
    return null;
  }
  const clamped = clamp(intensity, 0, 1);
  if (clamped !== intensity)
    warnings.push(`filter.intensity clamped from ${intensity} to ${clamped}`);
  return { id: input.id, intensity: clamped };
}
