import {
  flipHorizontal,
  rotateRight,
  withCrop,
  withCropAspect,
  withStraighten,
  type CropAspect,
  type LoadEvent,
  type PhotoEditor,
} from '@fladioarmandika/expo-photo-engine';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip, PillButton, ValueSlider } from '../controls';

const ASPECTS: { value: CropAspect; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original' },
  { value: '1:1', label: 'Square' },
  { value: '4:5', label: '4:5' },
  { value: '16:9', label: '16:9' },
];

export function CropPanel({ editor, photo }: { editor: PhotoEditor; photo: LoadEvent | null }) {
  const crop = editor.edits.crop;
  const aspect = crop?.aspect ?? 'free';

  return (
    <View style={styles.panel}>
      <ValueSlider
        label="Straighten"
        slider={{
          value: crop?.straighten ?? 0,
          minimumValue: -45,
          maximumValue: 45,
          step: 0.1,
          onSlidingStart: editor.beginGesture,
          onValueChange: (value) => editor.update((s) => withStraighten(s, value)),
          onSlidingComplete: editor.endGesture,
        }}
        format={(v) => `${v.toFixed(1)}°`}
        onReset={() => editor.update((s) => withStraighten(s, 0))}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bleed}
        contentContainerStyle={[styles.row, styles.inset]}>
        {ASPECTS.map((a) => (
          <Chip
            key={a.value}
            label={a.label}
            selected={a.value === aspect}
            onPress={() =>
              photo &&
              editor.update((s) =>
                withCropAspect(s, a.value, photo.sourceWidth, photo.sourceHeight)
              )
            }
          />
        ))}
      </ScrollView>
      <View style={styles.row}>
        <PillButton title="Rotate" icon="reload" onPress={() => editor.update(rotateRight)} />
        <PillButton
          title="Flip"
          icon="swap-horizontal"
          onPress={() => editor.update(flipHorizontal)}
        />
        <PillButton
          title="Reset"
          icon="refresh"
          disabled={!crop}
          onPress={() => editor.update((s) => withCrop(s, null))}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 14 },
  row: { flexDirection: 'row', gap: 8 },
  bleed: { marginHorizontal: -16 },
  inset: { paddingHorizontal: 16 },
});
