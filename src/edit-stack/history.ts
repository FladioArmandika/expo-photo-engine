import { editStacksEqual } from './operations';
import type { EditStack } from './types';

export type HistoryState = {
  present: EditStack;
  canUndo: boolean;
  canRedo: boolean;
  /** True when `present` differs from the stack the history started from (or was last marked saved). */
  isDirty: boolean;
};

/**
 * Undo/redo for edit stacks. Commit once per user action (e.g. on slider release, not on every
 * tick) so one undo reverts one gesture. Framework-agnostic; `subscribe` + `getState` plug into
 * React's useSyncExternalStore.
 */
export class EditHistory {
  private past: EditStack[] = [];
  private future: EditStack[] = [];
  private present: EditStack;
  private saved: EditStack;
  private state: HistoryState;
  private listeners = new Set<() => void>();

  constructor(
    initial: EditStack,
    private readonly limit = 100
  ) {
    this.present = initial;
    this.saved = initial;
    this.state = this.snapshot();
  }

  getState = (): HistoryState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Records `next` as a new step. A stack equal to the current one is ignored. */
  commit(next: EditStack): void {
    if (editStacksEqual(next, this.present)) return;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
    this.emit();
  }

  undo(): EditStack {
    const previous = this.past.pop();
    if (previous) {
      this.future.push(this.present);
      this.present = previous;
      this.emit();
    }
    return this.present;
  }

  redo(): EditStack {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.present);
      this.present = next;
      this.emit();
    }
    return this.present;
  }

  /** Replaces everything with `stack` as the new clean starting point (e.g. after loading). */
  reset(stack: EditStack): void {
    this.past = [];
    this.future = [];
    this.present = stack;
    this.saved = stack;
    this.emit();
  }

  /** Marks the current stack as saved, so `isDirty` becomes false. */
  markSaved(): void {
    this.saved = this.present;
    this.emit();
  }

  private snapshot(): HistoryState {
    return {
      present: this.present,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      isDirty: !editStacksEqual(this.present, this.saved),
    };
  }

  private emit() {
    this.state = this.snapshot();
    this.listeners.forEach((listener) => listener());
  }
}
