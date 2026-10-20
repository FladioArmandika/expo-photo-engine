import { createEditStack, withFilter } from '../edit-stack';
import { PhotoEditorController } from '../editor';
import {
  BUILT_IN_FILTERS,
  getFilter,
  listFilters,
  packLook,
  registerFilters,
  toNativeEdits,
} from '../filters';

describe('filters', () => {
  it('has unique ids and packs every built-in look into 32 finite numbers', () => {
    expect(new Set(BUILT_IN_FILTERS.map((f) => f.id)).size).toBe(BUILT_IN_FILTERS.length);
    for (const filter of BUILT_IN_FILTERS) {
      const packed = packLook(filter.look, 1);
      expect(packed).toHaveLength(32);
      expect(packed.every(Number.isFinite)).toBe(true);
    }
  });

  it('packs an empty look as no change, with intensity in the first row', () => {
    // prettier-ignore
    expect(packLook({}, 0.4)).toEqual([
      1, 0, 0, 0.4,
      0, 1, 0, 1,
      0, 0, 1, 0,
      1, 1, 1, 0,
      0, 0, 0, 0,
      1, 1, 1, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
  });

  it('resolves the filter id for the native side', () => {
    const stack = withFilter(createEditStack(), { id: 'film', intensity: 0.5 });
    const native = toNativeEdits(stack);
    expect(native.filter?.uniforms).toEqual(packLook(getFilter('film')!.look, 0.5));
    expect(native.adjustments).toBe(stack.adjustments);
  });

  it('drops unknown and zero-intensity filters', () => {
    expect(toNativeEdits(withFilter(createEditStack(), { id: 'nope', intensity: 1 })).filter).toBe(
      null
    );
    expect(toNativeEdits(withFilter(createEditStack(), { id: 'film', intensity: 0 })).filter).toBe(
      null
    );
  });

  it('lets apps add their own filters', () => {
    registerFilters([{ id: 'test-red', label: 'Red', look: { slope: [1.2, 1, 1] } }]);
    expect(listFilters().at(-1)?.id).toBe('test-red');
    expect(
      toNativeEdits(withFilter(createEditStack(), { id: 'test-red', intensity: 1 })).filter
    ).not.toBe(null);
  });
});

describe('filter intensity', () => {
  it('turns an intensity drag into one undo step and does nothing without a filter', () => {
    const editor = new PhotoEditorController();
    editor.setFilterIntensity(0.5);
    expect(editor.getState().canUndo).toBe(false);

    editor.setFilter({ id: 'mono', intensity: 1 });
    editor.beginGesture();
    editor.setFilterIntensity(-0.2);
    expect(editor.getEdits().filter).toEqual({ id: 'mono', intensity: 0 });
    editor.setFilterIntensity(0.6);
    editor.endGesture();
    expect(editor.getEdits().filter).toEqual({ id: 'mono', intensity: 0.6 });

    editor.undo();
    expect(editor.getEdits().filter).toEqual({ id: 'mono', intensity: 1 });
    editor.undo();
    expect(editor.getEdits().filter).toBe(null);
  });
});
