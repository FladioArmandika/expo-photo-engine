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
  curveOrIdentity,
  hitCurvePoint,
  insertCurvePoint,
  moveCurvePoint,
  removeCurvePoint,
} from './editing';
import { evaluateCurve, type CurvePoint } from '../edit-stack/curves';

export type ToneCurveEditorProps = {
  /** The curve being edited. null = a straight line (unchanged). */
  points: readonly CurvePoint[] | null;
  /** Called on every drag tick with the new points. */
  onChange: (points: CurvePoint[]) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  /** Curve and point color. Default white. */
  color?: string;
  /** Grid color. Default white at 25%. */
  gridColor?: string;
  /** How far, in points, a touch can be from a point and still grab it. Default 24. */
  touchRadius?: number;
  style?: StyleProp<ViewStyle>;
};

/** Line segments the curve is drawn with. */
const SEGMENTS = 64;
/** Dragging a point this far (in points) outside the box removes it when let go. */
const REMOVE_DISTANCE = 40;

/**
 * A tone curve editor drawn with plain views. Touch near a point to drag it, touch anywhere else
 * to add a point there, and drag a point out of the box to remove it. Input runs left to right and
 * output bottom to top, like in photo editors. Give it a size, usually square.
 */
export function ToneCurveEditor(props: ToneCurveEditorProps) {
  const { color = '#fff', gridColor = 'rgba(255,255,255,0.25)', touchRadius = 24 } = props;
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  // While dragging, the points follow the finger here and are reported through onChange.
  const [dragPoints, setDragPoints] = React.useState<CurvePoint[] | null>(null);
  const points = dragPoints ?? curveOrIdentity(props.points);

  // PanResponder is created once, so it reads the latest values through a ref.
  const latest = React.useRef({ props, size, points, touchRadius });
  React.useLayoutEffect(() => {
    latest.current = { props, size, points, touchRadius };
  });

  // The handlers only read `latest` when a touch arrives, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = React.useState(() => {
    // locationX/Y are only trusted at the first touch; after that the finger is followed with
    // dx/dy, which keep working when it leaves the box.
    let gesture: {
      index: number;
      points: CurvePoint[];
      start: { x: number; y: number };
    } | null = null;
    const toCurve = (x: number, y: number): CurvePoint => {
      const { width, height } = latest.current.size;
      return [x / width, 1 - y / height];
    };
    const end = () => {
      const { props } = latest.current;
      gesture = null;
      setDragPoints(null);
      props.onGestureEnd?.();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: (event) => {
        const { size, points, touchRadius } = latest.current;
        if (size.width === 0 || size.height === 0) return false;
        const start = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
        const touch = toCurve(start.x, start.y);
        const radius = { x: touchRadius / size.width, y: touchRadius / size.height };
        const hit = hitCurvePoint(points, touch[0], touch[1], radius);
        if (hit >= 0) {
          gesture = { index: hit, points, start };
          return true;
        }
        const added = insertCurvePoint(points, touch);
        if (!added) return false;
        gesture = { index: added.index, points: added.points, start };
        return true;
      },
      onPanResponderGrant: () => {
        const { props } = latest.current;
        props.onGestureStart?.();
        if (!gesture) return;
        // A new point shows up straight away, before the finger moves.
        gesture.points = moveCurvePoint(
          gesture.points,
          gesture.index,
          toCurve(gesture.start.x, gesture.start.y)
        );
        setDragPoints(gesture.points);
        props.onChange(gesture.points);
      },
      onPanResponderMove: (_, { dx, dy }) => {
        if (!gesture) return;
        const { props, size } = latest.current;
        const x = gesture.start.x + dx;
        const y = gesture.start.y + dy;
        gesture.points = moveCurvePoint(gesture.points, gesture.index, toCurve(x, y));
        // Inner points dragged well outside the box are removed; the end points never are.
        const isEnd = gesture.index === 0 || gesture.index === gesture.points.length - 1;
        const beyond = Math.max(-y, y - size.height, -x, x - size.width);
        const shown =
          !isEnd && beyond > REMOVE_DISTANCE
            ? removeCurvePoint(gesture.points, gesture.index)
            : gesture.points;
        setDragPoints(shown);
        props.onChange(shown);
      },
      // Keep the drag when the editor sits in a ScrollView.
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
  });

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  const { width, height } = size;
  const segments: React.ReactNode[] = [];
  if (width > 0) {
    let previous = { x: 0, y: (1 - evaluateCurve(points, 0)) * height };
    for (let i = 1; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const next = { x: t * width, y: (1 - evaluateCurve(points, t)) * height };
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const length = Math.hypot(dx, dy);
      segments.push(
        <View
          key={i}
          style={[
            styles.segment,
            {
              backgroundColor: color,
              width: length + 1,
              left: (previous.x + next.x) / 2 - (length + 1) / 2,
              top: (previous.y + next.y) / 2 - LINE / 2,
              transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
            },
          ]}
        />
      );
      previous = next;
    }
  }

  return (
    <View style={[styles.box, props.style]} onLayout={onLayout} {...responder.panHandlers}>
      {width > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {[1, 2, 3].map((i) => (
            <React.Fragment key={i}>
              <View style={[styles.gridV, { backgroundColor: gridColor, left: `${i * 25}%` }]} />
              <View style={[styles.gridH, { backgroundColor: gridColor, top: `${i * 25}%` }]} />
            </React.Fragment>
          ))}
          <View style={[styles.frame, { borderColor: gridColor }]} />
          {segments}
          {points.map(([x, y], i) => (
            <View
              key={i}
              style={[
                styles.point,
                {
                  borderColor: color,
                  left: x * width - POINT / 2,
                  top: (1 - y) * height - POINT / 2,
                },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const LINE = 2;
const POINT = 12;

const styles = StyleSheet.create({
  box: { overflow: 'visible' },
  frame: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: StyleSheet.hairlineWidth,
  },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  segment: { position: 'absolute', height: LINE, borderRadius: LINE / 2 },
  point: {
    position: 'absolute',
    width: POINT,
    height: POINT,
    borderRadius: POINT / 2,
    borderWidth: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});
