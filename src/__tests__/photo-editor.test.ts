import type { PhotoCanvasRef } from '../PhotoCanvas';
import { createEditStack } from '../edit-stack';
import { PhotoEditorController } from '../editor';

function fakeCanvas() {
  const calls: string[] = [];
  const canvas: PhotoCanvasRef = {
    setAdjustment: (key, value) => calls.push(`set ${key}=${value}`),
    setEdits: (stack) => calls.push(`edits ${JSON.stringify(stack.adjustments)}`),
    beginInteraction: () => calls.push('begin'),
    endInteraction: () => calls.push('end'),
  };
  return { canvas, calls };
}

describe('PhotoEditorController', () => {
  it('turns one drag into one undo step and previews every tick', () => {
    const editor = new PhotoEditorController();
    const { canvas, calls } = fakeCanvas();
    editor.attachCanvas(canvas);

    editor.beginGesture();
    editor.setAdjustment('exposure', 0.2);
    editor.setAdjustment('exposure', 0.5);
    expect(editor.getState().canUndo).toBe(false);
    expect(editor.getEdits().adjustments.exposure).toBe(0.5);
    editor.endGesture();

    expect(calls).toEqual(['begin', 'set exposure=0.2', 'set exposure=0.5', 'end']);
    expect(editor.getState().present.adjustments).toEqual({ exposure: 0.5 });
    expect(editor.getState().canUndo).toBe(true);

    editor.undo();
    expect(editor.getState().present.adjustments).toEqual({});
    expect(calls.at(-1)).toBe('edits {}');
  });

  it('commits each change made outside a gesture', () => {
    const editor = new PhotoEditorController();
    editor.setAdjustment('contrast', 0.3);
    editor.setFilter({ id: 'film', intensity: 0.8 });
    editor.undo();
    expect(editor.getState().present.filter).toBeNull();
    editor.undo();
    expect(editor.getState().present.adjustments).toEqual({});
    editor.redo();
    expect(editor.getState().present.adjustments).toEqual({ contrast: 0.3 });
  });

  it('does not add a step for a drag that ends where it started', () => {
    const editor = new PhotoEditorController();
    editor.beginGesture();
    editor.setAdjustment('warmth', 0.4);
    editor.setAdjustment('warmth', 0);
    editor.endGesture();
    expect(editor.getState().canUndo).toBe(false);
  });

  it('sends the clamped value to the canvas', () => {
    const editor = new PhotoEditorController();
    const { canvas, calls } = fakeCanvas();
    editor.attachCanvas(canvas);
    editor.setAdjustment('saturation', 5);
    expect(calls).toEqual(['set saturation=1']);
  });

  it('tracks unsaved changes', () => {
    const editor = new PhotoEditorController(createEditStack({ adjustments: { exposure: 1 } }));
    expect(editor.getState().isDirty).toBe(false);
    editor.setAdjustment('exposure', 0.5);
    expect(editor.getState().isDirty).toBe(true);
    editor.markSaved();
    expect(editor.getState().isDirty).toBe(false);
    editor.undo();
    expect(editor.getState().isDirty).toBe(true);
  });

  it('undo during a drag drops the drag and shows the history', () => {
    const editor = new PhotoEditorController();
    const { canvas, calls } = fakeCanvas();
    editor.setAdjustment('tint', 0.2);
    editor.attachCanvas(canvas);
    editor.beginGesture();
    editor.setAdjustment('tint', 0.9);
    editor.undo();
    editor.endGesture();
    expect(editor.getState().present.adjustments).toEqual({});
    expect(editor.getEdits().adjustments).toEqual({});
    expect(calls).toEqual(['begin', 'set tint=0.9', 'end', 'edits {}']);
  });

  it('reset clears the history and shows the original', () => {
    const editor = new PhotoEditorController();
    editor.setAdjustment('vignette', -0.5);
    editor.reset();
    const state = editor.getState();
    expect(state.present.adjustments).toEqual({});
    expect(state.canUndo).toBe(false);
    expect(state.isDirty).toBe(false);
  });

  it('notifies subscribers on commits, not on preview ticks', () => {
    const editor = new PhotoEditorController();
    const listener = jest.fn();
    editor.subscribe(listener);
    editor.beginGesture();
    editor.setAdjustment('shadows', 0.1);
    editor.setAdjustment('shadows', 0.2);
    expect(listener).not.toHaveBeenCalled();
    editor.endGesture();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
