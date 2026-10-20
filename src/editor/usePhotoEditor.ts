import { useMemo, useState, useSyncExternalStore } from 'react';

import type { PhotoCanvasRef } from '../PhotoCanvas';
import { PhotoEditorController } from './PhotoEditorController';
import type { CropOverlayProps } from '../crop/CropOverlay';
import type { HslChannel, HslColor } from '../edit-stack/hsl';
import { migrateEditStack } from '../edit-stack/migrate';
import { ADJUSTMENTS, type AdjustmentKey, type EditStack } from '../edit-stack/types';

export type UsePhotoEditorOptions = {
  /** Starting edits: a stack, or a saved one (object or JSON string) of any version. */
  initialEdits?: EditStack | string | object;
  /** Undo steps kept. Default 100. */
  historyLimit?: number;
};

/** Props for @react-native-community/slider, or any slider with the same callbacks. */
export type AdjustmentSliderProps = {
  value: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  onSlidingStart: () => void;
  onValueChange: (value: number) => void;
  onSlidingComplete: () => void;
};

export type PhotoEditor = {
  /** Spread onto <PhotoCanvas>: `<PhotoCanvas source={uri} {...editor.canvasProps} />`. */
  canvasProps: { ref: (canvas: PhotoCanvasRef | null) => void; edits: EditStack };
  /** The committed edits. Does not change during a drag. */
  edits: EditStack;
  canUndo: boolean;
  canRedo: boolean;
  /** True when the edits differ from the start (or from the last markSaved()). */
  isDirty: boolean;
  /** Ready-made slider props for one adjustment: range, live preview and one undo step per drag. */
  sliderProps: (key: AdjustmentKey) => AdjustmentSliderProps;
  /** True while the crop is being edited (see setCropping). */
  cropping: boolean;
  /**
   * Spread onto <CropOverlay>, with the photo size from PhotoCanvas `onLoad`. Each drag is one
   * undo step.
   */
  cropOverlayProps: (photo: {
    sourceWidth: number;
    sourceHeight: number;
  }) => Pick<
    CropOverlayProps,
    'crop' | 'sourceWidth' | 'sourceHeight' | 'onChange' | 'onGestureStart' | 'onGestureEnd'
  >;
  /** Slider props for the current filter's intensity, 0..1. */
  filterSliderProps: () => AdjustmentSliderProps;
  /** Slider props for one color's hue, saturation or luminance, -1..1. One drag = one undo step. */
  hslSliderProps: (color: HslColor, channel: HslChannel) => AdjustmentSliderProps;
  /** The underlying controller: setAdjustment, setCrop, setFilter, undo, redo, reset, getEdits… */
  controller: PhotoEditorController;
} & Pick<
  PhotoEditorController,
  | 'setAdjustment'
  | 'setCrop'
  | 'setFilter'
  | 'setCropping'
  | 'setFilterIntensity'
  | 'setHsl'
  | 'setEdits'
  | 'update'
  | 'beginGesture'
  | 'endGesture'
  | 'undo'
  | 'redo'
  | 'reset'
  | 'markSaved'
  | 'getEdits'
>;

/**
 * Editor state for one photo: undo/redo, dirty tracking and live preview, wired to a PhotoCanvas.
 * Slider drags never cause a React render; the component re-renders only when a step is
 * committed, undone or redone.
 */
export function usePhotoEditor(options: UsePhotoEditorOptions = {}): PhotoEditor {
  // Created once, like useRef, so later option changes don't wipe the history.
  const [controller] = useState(() => {
    const initial =
      options.initialEdits === undefined ? undefined : migrateEditStack(options.initialEdits);
    return new PhotoEditorController(initial, options.historyLimit);
  });
  const state = useSyncExternalStore(controller.subscribe, controller.getState);

  return useMemo(() => {
    const c = controller;
    return {
      canvasProps: { ref: c.attachCanvas, edits: c.view(state.present) },
      edits: state.present,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
      isDirty: state.isDirty,
      sliderProps: (key) => ({
        value: state.present.adjustments[key] ?? 0,
        minimumValue: ADJUSTMENTS[key].min,
        maximumValue: ADJUSTMENTS[key].max,
        step: ADJUSTMENTS[key].step,
        onSlidingStart: () => c.beginGesture(),
        onValueChange: (value) => c.setAdjustment(key, value),
        onSlidingComplete: () => c.endGesture(),
      }),
      cropping: state.cropping,
      cropOverlayProps: ({ sourceWidth, sourceHeight }) => ({
        crop: state.present.crop,
        sourceWidth,
        sourceHeight,
        onChange: (crop) => c.setCrop(crop),
        onGestureStart: () => c.beginGesture(),
        onGestureEnd: () => c.endGesture(),
      }),
      filterSliderProps: () => ({
        value: state.present.filter?.intensity ?? 0,
        minimumValue: 0,
        maximumValue: 1,
        step: 0.01,
        onSlidingStart: () => c.beginGesture(),
        onValueChange: (value) => c.setFilterIntensity(value),
        onSlidingComplete: () => c.endGesture(),
      }),
      hslSliderProps: (color, channel) => ({
        value: state.present.hsl?.[color]?.[channel] ?? 0,
        minimumValue: -1,
        maximumValue: 1,
        step: 0.01,
        onSlidingStart: () => c.beginGesture(),
        onValueChange: (value) => c.setHsl(color, channel, value),
        onSlidingComplete: () => c.endGesture(),
      }),
      controller: c,
      setAdjustment: (key, value) => c.setAdjustment(key, value),
      setCrop: (crop) => c.setCrop(crop),
      setFilter: (filter) => c.setFilter(filter),
      setCropping: (cropping) => c.setCropping(cropping),
      setFilterIntensity: (intensity) => c.setFilterIntensity(intensity),
      setHsl: (color, channel, value) => c.setHsl(color, channel, value),
      setEdits: (stack) => c.setEdits(stack),
      update: (change) => c.update(change),
      beginGesture: () => c.beginGesture(),
      endGesture: () => c.endGesture(),
      undo: () => c.undo(),
      redo: () => c.redo(),
      // Ignores a non-stack argument, so `onPress={editor.reset}` doesn't pass the press event in.
      reset: (stack) => c.reset(isEditStack(stack) ? stack : undefined),
      markSaved: () => c.markSaved(),
      getEdits: () => c.getEdits(),
    };
  }, [controller, state]);
}

function isEditStack(value: unknown): value is EditStack {
  return (
    typeof value === 'object' && value !== null && 'version' in value && 'adjustments' in value
  );
}
