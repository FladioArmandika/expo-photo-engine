import {
  createEditStack,
  isNeutral,
  migrateEditStack,
  packHsl,
  serializeEditStack,
  validateEditStack,
  withHsl,
} from '../edit-stack';
import { PhotoEditorController } from '../editor';
import { toNativeEdits } from '../filters';

describe('withHsl', () => {
  it('sets, clamps and removes values', () => {
    let stack = withHsl(createEditStack(), 'blue', 'luminance', -0.4);
    expect(stack.hsl).toEqual({ blue: { luminance: -0.4 } });
    stack = withHsl(stack, 'blue', 'saturation', 3);
    expect(stack.hsl).toEqual({ blue: { luminance: -0.4, saturation: 1 } });
    stack = withHsl(stack, 'blue', 'luminance', 0);
    stack = withHsl(stack, 'blue', 'saturation', 0);
    // Nothing left: the field goes away, so the stack equals a fresh one.
    expect(stack).not.toHaveProperty('hsl');
    expect(serializeEditStack(stack)).toBe(serializeEditStack(createEditStack()));
  });

  it('makes a stack non-neutral', () => {
    expect(isNeutral(withHsl(createEditStack(), 'red', 'hue', 0.2))).toBe(false);
  });
});

describe('HSL validation', () => {
  it('keeps valid values and drops neutral ones', () => {
    const result = validateEditStack({
      version: 1,
      crop: null,
      adjustments: {},
      filter: null,
      hsl: { red: { hue: 0.5, saturation: 0 }, green: { luminance: 0 } },
    });
    expect(result.ok && result.value.hsl).toEqual({ red: { hue: 0.5 } });
  });

  it('clamps, and warns about unknown colors and channels', () => {
    const result = validateEditStack({
      version: 1,
      adjustments: {},
      hsl: { blue: { saturation: -2, warmth: 1 }, teal: { hue: 1 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hsl).toEqual({ blue: { saturation: -1 } });
    expect(result.warnings).toEqual([
      'hsl.blue.saturation clamped from -2 to -1',
      'dropped unknown hsl channel "blue.warmth"',
      'dropped unknown hsl color "teal"',
    ]);
  });

  it('rejects values that are not numbers', () => {
    const result = validateEditStack({ version: 1, adjustments: {}, hsl: { red: { hue: 'x' } } });
    expect(result.ok).toBe(false);
  });

  it('loads stacks saved without HSL', () => {
    const stack = migrateEditStack('{"version":1,"crop":null,"adjustments":{},"filter":null}');
    expect(stack).not.toHaveProperty('hsl');
  });
});

describe('packHsl', () => {
  it('is all zeros when nothing is set, so the shader skips HSL', () => {
    expect(packHsl(undefined)).toEqual(new Array(28).fill(0));
    expect(packHsl({ red: { hue: 0 } })).toEqual(new Array(28).fill(0));
  });

  it('lays out hue, saturation and luminance per color', () => {
    const packed = packHsl({
      red: { hue: 0.5 },
      magenta: { luminance: -1 },
      aqua: { saturation: 1 },
    });
    expect(packed.slice(0, 4)).toEqual([1, 0, 0, 0]);
    expect(packed[4]).toBe(0.5); // hue, red
    expect(packed[12 + 4]).toBe(1); // saturation, aqua
    expect(packed[20 + 7]).toBe(-1); // luminance, magenta
  });

  it('reaches the native stack', () => {
    const native = toNativeEdits(withHsl(createEditStack(), 'green', 'hue', 0.25));
    expect(native.hsl[4 + 3]).toBe(0.25);
    expect(native).not.toHaveProperty('hsl.green');
  });
});

describe('PhotoEditorController.setHsl', () => {
  it('previews during a drag and commits one undo step', () => {
    const editor = new PhotoEditorController();
    const shown: unknown[] = [];
    editor.attachCanvas({
      setAdjustment: () => {},
      setEdits: (stack) => shown.push(stack.hsl),
      beginInteraction: () => {},
      endInteraction: () => {},
    });
    editor.beginGesture();
    editor.setHsl('orange', 'saturation', -0.3);
    editor.setHsl('orange', 'saturation', -0.6);
    editor.endGesture();
    expect(shown).toEqual([{ orange: { saturation: -0.3 } }, { orange: { saturation: -0.6 } }]);
    expect(editor.getState().present.hsl).toEqual({ orange: { saturation: -0.6 } });
    editor.undo();
    expect(editor.getState().present).not.toHaveProperty('hsl');
  });
});
