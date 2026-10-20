import { BUILT_IN_FILTERS } from './catalog';
import { LOOK_UNIFORM_COUNT, packLook } from './looks';
import type { FilterDefinition } from './types';
import { packCurves } from '../edit-stack/curves';
import { packHsl } from '../edit-stack/hsl';
import type { EditStack, FilterRef } from '../edit-stack/types';

const filters = new Map<string, FilterDefinition>(BUILT_IN_FILTERS.map((f) => [f.id, f]));

/** Every filter the engine can render: the built-in ones, then registered ones. */
export function listFilters(): FilterDefinition[] {
  return [...filters.values()];
}

export function getFilter(id: string): FilterDefinition | undefined {
  return filters.get(id);
}

/**
 * Adds your own filters, or replaces a built-in one with the same id. Register them before
 * rendering a stack that uses them; a stack with an unknown filter id renders without a filter.
 */
export function registerFilters(definitions: FilterDefinition[]): void {
  for (const definition of definitions) {
    filters.set(definition.id, definition);
  }
}

/**
 * The edit stack as the native side reads it: the filter id resolved to shader numbers, and HSL
 * and the curves packed into the numbers applyHsl and applyCurves read.
 */
export type NativeEditStack = Omit<EditStack, 'filter' | 'hsl' | 'curves'> & {
  filter: (FilterRef & { uniforms: number[] }) | null;
  hsl: number[];
  curves: number[];
};

export function toNativeEdits(stack: EditStack): NativeEditStack {
  const hsl = packHsl(stack.hsl);
  const curves = packCurves(stack.curves);
  const definition = stack.filter && getFilter(stack.filter.id);
  if (!stack.filter || !definition || stack.filter.intensity <= 0) {
    return { ...stack, filter: null, hsl, curves };
  }
  const uniforms = packLook(definition.look, stack.filter.intensity);
  if (uniforms.length !== LOOK_UNIFORM_COUNT || !uniforms.every(Number.isFinite)) {
    throw new Error(`Filter "${definition.id}" has an invalid look`);
  }
  return { ...stack, filter: { ...stack.filter, uniforms }, hsl, curves };
}
