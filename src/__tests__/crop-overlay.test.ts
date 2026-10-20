import {
  boxToRect,
  cropEditingView,
  dragCropBox,
  fitFrame,
  hitTest,
  rectToBox,
  shownAspect,
  withCropAspect,
} from '../crop/geometry';
import { createCrop, createEditStack, rotateRight, withCrop } from '../edit-stack';
import { PhotoEditorController } from '../editor';

const bounds = { x: 0, y: 0, width: 300, height: 200 };
const start = { x: 100, y: 50, width: 100, height: 100 };

describe('crop box geometry', () => {
  it('fits the photo into the view', () => {
    expect(fitFrame(1.5, 300, 300)).toEqual({ x: 0, y: 50, width: 300, height: 200 });
    expect(fitFrame(0.5, 300, 300, 10)).toEqual({ x: 80, y: 10, width: 140, height: 280 });
  });

  it('uses the turned size after a quarter turn', () => {
    const crop = rotateRight(createEditStack()).crop;
    expect(shownAspect(crop, 4000, 3000)).toBe(0.75);
  });

  it('finds corners, edges and the inside', () => {
    expect(hitTest(start, 102, 48)).toBe('topLeft');
    expect(hitTest(start, 200, 100)).toBe('right');
    expect(hitTest(start, 150, 100)).toBe('move');
    expect(hitTest(start, 10, 10)).toBe(null);
  });

  it('moves the box but keeps it inside the photo', () => {
    expect(dragCropBox(start, 'move', 500, -20, bounds, null)).toEqual({ ...start, x: 200, y: 30 });
  });

  it('resizes freely, stopping at the edges and the minimum size', () => {
    expect(dragCropBox(start, 'bottomRight', 30, 500, bounds, null)).toEqual({
      x: 100,
      y: 50,
      width: 130,
      height: 150,
    });
    expect(dragCropBox(start, 'left', 90, 0, bounds, null)).toEqual({
      x: 160,
      y: 50,
      width: 40,
      height: 100,
    });
  });

  it('keeps the aspect ratio with the opposite corner fixed', () => {
    const box = dragCropBox(start, 'topLeft', -40, -10, bounds, 1);
    expect(box).toEqual({ x: 60, y: 10, width: 140, height: 140 });
    // Bigger than the room above allows: limited by the top edge.
    expect(dragCropBox(start, 'topLeft', -90, -90, bounds, 1)).toEqual({
      x: 50,
      y: 0,
      width: 150,
      height: 150,
    });
  });

  it('grows an edge about the middle when the aspect is locked', () => {
    expect(dragCropBox(start, 'right', 20, 0, bounds, 1)).toEqual({
      x: 100,
      y: 40,
      width: 120,
      height: 120,
    });
  });

  it('converts between boxes and normalized rects', () => {
    const frame = { x: 10, y: 20, width: 200, height: 100 };
    const rect = [0.1, 0.2, 0.5, 0.6] as [number, number, number, number];
    expect(boxToRect(rectToBox(rect, frame), frame)).toEqual(rect);
  });
});

describe('crop editing', () => {
  it('sets an aspect as the largest box of that shape around the current center', () => {
    // 4000x3000 photo, square crop: 3000x3000 = 0.75 x 1 of the photo.
    const square = withCropAspect(createEditStack(), '1:1', 4000, 3000).crop!;
    expect(square.aspect).toBe('1:1');
    expect(square.rect).toEqual([0.125, 0, 0.75, 1]);
    const free = withCropAspect(withCrop(createEditStack(), square), 'free', 4000, 3000).crop!;
    expect(free.rect).toEqual(square.rect);
  });

  it('shows the whole photo while cropping without touching the edits', () => {
    const stack = withCrop(
      createEditStack(),
      createCrop({ rect: [0.1, 0.1, 0.5, 0.5], rotation: 90 })
    );
    expect(cropEditingView(stack).crop).toEqual({ ...stack.crop, rect: [0, 0, 1, 1] });

    const editor = new PhotoEditorController(stack);
    const shown: unknown[] = [];
    editor.attachCanvas({
      setAdjustment: () => {},
      setEdits: (s) => shown.push(s.crop?.rect),
      beginInteraction: () => {},
      endInteraction: () => {},
    });
    editor.setCropping(true);
    expect(editor.getState().cropping).toBe(true);
    editor.setCrop(createCrop({ rect: [0, 0, 0.5, 0.5] }));
    editor.setCropping(false);
    expect(shown).toEqual([
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 0.5, 0.5],
    ]);
    expect(editor.getEdits().crop?.rect).toEqual([0, 0, 0.5, 0.5]);
  });
});
