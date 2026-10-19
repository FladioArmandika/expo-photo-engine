import { serializeEditStack } from './migrate';
import type { AdjustmentKey, Crop, EditStack, FilterRef } from './types';
import { clampAdjustment } from './validate';

/** An unedited photo. */
export function createEditStack(init: Partial<Omit<EditStack, 'version'>> = {}): EditStack {
  return {
    version: 1,
    crop: init.crop ?? null,
    adjustments: { ...init.adjustments },
    filter: init.filter ?? null,
  };
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
  return noAdjustments && noFilter && noCrop;
}

export function editStacksEqual(a: EditStack, b: EditStack): boolean {
  return serializeEditStack(a) === serializeEditStack(b);
}
