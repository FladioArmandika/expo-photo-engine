import {
  CURVES_UNIFORM_COUNT,
  createEditStack,
  evaluateCurve,
  isNeutral,
  normalizeCurve,
  packCurves,
  serializeEditStack,
  validateEditStack,
  withCurve,
  type CurvePoint,
} from '../edit-stack';
import { PhotoEditorController } from '../editor';
import { toNativeEdits } from '../filters';
import { insertCurvePoint, moveCurvePoint, removeCurvePoint } from '../curves/editing';

const sCurve: CurvePoint[] = [
  [0, 0],
  [0.25, 0.18],
  [0.75, 0.84],
  [1, 1],
];

describe('evaluateCurve', () => {
  it('passes through every point', () => {
    for (const [x, y] of sCurve) expect(evaluateCurve(sCurve, x)).toBeCloseTo(y, 12);
  });

  it('never overshoots between points', () => {
    const steep: CurvePoint[] = [
      [0, 0],
      [0.45, 0.05],
      [0.55, 0.95],
      [1, 1],
    ];
    let previous = -1;
    for (let i = 0; i <= 200; i++) {
      const y = evaluateCurve(steep, i / 200);
      expect(y).toBeGreaterThanOrEqual(previous);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      previous = y;
    }
  });

  it('is flat outside the first and last point', () => {
    const lifted: CurvePoint[] = [
      [0.2, 0.1],
      [0.8, 0.9],
    ];
    expect(evaluateCurve(lifted, 0)).toBe(0.1);
    expect(evaluateCurve(lifted, 1)).toBe(0.9);
  });
});

describe('normalizeCurve', () => {
  it('clamps, sorts and merges close points', () => {
    expect(
      normalizeCurve([
        [1.2, 1],
        [0.5, 0.6],
        [0, -0.1],
        [0.505, 0.7],
      ])
    ).toEqual([
      [0, 0],
      [0.505, 0.7],
      [1, 1],
    ]);
  });

  it('returns null for a straight line', () => {
    expect(
      normalizeCurve([
        [0, 0],
        [0.5, 0.5],
        [1, 1],
      ])
    ).toBeNull();
  });

  it('keeps at most 16 points', () => {
    const many = Array.from({ length: 40 }, (_, i): CurvePoint => [i / 39, (i / 39) ** 2]);
    expect(normalizeCurve(many)).toHaveLength(16);
  });
});

describe('withCurve', () => {
  it('sets and removes curves', () => {
    let stack = withCurve(createEditStack(), 'rgb', sCurve);
    expect(stack.curves).toEqual({ rgb: sCurve });
    expect(isNeutral(stack)).toBe(false);
    stack = withCurve(stack, 'rgb', [
      [0, 0],
      [1, 1],
    ]);
    // Nothing left: the field goes away, so the stack equals a fresh one.
    expect(stack).not.toHaveProperty('curves');
    expect(serializeEditStack(stack)).toBe(serializeEditStack(createEditStack()));
  });
});

describe('packCurves', () => {
  it('is all zeros without curves', () => {
    expect(packCurves(undefined)).toEqual(new Array(CURVES_UNIFORM_COUNT).fill(0));
  });

  it('packs a flag, then the four curves per sample', () => {
    const packed = packCurves({
      blue: [
        [0, 1],
        [1, 0],
      ],
    });
    expect(packed).toHaveLength(CURVES_UNIFORM_COUNT);
    expect(packed.slice(0, 4)).toEqual([1, 0, 0, 0]);
    // Sample 8 is input 0.25: unchanged for rgb, red and green, inverted for blue.
    expect(packed.slice(4 + 8 * 4, 4 + 9 * 4)).toEqual([0.25, 0.25, 0.25, 0.75]);
  });

  it('reaches the native side', () => {
    const native = toNativeEdits(withCurve(createEditStack(), 'red', sCurve));
    expect(native.curves).toHaveLength(CURVES_UNIFORM_COUNT);
    expect(native.curves[0]).toBe(1);
  });
});

describe('validateEditStack curves', () => {
  it('cleans up points and drops unknown channels', () => {
    const result = validateEditStack({
      version: 1,
      crop: null,
      adjustments: {},
      filter: null,
      curves: {
        rgb: [
          [1, 1],
          [0, 0.1],
        ],
        luma: [[0, 0]],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.curves).toEqual({
      rgb: [
        [0, 0.1],
        [1, 1],
      ],
    });
    expect(result.warnings).toEqual([
      'curves.rgb was cleaned up (clamped, sorted or merged points)',
      'dropped unknown curve "luma"',
    ]);
  });

  it('rejects points that are not number pairs', () => {
    const result = validateEditStack({
      version: 1,
      crop: null,
      adjustments: {},
      filter: null,
      curves: { red: [[0, 'a']] },
    });
    expect(result.ok).toBe(false);
  });

  it('leaves out straight-line curves', () => {
    const result = validateEditStack({
      version: 1,
      crop: null,
      adjustments: {},
      filter: null,
      curves: {
        green: [
          [0, 0],
          [1, 1],
        ],
      },
    });
    expect(result.ok && result.value).not.toHaveProperty('curves');
  });
});

describe('curve editing', () => {
  it('inserts a point in order', () => {
    const added = insertCurvePoint(
      [
        [0, 0],
        [1, 1],
      ],
      [0.4, 0.6]
    );
    expect(added).toEqual({
      points: [
        [0, 0],
        [0.4, 0.6],
        [1, 1],
      ],
      index: 1,
    });
  });

  it('does not insert on top of another point', () => {
    expect(insertCurvePoint(sCurve, [0.251, 0.5])).toBeNull();
  });

  it('keeps a dragged point between its neighbors', () => {
    const moved = moveCurvePoint(sCurve, 1, [0.9, 1.3]);
    expect(moved[1]![0]).toBeLessThan(0.75);
    expect(moved[1]![1]).toBe(1);
  });

  it('never removes the last two points', () => {
    const line: CurvePoint[] = [
      [0, 0],
      [1, 1],
    ];
    expect(removeCurvePoint(line, 0)).toEqual(line);
    expect(removeCurvePoint(sCurve, 1)).toHaveLength(3);
  });
});

describe('PhotoEditorController.setCurve', () => {
  it('is one undo step per gesture', () => {
    const editor = new PhotoEditorController();
    editor.beginGesture();
    editor.setCurve('rgb', [
      [0, 0],
      [0.5, 0.6],
      [1, 1],
    ]);
    editor.setCurve('rgb', [
      [0, 0],
      [0.5, 0.7],
      [1, 1],
    ]);
    editor.endGesture();
    expect(editor.getEdits().curves?.rgb?.[1]).toEqual([0.5, 0.7]);
    editor.undo();
    expect(editor.getEdits()).not.toHaveProperty('curves');
  });
});
