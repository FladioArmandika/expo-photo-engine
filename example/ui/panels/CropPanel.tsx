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
import { StyleSheet, View } from 'react-native';

import { ActionButton, Choices, Dial } from '../controls';

const ASPECTS: { value: CropAspect; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original' },
  { value: '1:1', label: 'Square' },
  { value: '4:5', label: '4:5' },
  { value: '16:9', label: '16:9' },
];

export function CropPanel({ editor, photo }: { editor: PhotoEditor; photo: LoadEvent | null }) {
  const crop = editor.edits.crop;

  return (
    <View style={styles.panel}>
      <Dial
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
      <View style={styles.aspects}>
        <Choices
          options={ASPECTS}
          value={crop?.aspect ?? 'free'}
          onChange={(aspect) =>
            photo &&
            editor.update((s) => withCropAspect(s, aspect, photo.sourceWidth, photo.sourceHeight))
          }
        />
      </View>
      <View style={styles.actions}>
        <ActionButton title="Rotate" icon="reload" onPress={() => editor.update(rotateRight)} />
        <ActionButton
          title="Flip"
          icon="swap-horizontal"
          onPress={() => editor.update(flipHorizontal)}
        />
        <ActionButton
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
  aspects: { flexDirection: 'row', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
});
