import { Ionicons } from '@expo/vector-icons';
import type { AdjustmentSliderProps } from '@fladioarmandika/expo-photo-engine';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { type ComponentProps, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
  size = 22,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Ionicons name={icon} size={size} color={disabled ? colors.textFaint : colors.text} />
    </Pressable>
  );
}

/** A small rounded button with an optional icon, for actions inside a panel. */
export function PillButton({
  title,
  icon,
  onPress,
  primary,
  disabled,
}: {
  title: string;
  icon?: IconName;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const color = primary ? colors.onAccent : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        primary && styles.pillPrimary,
        (pressed || disabled) && styles.pressed,
      ]}>
      {icon && <Ionicons name={icon} size={16} color={color} />}
      <Text style={[styles.pillText, { color }]}>{title}</Text>
    </Pressable>
  );
}

/** A selectable chip. `marked` adds a dot, used for "this one has been changed". */
export function Chip({
  label,
  selected,
  marked,
  onPress,
}: {
  label: string;
  selected: boolean;
  marked?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        tick();
        onPress();
      }}
      style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
      <View style={[styles.dot, marked && styles.dotVisible]} />
    </Pressable>
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

/**
 * A labelled slider that shows its value. Only this component re-renders while dragging, so the
 * screen around it stays still. Tap the value to reset it.
 */
export function ValueSlider({
  label,
  slider,
  format = formatHundred,
  onReset,
  tint,
  disabled,
}: {
  label: string;
  slider: AdjustmentSliderProps;
  format?: (value: number) => string;
  onReset?: () => void;
  /** Track color. Sliders that go both ways from 0 get a neutral track by default. */
  tint?: string;
  disabled?: boolean;
}) {
  // The value while dragging. Once the drag is committed (or undone), the prop takes over again.
  const [drag, setDrag] = useState({ from: slider.value, value: slider.value });
  const live = drag.from === slider.value ? drag.value : slider.value;
  const bipolar = slider.minimumValue < 0;
  const fill = tint ?? (bipolar ? colors.surfaceHigh : colors.accent);
  const changed = Math.abs(live) > 1e-4;

  return (
    <View style={disabled && styles.disabled}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Pressable
          accessibilityLabel={`Reset ${label}`}
          disabled={!onReset || !changed}
          hitSlop={10}
          onPress={() => {
            tick();
            onReset?.();
          }}>
          <Text style={[styles.sliderValue, changed && styles.sliderValueChanged]}>
            {format(live)}
          </Text>
        </Pressable>
      </View>
      <Slider
        {...slider}
        disabled={disabled}
        style={styles.slider}
        onValueChange={(value) => {
          setDrag({ from: slider.value, value });
          slider.onValueChange(value);
        }}
        minimumTrackTintColor={fill}
        maximumTrackTintColor={colors.surfaceHigh}
        thumbTintColor="#fff"
      />
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
  disabled: { opacity: 0.35 },
  iconButton: { padding: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  pillPrimary: { backgroundColor: colors.accent },
  pillText: { fontSize: 14, fontWeight: '600' },
  chip: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.text },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '500' },
  chipTextSelected: { color: colors.onAccent },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 3, backgroundColor: 'transparent' },
  dotVisible: { backgroundColor: colors.accent },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 2,
  },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8 },
  segmentSelected: { backgroundColor: colors.surfaceHigh },
  segmentText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  segmentTextSelected: { color: colors.text },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 4,
  },
  sliderLabel: { color: colors.text, fontSize: 14, fontWeight: '500' },
  sliderValue: {
    color: colors.textDim,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    minWidth: 48,
    textAlign: 'right',
  },
  sliderValueChanged: { color: colors.accent },
  slider: { width: '100%', height: 36 },
});
