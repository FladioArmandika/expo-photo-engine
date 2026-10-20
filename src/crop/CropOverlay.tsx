import * as React from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  aspectRatio,
  boxToRect,
  dragCropBox,
  fitFrame,
  hitTest,
  rectToBox,
  shownAspect,
  type Box,
  type CropHandle,
} from './geometry';
import { createCrop } from '../edit-stack/operations';
import type { Crop } from '../edit-stack/types';

export type CropOverlayProps = {
  /** The crop being edited. null = the whole photo. */
  crop: Crop | null;
  /** Size of the photo after EXIF orientation, from PhotoCanvas `onLoad`. */
  sourceWidth: number;
  sourceHeight: number;
  /** Called on every drag tick with the new crop. */
  onChange: (crop: Crop) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  /** Border, grid and handle color. Default white. */
  color?: string;
  /** Color over the parts that will be cut off. Default black at 55%. */
  dimColor?: string;
  /** Smallest crop box side, in points. Default 40. */
  minSize?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Crop box with drag handles, drawn over a PhotoCanvas. Give it the same position and size as the
 * canvas, and show the canvas uncropped while it is up (usePhotoEditor's `setCropping(true)` does
 * that), so the box lines up with the photo. Corners and edges resize, the inside moves the box,
 * and `crop.aspect` is kept while resizing.
 */
export function CropOverlay(props: CropOverlayProps) {
  const { crop, sourceWidth, sourceHeight, color = '#fff', dimColor = 'rgba(0,0,0,0.55)' } = props;
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  // While dragging, the box follows the finger here and is reported through onChange.
  const [dragBox, setDragBox] = React.useState<Box | null>(null);

  const frame = fitFrame(shownAspect(crop, sourceWidth, sourceHeight), size.width, size.height);
  const box = dragBox ?? rectToBox((crop ?? createCrop()).rect, frame);

  // PanResponder is created once, so it reads the latest values through a ref.
  const latest = React.useRef({ props, frame, box });
  React.useLayoutEffect(() => {
    latest.current = { props, frame, box };
  });

  // The handlers only read `latest` when a touch arrives, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = React.useState(() => {
    let gesture: { handle: CropHandle; start: Box } | null = null;
    const end = () => {
      gesture = null;
      setDragBox(null);
      latest.current.props.onGestureEnd?.();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: (event) => {
        const { box } = latest.current;
        const handle = hitTest(box, event.nativeEvent.locationX, event.nativeEvent.locationY);
        if (!handle) return false;
        gesture = { handle, start: box };
        return true;
      },
      onPanResponderGrant: () => {
        latest.current.props.onGestureStart?.();
      },
      onPanResponderMove: (_, { dx, dy }) => {
        if (!gesture) return;
        const { props, frame } = latest.current;
        const current = props.crop ?? createCrop();
        const ratio = aspectRatio(
          current.aspect,
          shownAspect(current, props.sourceWidth, props.sourceHeight)
        );
        const next = dragCropBox(
          gesture.start,
          gesture.handle,
          dx,
          dy,
          frame,
          ratio,
          props.minSize
        );
        setDragBox(next);
        props.onChange({ ...current, rect: boxToRect(next, frame) });
      },
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
  });

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  const dragging = dragBox !== null;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const handle = { borderColor: color };

  return (
    <View
      style={[StyleSheet.absoluteFill, props.style]}
      onLayout={onLayout}
      {...responder.panHandlers}>
      {size.width > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* Dimmed area outside the box: above, below, left, right. */}
          <View
            style={[
              styles.dim,
              { backgroundColor: dimColor, top: 0, left: 0, right: 0, height: box.y },
            ]}
          />
          <View
            style={[
              styles.dim,
              { backgroundColor: dimColor, top: bottom, left: 0, right: 0, bottom: 0 },
            ]}
          />
          <View
            style={[
              styles.dim,
              { backgroundColor: dimColor, top: box.y, left: 0, width: box.x, height: box.height },
            ]}
          />
          <View
            style={[
              styles.dim,
              { backgroundColor: dimColor, top: box.y, left: right, right: 0, height: box.height },
            ]}
          />

          <View
            style={[
              styles.box,
              { borderColor: color, left: box.x, top: box.y, width: box.width, height: box.height },
            ]}>
            {/* Rule-of-thirds grid while dragging. */}
            {dragging &&
              [1, 2].map((i) => (
                <React.Fragment key={i}>
                  <View
                    style={[styles.gridV, { backgroundColor: color, left: `${(i * 100) / 3}%` }]}
                  />
                  <View
                    style={[styles.gridH, { backgroundColor: color, top: `${(i * 100) / 3}%` }]}
                  />
                </React.Fragment>
              ))}
            <View style={[styles.corner, styles.topLeft, handle]} />
            <View style={[styles.corner, styles.topRight, handle]} />
            <View style={[styles.corner, styles.bottomLeft, handle]} />
            <View style={[styles.corner, styles.bottomRight, handle]} />
          </View>
        </View>
      )}
    </View>
  );
}

const CORNER = 20;
const THICK = 3;

const styles = StyleSheet.create({
  dim: { position: 'absolute' },
  box: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth * 2 },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, opacity: 0.6 },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    opacity: 0.6,
  },
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  topLeft: { top: -THICK, left: -THICK, borderTopWidth: THICK, borderLeftWidth: THICK },
  topRight: { top: -THICK, right: -THICK, borderTopWidth: THICK, borderRightWidth: THICK },
  bottomLeft: { bottom: -THICK, left: -THICK, borderBottomWidth: THICK, borderLeftWidth: THICK },
  bottomRight: { bottom: -THICK, right: -THICK, borderBottomWidth: THICK, borderRightWidth: THICK },
});
