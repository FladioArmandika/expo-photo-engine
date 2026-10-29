import { Ionicons } from '@expo/vector-icons';
import type { AdjustmentSliderProps } from '@fladioarmandika/expo-photo-engine';
import * as Haptics from 'expo-haptics';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { colors } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function tick() {
  Haptics.selectionAsync().catch(() => {});
}

export function IconButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Ionicons name={icon} size={22} color={disabled ? colors.faint : colors.text} />
    </Pressable>
  );
}

/** Plain text that acts as a button. */
export function TextButton({
  title,
  onPress,
  disabled,
  strong,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  strong?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}>
      <Text
        style={[
          styles.textButton,
          strong && styles.textButtonStrong,
          disabled && styles.textButtonDisabled,
        ]}>
        {title}
      </Text>
    </Pressable>
  );
}

/** An icon over a short label, for one-shot actions like Rotate. */
export function ActionButton({
  title,
  icon,
  onPress,
  disabled,
}: {
  title: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  const color = disabled ? colors.faint : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.actionText, { color }]}>{title}</Text>
    </Pressable>
  );
}

/**
 * A row of words to pick from, like the adjustment names. The picked one is white, the rest grey.
 * `marked` puts a dot under the ones that have been changed.
 */
export function Choices<T extends string>({
  options,
  value,
  onChange,
  marked,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  marked?: (value: T) => boolean;
}) {
  return (
    <>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            hitSlop={6}
            onPress={() => {
              tick();
              onChange(o.value);
            }}
            style={styles.choice}>
            <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
              {o.label}
            </Text>
            <View style={[styles.dot, marked?.(o.value) && styles.dotOn]} />
          </Pressable>
        );
      })}
    </>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => {
              tick();
              onChange(o.value);
            }}
            style={[styles.segment, selected && styles.segmentSelected]}>
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const TICKS = 60;
const TICK_GAP = 9;
const RULER = TICKS * TICK_GAP;

/**
 * A ruler you drag sideways under a fixed marker, like the dials in camera apps. Takes the same
 * props as a slider. The ruler moves with Animated and only the value text re-renders, so the
 * screen around it stays still while dragging. Tap the value to reset it.
 */
export function Dial({
  label,
  slider,
  format = formatHundred,
  onReset,
  disabled,
}: {
  label: string;
  slider: AdjustmentSliderProps;
  format?: (value: number) => string;
  onReset?: () => void;
  disabled?: boolean;
}) {
  const { minimumValue: min, maximumValue: max, step } = slider;
  const range = max - min;
  const [width, setWidth] = useState(0);
  // The value while dragging. Once the drag is committed (or undone), the prop takes over again.
  const [drag, setDrag] = useState({ from: slider.value, value: slider.value });
  const live = drag.from === slider.value ? drag.value : slider.value;

  const [offset] = useState(() => new Animated.Value(0));
  const toOffset = (value: number) => -((value - min) / range) * RULER;
  useEffect(() => offset.setValue(toOffset(slider.value)), [slider.value, min, max]);

  // Where the current drag started: finger x and the value under the marker at that moment.
  const gesture = useRef({ x: 0, start: 0, last: 0 });

  const handlers = {
    onStartShouldSetResponder: () => !disabled,
    onMoveShouldSetResponder: () => !disabled,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      gesture.current = { x: e.nativeEvent.pageX, start: slider.value, last: slider.value };
      slider.onSlidingStart();
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const g = gesture.current;
      const raw = g.start - ((e.nativeEvent.pageX - g.x) / RULER) * range;
      const value = Math.min(max, Math.max(min, Math.round(raw / step) * step));
      if (value === g.last) return;
      // A click when passing through zero, so it's easy to land back on it.
      if (Math.sign(value) !== Math.sign(g.last)) tick();
      g.last = value;
      offset.setValue(toOffset(value));
      setDrag({ from: slider.value, value });
      slider.onValueChange(value);
    },
    onResponderRelease: () => slider.onSlidingComplete(),
    onResponderTerminate: () => slider.onSlidingComplete(),
  };

  const nudge = (direction: 1 | -1) => {
    const value = Math.min(max, Math.max(min, live + direction * step * 5));
    slider.onSlidingStart();
    slider.onValueChange(value);
    slider.onSlidingComplete();
  };

  const zero = min < 0 && max > 0 ? Math.round((-min / range) * TICKS) : -1;
  const changed = Math.abs(live) > 1e-4;

  return (
    <View style={disabled && styles.disabled}>
      <View style={styles.dialHeader}>
        <Text style={styles.dialLabel}>{label}</Text>
        <Pressable
          accessibilityLabel={`Reset ${label}`}
          disabled={!onReset || !changed || disabled}
          hitSlop={10}
          onPress={() => {
            tick();
            onReset?.();
          }}>
          <Text style={[styles.dialValue, changed && styles.dialValueChanged]}>{format(live)}</Text>
        </Pressable>
      </View>
      <View
        {...handlers}
        accessible
        accessibilityLabel={label}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: format(live) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={styles.dial}>
        <Animated.View
          style={[styles.ruler, { left: width / 2, transform: [{ translateX: offset }] }]}>
          {Array.from({ length: TICKS + 1 }, (_, i) => (
            <View
              key={i}
              style={[
                styles.tick,
                { left: i * TICK_GAP },
                i % 5 === 0 && styles.tickMajor,
                i === zero && styles.tickZero,
              ]}
            />
          ))}
        </Animated.View>
        <View style={[styles.marker, { left: width / 2 - 1 }]} />
      </View>
    </View>
  );
}

/** -1..1 shown as -100..+100. */
export function formatHundred(value: number) {
  const n = Math.round(value * 100);
  return n > 0 ? `+${n}` : `${n}`;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.5 },
  disabled: { opacity: 0.3 },
  iconButton: { padding: 8 },
  textButton: { color: colors.text, fontSize: 16, padding: 8 },
  textButtonStrong: { fontWeight: '700' },
  textButtonDisabled: { color: colors.faint },
  action: { alignItems: 'center', gap: 4, minWidth: 64, paddingVertical: 4 },
  actionText: { fontSize: 12 },
  choice: { alignItems: 'center', paddingVertical: 4 },
  choiceText: { color: colors.dim, fontSize: 15 },
  choiceTextSelected: { color: colors.text, fontWeight: '600' },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 5 },
  dotOn: { backgroundColor: colors.dim },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.raised,
    borderRadius: 9,
    padding: 2,
  },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 7 },
  segmentSelected: { backgroundColor: colors.text },
  segmentText: { color: colors.dim, fontSize: 14, fontWeight: '500' },
  segmentTextSelected: { color: colors.chrome, fontWeight: '600' },
  dialHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  dialLabel: { color: colors.dim, fontSize: 13 },
  dialValue: {
    color: colors.dim,
    fontSize: 22,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
  },
  dialValueChanged: { color: colors.text },
  dial: { height: 44, overflow: 'hidden', marginTop: 4 },
  ruler: { position: 'absolute', top: 0, bottom: 0, width: RULER + 1 },
  tick: {
    position: 'absolute',
    bottom: 10,
    width: 1,
    height: 10,
    backgroundColor: colors.faint,
  },
  tickMajor: { height: 18, backgroundColor: colors.dim },
  tickZero: { height: 26, backgroundColor: colors.text },
  marker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.text,
  },
});
