import { requireNativeView } from 'expo';
import * as React from 'react';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';

import type { AdjustmentKey, EditStack } from './edit-stack/types';
import { toNativeEdits, type NativeEditStack } from './filters/registry';
import type { ErrorEvent, LoadEvent, PreviewQuality, RenderStats } from './types';

export type PhotoCanvasRef = {
  /** Updates one adjustment on the native side without a React render. Safe to call on every slider tick. */
  setAdjustment(key: AdjustmentKey, value: number): void;
  /** Replaces the whole edit stack on the native side without a React render. */
  setEdits(edits: EditStack): void;
  /** Call when a gesture starts (slider grab). Stats are reported for the interaction window. */
  beginInteraction(): void;
  endInteraction(): void;
};

export type PhotoCanvasProps = {
  /** file:// URI or absolute path of a JPEG, HEIC or PNG. */
  source: string;
  /** Initial / controlled edit stack. For live dragging prefer the ref methods. */
  edits?: EditStack;
  previewQuality?: PreviewQuality;
  style?: StyleProp<ViewStyle>;
  onLoad?: (event: LoadEvent) => void;
  onError?: (event: ErrorEvent) => void;
  /** Called about twice a second while frames are being rendered. */
  onRenderStats?: (stats: RenderStats) => void;
  ref?: React.Ref<PhotoCanvasRef>;
};

type NativeViewRef = {
  setAdjustment(key: string, value: number): Promise<void>;
  setEdits(edits: NativeEditStack): Promise<void>;
  beginInteraction(): Promise<void>;
  endInteraction(): Promise<void>;
};

type NativeProps = {
  source: string;
  edits?: NativeEditStack;
  previewQuality?: PreviewQuality;
  style?: StyleProp<ViewStyle>;
  onLoad?: (event: NativeSyntheticEvent<LoadEvent>) => void;
  onError?: (event: NativeSyntheticEvent<ErrorEvent>) => void;
  onRenderStats?: (event: NativeSyntheticEvent<RenderStats>) => void;
  ref?: React.Ref<NativeViewRef>;
};

const NativePhotoCanvas: React.ComponentType<NativeProps> = requireNativeView('ExpoPhotoEngine');

export function PhotoCanvas({
  ref,
  edits,
  onLoad,
  onError,
  onRenderStats,
  ...rest
}: PhotoCanvasProps) {
  const nativeRef = React.useRef<NativeViewRef>(null);
  // The native side gets the filter as shader numbers rather than an id.
  const nativeEdits = React.useMemo(() => edits && toNativeEdits(edits), [edits]);

  React.useImperativeHandle(
    ref,
    () => ({
      // Fire-and-forget: the native side coalesces updates to the display refresh,
      // so awaiting each call would only add latency.
      setAdjustment: (key, value) => {
        nativeRef.current?.setAdjustment(key, value);
      },
      setEdits: (edits) => {
        nativeRef.current?.setEdits(toNativeEdits(edits));
      },
      beginInteraction: () => {
        nativeRef.current?.beginInteraction();
      },
      endInteraction: () => {
        nativeRef.current?.endInteraction();
      },
    }),
    []
  );

  return (
    <NativePhotoCanvas
      {...rest}
      edits={nativeEdits}
      ref={nativeRef}
      onLoad={onLoad && ((e) => onLoad(e.nativeEvent))}
      onError={onError && ((e) => onError(e.nativeEvent))}
      onRenderStats={onRenderStats && ((e) => onRenderStats(e.nativeEvent))}
    />
  );
}
