import {
  HSL_COLORS,
  type HslChannel,
  type HslColor,
  type PhotoEditor,
} from '@fladioarmandika/expo-photo-engine';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Choices, Dial, tick } from '../controls';
import { colors } from '../theme';

const SWATCHES: Record<HslColor, string> = {
  red: '#e5484d',
  orange: '#f0883e',
  yellow: '#e8c547',
  green: '#4cae5b',
  aqua: '#3fb8c4',
  blue: '#3d7fe0',
  purple: '#8e5bd6',
  magenta: '#d4508f',
};

const CHANNELS: { value: HslChannel; label: string }[] = [
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'luminance', label: 'Luminance' },
];

export function ColorPanel({
  editor,
  color,
  onSelect,
}: {
  editor: PhotoEditor;
  color: HslColor;
  onSelect: (color: HslColor) => void;
}) {
  const [channel, setChannel] = useState<HslChannel>('saturation');
  const label = `${color[0]!.toUpperCase()}${color.slice(1)} ${channel}`;

  return (
    <View style={styles.panel}>
      <Dial
        key={`${color}-${channel}`}
        label={label}
        slider={editor.hslSliderProps(color, channel)}
        onReset={() => editor.setHsl(color, channel, 0)}
      />
      <View style={styles.swatches}>
        {HSL_COLORS.map((c) => {
          const selected = c === color;
          return (
            <Pressable
              key={c}
              accessibilityLabel={c}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              hitSlop={6}
              onPress={() => {
                tick();
                onSelect(c);
              }}
              style={styles.swatchHit}>
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: SWATCHES[c] },
                  selected && styles.swatchSelected,
                ]}
              />
              <View
                style={[
                  styles.dot,
                  !!editor.edits.hsl?.[c] &&
                    Object.values(editor.edits.hsl[c]!).some((v) => !!v) &&
                    styles.dotOn,
                ]}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.channels}>
        <Choices options={CHANNELS} value={channel} onChange={setChannel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 14 },
  swatches: { flexDirection: 'row', justifyContent: 'space-between' },
  swatchHit: { alignItems: 'center', width: 32 },
  swatch: { width: 18, height: 18, borderRadius: 9 },
  swatchSelected: { width: 26, height: 26, borderRadius: 13, marginVertical: -4 },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 9 },
  dotOn: { backgroundColor: colors.dim },
  channels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
});
