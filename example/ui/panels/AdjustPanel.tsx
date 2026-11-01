import {
  ADJUSTMENT_KEYS,
  ADJUSTMENTS,
  type AdjustmentKey,
  type PhotoEditor,
} from '@fladioarmandika/expo-photo-engine';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Choices, Dial, formatHundred } from '../controls';

const OPTIONS = ADJUSTMENT_KEYS.map((key) => ({ value: key, label: ADJUSTMENTS[key].label }));

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
      <Dial
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
        contentContainerStyle={styles.row}>
        <Choices
          options={OPTIONS}
          value={active}
          onChange={onSelect}
          marked={(key) => !!editor.edits.adjustments[key]}
        />
      </ScrollView>
    </View>
  );
}

function formatStops(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

const styles = StyleSheet.create({
  panel: { gap: 18 },
  bleed: { marginHorizontal: -20, flexGrow: 0 },
  row: { gap: 22, paddingHorizontal: 20 },
});
