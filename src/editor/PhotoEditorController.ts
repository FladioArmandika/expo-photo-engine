import type { PhotoCanvasRef } from '../PhotoCanvas';
import { cropEditingView } from '../crop/geometry';
import { EditHistory, type HistoryState } from '../edit-stack/history';
import { createEditStack, withAdjustment, withCrop, withFilter } from '../edit-stack/operations';
import type { AdjustmentKey, Crop, EditStack, FilterRef } from '../edit-stack/types';

export type PhotoEditorState = HistoryState & {
  /** True while the crop is being edited: the canvas shows the whole photo. */
  cropping: boolean;
  /** True while the canvas shows the photo before edits (see setComparing). */
  comparing: boolean;
};

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
  private cropping = false;
  private comparing = false;
  private state: PhotoEditorState;
  private listeners = new Set<() => void>();

  constructor(initial: EditStack = createEditStack(), historyLimit?: number) {
    this.history = new EditHistory(initial, historyLimit);
    this.draft = initial;
    this.state = { ...this.history.getState(), cropping: false, comparing: false };
    this.history.subscribe(() => this.emit());
  }

  getState = (): PhotoEditorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

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
    // While comparing the canvas shows the original; it catches up when comparing ends.
    if (!this.comparing) this.canvas?.setAdjustment(key, this.draft.adjustments[key] ?? 0);
    if (this.gestures === 0) this.history.commit(this.draft);
  }

  /**
   * Turns crop editing on or off. While on, the canvas shows the whole photo (still rotated,
   * flipped and straightened) so a CropOverlay can be drawn over it. The edits are unchanged.
   */
  setCropping(cropping: boolean): void {
    if (cropping === this.cropping) return;
    this.cropping = cropping;
    this.canvas?.setEdits(this.view(this.draft));
    this.emit();
  }

  /**
   * Shows the photo before edits (on) or with them (off), for a hold-to-compare control.
   * Only the look is dropped: adjustments and filter. The crop, rotation and straightening stay,
   * so the two views line up and the difference is easy to see. The edits are unchanged.
   */
  setComparing(comparing: boolean): void {
    if (comparing === this.comparing) return;
    this.comparing = comparing;
    this.canvas?.setEdits(this.view(this.draft));
    this.emit();
  }

  /** The stack as the canvas should show it. */
  view(stack: EditStack): EditStack {
    const shown = this.comparing ? { ...stack, adjustments: {}, filter: null } : stack;
    return this.cropping ? cropEditingView(shown) : shown;
  }

  setCrop(crop: Crop | null): void {
    this.apply(withCrop(this.draft, crop));
  }

  setFilter(filter: FilterRef | null): void {
    this.apply(withFilter(this.draft, filter));
  }

  /** Changes the strength of the current filter, 0..1. Does nothing without a filter. */
  setFilterIntensity(intensity: number): void {
    const filter = this.draft.filter;
    if (!filter) return;
    this.apply(withFilter(this.draft, { ...filter, intensity: Math.min(1, Math.max(0, intensity)) }));
  }

  /** Replaces the whole stack as one undo step. */
  setEdits(next: EditStack): void {
    this.apply(next);
  }

  /**
   * Applies a change to the current edits, e.g. `update(rotateRight)` or
   * `update((s) => withStraighten(s, 3))`. One undo step, or part of the gesture in progress.
   */
  update(change: (edits: EditStack) => EditStack): void {
    this.apply(change(this.draft));
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
    this.canvas?.setEdits(this.view(next));
    if (this.gestures === 0) this.history.commit(next);
  }

  // Undo/redo/reset abandon a gesture in progress: the history decides what is shown.
  private sync(stack: EditStack) {
    if (this.gestures > 0) {
      this.gestures = 0;
      this.canvas?.endInteraction();
    }
    this.draft = stack;
    this.canvas?.setEdits(this.view(stack));
  }

  private emit() {
    this.state = {
      ...this.history.getState(),
      cropping: this.cropping,
      comparing: this.comparing,
    };
    for (const listener of this.listeners) listener();
  }
}
