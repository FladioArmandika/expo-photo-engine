import {
  IDENTITY_CURVE,
  MAX_CURVE_POINTS,
  MIN_CURVE_POINT_GAP,
  type CurvePoint,
} from '../edit-stack/curves';

/**
 * Points closer than this along the input axis can't be dragged past each other. A bit wider than
 * MIN_CURVE_POINT_GAP so normalizeCurve never merges two points while one is being dragged.
 */
export const CURVE_DRAG_GAP = MIN_CURVE_POINT_GAP * 2;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** The points to draw for a curve: a straight line when it isn't set. */
export function curveOrIdentity(points: readonly CurvePoint[] | null | undefined): CurvePoint[] {
  return (points ?? IDENTITY_CURVE).map(([x, y]) => [x, y]);
}

/**
 * Index of the point under a touch, or -1. `x` and `y` are normalized like the points (y up), and
 * `radius` is the touch radius in the same units along each axis.
 */
export function hitCurvePoint(
  points: readonly CurvePoint[],
  x: number,
  y: number,
  radius: { x: number; y: number }
): number {
  let best = -1;
  let bestDistance = 1;
  points.forEach(([px, py], i) => {
    const distance = ((px - x) / radius.x) ** 2 + ((py - y) / radius.y) ** 2;
    if (distance <= bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Adds a point, keeping the list sorted. Returns null when the curve already has
 * MAX_CURVE_POINTS or the new point would sit on top of another one.
 */
export function insertCurvePoint(
  points: readonly CurvePoint[],
  point: CurvePoint
): { points: CurvePoint[]; index: number } | null {
  if (points.length >= MAX_CURVE_POINTS) return null;
  const [x, y] = [clamp(point[0], 0, 1), clamp(point[1], 0, 1)];
  if (points.some(([px]) => Math.abs(px - x) < CURVE_DRAG_GAP)) return null;
  const index = points.filter(([px]) => px < x).length;
  const next = points.map(([px, py]): CurvePoint => [px, py]);
  next.splice(index, 0, [x, y]);
  return { points: next, index };
}

/** Moves one point, kept inside 0..1 and between its neighbors so the order never changes. */
export function moveCurvePoint(
  points: readonly CurvePoint[],
  index: number,
  point: CurvePoint
): CurvePoint[] {
  const before = points[index - 1];
  const after = points[index + 1];
  const min = before ? before[0] + CURVE_DRAG_GAP : 0;
  const max = after ? after[0] - CURVE_DRAG_GAP : 1;
  const next = points.map(([px, py]): CurvePoint => [px, py]);
  next[index] = [clamp(point[0], min, max), clamp(point[1], 0, 1)];
  return next;
}

/** Removes one point. The last two points are never removed. */
export function removeCurvePoint(points: readonly CurvePoint[], index: number): CurvePoint[] {
  const next = points.map(([px, py]): CurvePoint => [px, py]);
  if (next.length > 2) next.splice(index, 1);
  return next;
}
