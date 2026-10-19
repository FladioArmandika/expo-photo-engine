import type { PhotoCanvasRef } from '../PhotoCanvas';
import { EditHistory, type HistoryState } from '../edit-stack/history';
import { createEditStack, withAdjustment, withCrop, withFilter } from '../edit-stack/operations';
import type { AdjustmentKey, Crop, EditStack, FilterRef } from '../edit-stack/types';

export type PhotoEditorState = HistoryState;

/**
 * Connects an EditHistory to a PhotoCanvas.
 *
 * During a gesture (a slider drag) values go straight to the canvas through its ref, with no
 * React render, and are collected in a draft. When the gesture ends the draft is committed as
 * one history step. Undo, redo and reset change the committed stack, which reaches the canvas
 * through its `edits` prop.
 *
 * usePhotoEditor wraps this for React. It is a plain class so it can be tested and used without
 * React.
 */
export class PhotoEditorController {
  readonly history: EditHistory;
  private canvas: PhotoCanvasRef | null = null;
  private draft: EditStack;
  private gestures = 0;

  constructor(initial: EditStack = createEditStack(), historyLimit?: number) {
    this.history = new EditHistory(initial, historyLimit);
    this.draft = initial;
  }

  getState = (): PhotoEditorState => this.history.getState();

  subscribe = (listener: () => void): (() => void) => this.history.subscribe(listener);

  /** Ref callback for PhotoCanvas. */
  attachCanvas = (canvas: PhotoCanvasRef | null): void => {
    this.canvas = canvas;
  };

  /** The stack including values from a gesture still in progress. Use this for export. */
  getEdits(): EditStack {
    return this.draft;
  }

  /** Call when a drag starts. Everything until endGesture() becomes one undo step. */
  beginGesture(): void {
    if (this.gestures++ === 0) this.canvas?.beginInteraction();
  }

  endGesture(): void {
    if (this.gestures === 0) return;
    if (--this.gestures === 0) {
      this.canvas?.endInteraction();
      this.history.commit(this.draft);
    }
  }

  /**
   * Sets one adjustment. Inside a gesture it only updates the preview; outside one it is
   * committed straight away as its own undo step.
   */
  setAdjustment(key: AdjustmentKey, value: number): void {
    this.draft = withAdjustment(this.draft, key, value);
    // Send the clamped value, so the preview never shows something the stack can't store.
    this.canvas?.setAdjustment(key, this.draft.adjustments[key] ?? 0);
    if (this.gestures === 0) this.history.commit(this.draft);
  }

  setCrop(crop: Crop | null): void {
    this.apply(withCrop(this.draft, crop));
  }

  setFilter(filter: FilterRef | null): void {
    this.apply(withFilter(this.draft, filter));
  }

  /** Replaces the whole stack as one undo step. */
  setEdits(next: EditStack): void {
    this.apply(next);
  }

  undo(): void {
    this.sync(this.history.undo());
  }

  redo(): void {
    this.sync(this.history.redo());
  }

  /** Starts over from `stack` (default: the original photo) with an empty history. */
  reset(stack: EditStack = createEditStack()): void {
    this.history.reset(stack);
    this.sync(stack);
  }

  markSaved(): void {
    this.history.markSaved();
  }

  private apply(next: EditStack) {
    this.draft = next;
    this.canvas?.setEdits(next);
    if (this.gestures === 0) this.history.commit(next);
  }

  // Undo/redo/reset abandon a gesture in progress: the history decides what is shown.
  private sync(stack: EditStack) {
    if (this.gestures > 0) {
      this.gestures = 0;
      this.canvas?.endInteraction();
    }
    this.draft = stack;
    this.canvas?.setEdits(stack);
  }
}
