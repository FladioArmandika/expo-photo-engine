import {
  ADJUSTMENT_KEYS,
  ADJUSTMENTS,
  createCrop,
  createEditStack,
  EditHistory,
  EditStackError,
  editStacksEqual,
  flipHorizontal,
  flipVertical,
  isNeutral,
  migrateEditStack,
  rotateRight,
  serializeEditStack,
  validateEditStack,
  withAdjustment,
  withCrop,
  withFilter,
  withStraighten,
  type Crop,
} from '../edit-stack';

const crop: Crop = {
  rect: [0.1, 0.1, 0.8, 0.6],
  rotation: 90,
  straighten: 2.5,
  flipH: false,
  flipV: false,
  aspect: '4:3',
};

describe('ADJUSTMENTS', () => {
  it('has metadata for every key, neutral 0 inside each range', () => {
    for (const key of ADJUSTMENT_KEYS) {
      const info = ADJUSTMENTS[key];
      expect(info.default).toBe(0);
      expect(info.min).toBeLessThanOrEqual(0);
      expect(info.max).toBeGreaterThan(0);
    }
  });
});

describe('validateEditStack', () => {
  it('accepts a full stack unchanged', () => {
    const stack = createEditStack({
      crop,
      adjustments: { exposure: 0.5, contrast: -0.2 },
      filter: { id: 'warm', intensity: 0.7 },
    });
    const result = validateEditStack(stack);
    expect(result).toEqual({ ok: true, value: stack, warnings: [] });
  });

  it('clamps out-of-range values and drops unknown keys with warnings', () => {
    const result = validateEditStack({
      version: 1,
      crop: null,
      adjustments: { exposure: 9, saturation: -4, clarity: 0.3 },
      filter: { id: 'warm', intensity: 1.5 },
      extra: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjustments).toEqual({ exposure: 3, saturation: -1 });
    expect(result.value.filter).toEqual({ id: 'warm', intensity: 1 });
    expect(result.warnings).toHaveLength(5);
  });

  it('omits neutral adjustments so equal edits serialize identically', () => {
    const result = validateEditStack({ version: 1, adjustments: { exposure: 0, tint: 0.1 } });
    expect(result.ok && result.value.adjustments).toEqual({ tint: 0.1 });
  });

  it('fills defaults for missing optional fields', () => {
    const result = validateEditStack({ version: 1 });
    expect(result).toEqual({ ok: true, value: createEditStack(), warnings: [] });
  });

  it.each([
    [null, 'edit stack must be an object'],
    [{ version: 2 }, 'unsupported version 2'],
    [
      { version: 1, adjustments: { exposure: 'x' } },
      'adjustments.exposure must be a finite number',
    ],
    [
      { version: 1, adjustments: { exposure: NaN } },
      'adjustments.exposure must be a finite number',
    ],
    [
      { version: 1, crop: { ...crop, rect: [0.5, 0, 0.6, 1] } },
      'crop.rect must lie inside the image (0..1)',
    ],
    [
      { version: 1, crop: { ...crop, rect: [0, 0, 0, 1] } },
      'crop.rect width and height must be > 0',
    ],
    [{ version: 1, crop: { ...crop, rotation: 45 } }, 'crop.rotation must be 0, 90, 180 or 270'],
    [
      { version: 1, crop: { ...crop, aspect: 'wide' } },
      'crop.aspect must be "free", "original" or "W:H"',
    ],
    [{ version: 1, filter: { id: '' } }, 'filter.id must be a non-empty string'],
  ])('rejects %j', (input, error) => {
    const result = validateEditStack(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain(error);
  });

  it('clamps straighten to ±45°', () => {
    const result = validateEditStack({ version: 1, crop: { ...crop, straighten: -60 } });
    expect(result.ok && result.value.crop?.straighten).toBe(-45);
  });
});

describe('migrateEditStack', () => {
  it('round-trips through JSON', () => {
    const stack = createEditStack({ crop, adjustments: { exposure: -1.25 } });
    expect(migrateEditStack(serializeEditStack(stack))).toEqual(stack);
    expect(migrateEditStack(JSON.parse(JSON.stringify(stack)))).toEqual(stack);
  });

  it('rejects stacks from a newer library version with a clear message', () => {
    expect(() => migrateEditStack({ version: 3 })).toThrow(/newer than this library supports/);
  });

  it('throws EditStackError with details for invalid data', () => {
    try {
      migrateEditStack({ version: 1, adjustments: { exposure: 'bright' } });
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(EditStackError);
      expect((e as EditStackError).details).toEqual([
        'adjustments.exposure must be a finite number',
      ]);
    }
  });

  it.each(['{not json', '[]', 42, { version: 0 }, { version: 1.5 }])('rejects %j', (input) => {
    expect(() => migrateEditStack(input)).toThrow(EditStackError);
  });
});

describe('serializeEditStack', () => {
  it('is independent of key insertion order', () => {
    const a = createEditStack({ adjustments: { exposure: 1, contrast: 0.5 } });
    const b = createEditStack({ adjustments: { contrast: 0.5, exposure: 1 } });
    expect(serializeEditStack(a)).toBe(serializeEditStack(b));
    expect(editStacksEqual(a, b)).toBe(true);
  });
});

describe('operations', () => {
  it('withAdjustment clamps, removes neutral values and does not mutate', () => {
    const base = createEditStack();
    const bright = withAdjustment(base, 'exposure', 10);
    expect(bright.adjustments).toEqual({ exposure: 3 });
    expect(base.adjustments).toEqual({});
    expect(withAdjustment(bright, 'exposure', 0).adjustments).toEqual({});
  });

  it('isNeutral', () => {
    expect(isNeutral(createEditStack())).toBe(true);
    expect(isNeutral(withAdjustment(createEditStack(), 'vignette', -0.3))).toBe(false);
    expect(isNeutral(withFilter(createEditStack(), { id: 'warm', intensity: 0 }))).toBe(true);
    expect(isNeutral(withCrop(createEditStack(), crop))).toBe(false);
    expect(
      isNeutral(
        withCrop(createEditStack(), { ...crop, rect: [0, 0, 1, 1], rotation: 0, straighten: 0 })
      )
    ).toBe(true);
  });
});

describe('EditHistory', () => {
  const at = (exposure: number) => withAdjustment(createEditStack(), 'exposure', exposure);

  it('undoes and redoes one commit at a time', () => {
    const history = new EditHistory(at(0));
    history.commit(at(1));
    history.commit(at(2));
    expect(history.undo()).toEqual(at(1));
    expect(history.undo()).toEqual(at(0));
    expect(history.getState().canUndo).toBe(false);
    expect(history.undo()).toEqual(at(0));
    expect(history.redo()).toEqual(at(1));
    expect(history.getState()).toMatchObject({ canUndo: true, canRedo: true });
  });

  it('a new commit clears the redo stack', () => {
    const history = new EditHistory(at(0));
    history.commit(at(1));
    history.undo();
    history.commit(at(-1));
    expect(history.getState().canRedo).toBe(false);
    expect(history.redo()).toEqual(at(-1));
  });

  it('ignores commits equal to the current stack', () => {
    const history = new EditHistory(at(0));
    const listener = jest.fn();
    history.subscribe(listener);
    history.commit(at(0));
    expect(listener).not.toHaveBeenCalled();
    expect(history.getState().canUndo).toBe(false);
  });

  it('tracks dirty state against the last save', () => {
    const history = new EditHistory(at(0));
    expect(history.getState().isDirty).toBe(false);
    history.commit(at(1));
    expect(history.getState().isDirty).toBe(true);
    history.markSaved();
    expect(history.getState().isDirty).toBe(false);
    history.undo();
    expect(history.getState().isDirty).toBe(true);
  });

  it('keeps at most `limit` undo steps', () => {
    const history = new EditHistory(at(0), 3);
    for (let i = 1; i <= 5; i++) history.commit(at(i / 10));
    let steps = 0;
    while (history.getState().canUndo) {
      history.undo();
      steps++;
    }
    expect(steps).toBe(3);
    expect(history.getState().present).toEqual(at(0.2));
  });

  it('returns a stable state object between changes (useSyncExternalStore contract)', () => {
    const history = new EditHistory(at(0));
    expect(history.getState()).toBe(history.getState());
    const before = history.getState();
    history.commit(at(1));
    expect(history.getState()).not.toBe(before);
  });

  it('reset starts a clean history', () => {
    const history = new EditHistory(at(0));
    history.commit(at(1));
    history.reset(at(2));
    expect(history.getState()).toEqual({
      present: at(2),
      canUndo: false,
      canRedo: false,
      isDirty: false,
    });
  });
});

describe('crop geometry operations', () => {
  // Where a point of the shown (rotated, flipped) image comes from in the original photo, both
  // normalized 0..1. Square photo, so the aspect ratio drops out. Mirrors cropToSource in the shaders.
  const toSource = (c: Crop, [u, v]: [number, number]): string => {
    if (c.flipH) u = 1 - u;
    if (c.flipV) v = 1 - v;
    let p: [number, number] = [u, v];
    if (c.rotation === 90) p = [v, 1 - u];
    if (c.rotation === 180) p = [1 - u, 1 - v];
    if (c.rotation === 270) p = [1 - v, u];
    return p.map((n) => n.toFixed(6)).join(',');
  };
  const cornersInSource = (c: Crop) => {
    const [x, y, w, h] = c.rect;
    const corners: [number, number][] = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ];
    return corners.map((p) => toSource(c, p)).sort();
  };
  const start = withCrop(createEditStack(), {
    ...createCrop({ rect: [0.1, 0.2, 0.3, 0.5], aspect: '3:5' }),
    straighten: 4,
  });

  it.each([
    ['rotateRight', rotateRight],
    ['flipHorizontal', flipHorizontal],
    ['flipVertical', flipVertical],
  ])('%s keeps the crop on the same part of the photo', (_, op) => {
    let stack = start;
    for (let i = 0; i < 3; i++) {
      const next = op(stack);
      expect(cornersInSource(next.crop!)).toEqual(cornersInSource(stack.crop!));
      stack = next;
    }
  });

  it('rotateRight swaps the aspect and comes back after four turns', () => {
    const once = rotateRight(start);
    expect(once.crop!.rotation).toBe(90);
    expect(once.crop!.aspect).toBe('5:3');
    const four = rotateRight(rotateRight(rotateRight(once)));
    expect(editStacksEqual(four, start)).toBe(true);
  });

  it('flips mirror the straighten angle and undo themselves', () => {
    expect(flipHorizontal(start).crop!.straighten).toBe(-4);
    expect(editStacksEqual(flipHorizontal(flipHorizontal(start)), start)).toBe(true);
    expect(editStacksEqual(flipVertical(flipVertical(start)), start)).toBe(true);
  });

  it('works on a stack without a crop and clamps straighten', () => {
    expect(rotateRight(createEditStack()).crop!.rect).toEqual([0, 0, 1, 1]);
    expect(withStraighten(createEditStack(), 90).crop!.straighten).toBe(45);
    expect(validateEditStack(rotateRight(start)).ok).toBe(true);
  });
});
