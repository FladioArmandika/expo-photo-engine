import {
  HSL_CHANNELS,
  HSL_COLORS,
  type HslColor,
  type PhotoEditor,
} from '@fladioarmandika/expo-photo-engine';
import { Pressable, StyleSheet, View } from 'react-native';

import { tick, ValueSlider } from '../controls';
import { colors } from '../theme';

const SWATCHES: Record<HslColor, string> = {
  red: '#ff453a',
  orange: '#ff9f0a',
  yellow: '#ffd60a',
  green: '#30d158',
  aqua: '#64d2ff',
  blue: '#0a84ff',
  purple: '#bf5af2',
  magenta: '#ff375f',
};

const LABELS = { hue: 'Hue', saturation: 'Saturation', luminance: 'Luminance' };

export function ColorPanel({
  editor,
  color,
  onSelect,
}: {
  editor: PhotoEditor;
  color: HslColor;
  onSelect: (color: HslColor) => void;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.swatches}>
        {HSL_COLORS.map((c) => {
          const values = editor.edits.hsl?.[c];
          const changed = !!values && Object.values(values).some((v) => !!v);
          return (
            <Pressable
              key={c}
              accessibilityLabel={c}
              accessibilityRole="button"
              accessibilityState={{ selected: c === color }}
              hitSlop={4}
              onPress={() => {
                tick();
                onSelect(c);
              }}
              style={[styles.ring, c === color && { borderColor: SWATCHES[c] }]}>
              <View style={[styles.swatch, { backgroundColor: SWATCHES[c] }]}>
                {changed && <View style={styles.changed} />}
              </View>
            </Pressable>
          );
        })}
      </View>
      {HSL_CHANNELS.map((channel) => (
        <ValueSlider
          key={`${color}-${channel}`}
          label={LABELS[channel]}
          slider={editor.hslSliderProps(color, channel)}
          onReset={() => editor.setHsl(color, channel, 0)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 2 },
  swatches: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  ring: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changed: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.background },
});
