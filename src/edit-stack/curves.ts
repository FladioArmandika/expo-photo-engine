import type { EditStack } from './types';

/** `rgb` changes all three channels; `red`, `green` and `blue` one each, after `rgb`. */
export const CURVE_CHANNELS = ['rgb', 'red', 'green', 'blue'] as const;

export type CurveChannel = (typeof CURVE_CHANNELS)[number];

/** [input, output], both 0..1. [0, 0] is black, [1, 1] white. */
export type CurvePoint = [number, number];

/**
 * Tone curves, each a list of points sorted by input. Between points the curve is a smooth
 * monotone cubic, so it never overshoots; before the first point and after the last it stays
 * flat. Missing channel = straight line (unchanged).
 */
export type ToneCurves = Partial<Record<CurveChannel, CurvePoint[]>>;

export const MAX_CURVE_POINTS = 16;
/** Points closer than this along the input axis are merged. */
export const MIN_CURVE_POINT_GAP = 0.01;

/** The shaders get each curve as this many evenly spaced values, and interpolate in between. */
export const CURVE_SAMPLES = 33;
/** Number of floats the shaders read for curves: one flag vec4, then one vec4 per sample. */
export const CURVES_UNIFORM_COUNT = 4 + CURVE_SAMPLES * 4;

export const IDENTITY_CURVE: readonly CurvePoint[] = [
  [0, 0],
  [1, 1],
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Cleans up a list of points: clamps to 0..1, sorts by input, merges points closer than
 * MIN_CURVE_POINT_GAP (the later one wins) and keeps at most MAX_CURVE_POINTS. Returns null
 * when the result is a straight line from black to white, which changes nothing.
 */
export function normalizeCurve(points: readonly CurvePoint[]): CurvePoint[] | null {
  const sorted = points
    .map(([x, y]) => [clamp01(x), clamp01(y)] as CurvePoint)
    .sort((a, b) => a[0] - b[0]);
  const result: CurvePoint[] = [];
  for (const point of sorted) {
    const last = result[result.length - 1];
    if (last && point[0] - last[0] < MIN_CURVE_POINT_GAP) result[result.length - 1] = point;
    else result.push(point);
  }
  if (result.length === 0) return null;
  const kept = result.length > MAX_CURVE_POINTS ? thin(result) : result;
  return isIdentity(kept) ? null : kept;
}

// Keeps the first and last point and spreads the rest evenly.
function thin(points: CurvePoint[]): CurvePoint[] {
  const step = (points.length - 1) / (MAX_CURVE_POINTS - 1);
  return Array.from({ length: MAX_CURVE_POINTS }, (_, i) => points[Math.round(i * step)]!);
}

function isIdentity(points: readonly CurvePoint[]): boolean {
  for (let i = 0; i <= 64; i++) {
    const x = i / 64;
    if (Math.abs(evaluateCurve(points, x) - x) > 1e-9) return false;
  }
  return true;
}

/**
 * The curve's output for input x: monotone cubic interpolation (Fritsch-Carlson) through the
 * points, flat outside them. `points` must be sorted by input, as normalizeCurve leaves them.
 */
export function evaluateCurve(points: readonly CurvePoint[], x: number): number {
  const n = points.length;
  if (n === 0) return x;
  if (n === 1 || x <= points[0]![0]) return points[0]![1];
  if (x >= points[n - 1]![0]) return points[n - 1]![1];

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const slopes = xs.slice(1).map((x1, k) => (ys[k + 1]! - ys[k]!) / (x1 - xs[k]!));
  const tangents = xs.map((_, k) => {
    if (k === 0) return slopes[0]!;
    if (k === n - 1) return slopes[n - 2]!;
    const [before, after] = [slopes[k - 1]!, slopes[k]!];
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  // Limit the tangents so no segment overshoots its end points.
  for (let k = 0; k < n - 1; k++) {
    const d = slopes[k]!;
    if (d === 0) {
      tangents[k] = 0;
      tangents[k + 1] = 0;
      continue;
    }
    const a = tangents[k]! / d;
    const b = tangents[k + 1]! / d;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      tangents[k] = t * a * d;
      tangents[k + 1] = t * b * d;
    }
  }

  let k = 0;
  while (x > xs[k + 1]!) k++;
  const h = xs[k + 1]! - xs[k]!;
  const t = (x - xs[k]!) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return clamp01(
    (2 * t3 - 3 * t2 + 1) * ys[k]! +
      (t3 - 2 * t2 + t) * h * tangents[k]! +
      (-2 * t3 + 3 * t2) * ys[k + 1]! +
      (t3 - t2) * h * tangents[k + 1]!
  );
}

/** Returns a new stack with one curve set. null, or a straight line, removes it. */
export function withCurve(
  stack: EditStack,
  channel: CurveChannel,
  points: readonly CurvePoint[] | null
): EditStack {
  const curves: ToneCurves = { ...stack.curves };
  const normalized = points && normalizeCurve(points);
  if (normalized) curves[channel] = normalized;
  else delete curves[channel];

  const { curves: _, ...rest } = stack;
  return Object.keys(curves).length > 0 ? { ...rest, curves } : rest;
}

/** True when no curve changes anything. */
export function isCurvesNeutral(curves: ToneCurves | undefined): boolean {
  if (!curves) return true;
  return CURVE_CHANNELS.every((channel) => {
    const points = curves[channel];
    return !points || isIdentity(points);
  });
}

/**
 * Packs the curves into the vec4s applyCurves in the shaders reads: the first vec4's x is 1 when
 * any curve is set (the shader skips curves otherwise), then one vec4 per sample k with the rgb,
 * red, green and blue curves at input k / (CURVE_SAMPLES - 1).
 */
export function packCurves(curves: ToneCurves | undefined): number[] {
  if (isCurvesNeutral(curves)) return new Array(CURVES_UNIFORM_COUNT).fill(0);
  const packed = [1, 0, 0, 0];
  for (let k = 0; k < CURVE_SAMPLES; k++) {
    const x = k / (CURVE_SAMPLES - 1);
    for (const channel of CURVE_CHANNELS) {
      const points = curves?.[channel];
      packed.push(points ? evaluateCurve(points, x) : x);
    }
  }
  return packed;
}
