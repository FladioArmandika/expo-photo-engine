import { isCurvesNeutral } from './curves';
import { isHslNeutral } from './hsl';
import { serializeEditStack } from './migrate';
import type { AdjustmentKey, Crop, EditStack, FilterRef } from './types';
import { clampAdjustment } from './validate';

/** An unedited photo. */
export function createEditStack(init: Partial<Omit<EditStack, 'version'>> = {}): EditStack {
  const stack: EditStack = {
    version: 1,
    crop: init.crop ?? null,
    adjustments: { ...init.adjustments },
    filter: init.filter ?? null,
  };
  if (!isHslNeutral(init.hsl)) stack.hsl = init.hsl;
  if (!isCurvesNeutral(init.curves)) stack.curves = init.curves;
  return stack;
}

/** Returns a new stack with one adjustment set (clamped; 0 removes the key). */
export function withAdjustment(stack: EditStack, key: AdjustmentKey, value: number): EditStack {
  const adjustments = { ...stack.adjustments };
  const clamped = clampAdjustment(key, value);
  if (clamped === 0) delete adjustments[key];
  else adjustments[key] = clamped;
  return { ...stack, adjustments };
}

export function withCrop(stack: EditStack, crop: Crop | null): EditStack {
  return { ...stack, crop };
}

/** No crop, rotation or flip: the whole photo. */
export function createCrop(init: Partial<Crop> = {}): Crop {
  return {
    rect: [0, 0, 1, 1],
    rotation: 0,
    straighten: 0,
    flipH: false,
    flipV: false,
    aspect: 'free',
    ...init,
  };
}

/** Turns the photo a quarter turn clockwise. The crop turns with it. */
export function rotateRight(stack: EditStack): EditStack {
  const c = stack.crop ?? createCrop();
  const [x, y, w, h] = c.rect;
  // The flips are applied after the rotation, so turning swaps which axis each one mirrors.
  return withCrop(stack, {
    ...c,
    rect: [tidy(1 - y - h), x, h, w],
    rotation: ((c.rotation + 90) % 360) as Crop['rotation'],
    flipH: c.flipV,
    flipV: c.flipH,
    aspect: swapAspect(c.aspect),
  });
}

/** Mirrors the photo left-right as it is currently shown. The crop is mirrored with it. */
export function flipHorizontal(stack: EditStack): EditStack {
  const c = stack.crop ?? createCrop();
  const [x, y, w, h] = c.rect;
  return withCrop(stack, {
    ...c,
    rect: [tidy(1 - x - w), y, w, h],
    flipH: !c.flipH,
    straighten: -c.straighten || 0,
  });
}

/** Mirrors the photo top-bottom as it is currently shown. The crop is mirrored with it. */
export function flipVertical(stack: EditStack): EditStack {
  const c = stack.crop ?? createCrop();
  const [x, y, w, h] = c.rect;
  return withCrop(stack, {
    ...c,
    rect: [x, tidy(1 - y - h), w, h],
    flipV: !c.flipV,
    straighten: -c.straighten || 0,
  });
}

/** Sets the fine rotation in degrees, clamped to -45..45. */
export function withStraighten(stack: EditStack, degrees: number): EditStack {
  const c = stack.crop ?? createCrop();
  return withCrop(stack, { ...c, straighten: Math.min(45, Math.max(-45, degrees)) });
}

// Rounds away float noise such as 1 - 0.6 - 0.3 = 0.09999999999999998, so that rotating four
// times or flipping twice gives back exactly the stack you started with.
function tidy(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

function swapAspect(aspect: Crop['aspect']): Crop['aspect'] {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  return match ? (`${match[2]}:${match[1]}` as Crop['aspect']) : aspect;
}

export function withFilter(stack: EditStack, filter: FilterRef | null): EditStack {
  return { ...stack, filter };
}

/** True when the stack would render the original photo unchanged. */
export function isNeutral(stack: EditStack): boolean {
  const noAdjustments = Object.values(stack.adjustments).every((v) => v === undefined || v === 0);
  const noFilter = stack.filter === null || stack.filter.intensity === 0;
  const c = stack.crop;
  const noCrop =
    c === null ||
    (c.rotation === 0 &&
      c.straighten === 0 &&
      !c.flipH &&
      !c.flipV &&
      c.rect[0] === 0 &&
      c.rect[1] === 0 &&
      c.rect[2] === 1 &&
      c.rect[3] === 1);
  return (
    noAdjustments && noFilter && noCrop && isHslNeutral(stack.hsl) && isCurvesNeutral(stack.curves)
  );
}

export function editStacksEqual(a: EditStack, b: EditStack): boolean {
  return serializeEditStack(a) === serializeEditStack(b);
}
