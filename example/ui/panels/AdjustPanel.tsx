import {
  ADJUSTMENT_KEYS,
  ADJUSTMENTS,
  type AdjustmentKey,
  type PhotoEditor,
} from '@fladioarmandika/expo-photo-engine';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip, formatHundred, ValueSlider } from '../controls';

export function AdjustPanel({
  editor,
  active,
  onSelect,
}: {
  editor: PhotoEditor;
  active: AdjustmentKey;
  onSelect: (key: AdjustmentKey) => void;
}) {
  return (
    <View style={styles.panel}>
      <ValueSlider
        key={active}
        label={ADJUSTMENTS[active].label}
        slider={editor.sliderProps(active)}
        format={active === 'exposure' ? formatStops : formatHundred}
        onReset={() => editor.setAdjustment(active, 0)}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bleed}
        contentContainerStyle={styles.chips}>
        {ADJUSTMENT_KEYS.map((key) => (
          <Chip
            key={key}
            label={ADJUSTMENTS[key].label}
            selected={key === active}
            marked={!!editor.edits.adjustments[key]}
            onPress={() => onSelect(key)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function formatStops(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} EV`;
}

const styles = StyleSheet.create({
  panel: { gap: 14 },
  bleed: { marginHorizontal: -16 },
  chips: { gap: 8, paddingHorizontal: 16 },
});
