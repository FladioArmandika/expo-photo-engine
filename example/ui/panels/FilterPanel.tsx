import {
  renderFilterThumbnails,
  type FilterThumbnail,
  type PhotoEditor,
} from '@fladioarmandika/expo-photo-engine';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Dial, tick } from '../controls';
import { colors } from '../theme';

const PLACEHOLDERS = Array.from({ length: 8 }, (_, i) => i);

export function FilterPanel({
  editor,
  source,
  onError,
}: {
  editor: PhotoEditor;
  source: string;
  onError: (message: string) => void;
}) {
  const [thumbnails, setThumbnails] = useState<FilterThumbnail[]>([]);

  // Thumbnails show the photo as it is now, so redo them when the crop or the other edits change.
  // Picking a filter doesn't change them.
  const { crop, adjustments, hsl, curves } = editor.edits;
  const key = JSON.stringify([crop, adjustments, hsl, curves]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      renderFilterThumbnails(source, editor.getEdits(), { maxDimension: 160 })
        .then((result) => !cancelled && setThumbnails(result))
        .catch((e) => onError(String(e)));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, key]);

  const filter = editor.edits.filter;
  const selectedId = filter?.id ?? null;

  return (
    <View style={styles.panel}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bleed}
        contentContainerStyle={styles.row}>
        {thumbnails.length === 0
          ? PLACEHOLDERS.map((i) => (
              <View key={i}>
                <View style={[styles.thumbnail, styles.placeholder]} />
                <Text style={styles.label}> </Text>
              </View>
            ))
          : thumbnails.map((t) => {
              const selected = selectedId === t.id;
              return (
                <Pressable
                  key={t.id ?? 'original'}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    tick();
                    editor.setFilter(t.id === null ? null : { id: t.id, intensity: 1 });
                  }}>
                  <Image
                    source={{ uri: t.uri }}
                    style={[styles.thumbnail, selected && styles.thumbnailSelected]}
                  />
                  <Text style={[styles.label, selected && styles.labelSelected]}>{t.label}</Text>
                </Pressable>
              );
            })}
      </ScrollView>
      <Dial
        key={selectedId ?? 'none'}
        label={filter ? 'Strength' : 'Pick a filter to set its strength'}
        slider={editor.filterSliderProps()}
        disabled={!filter}
        onReset={() => editor.setFilterIntensity(1)}
        format={(v) => `${Math.round(v * 100)}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 14 },
  bleed: { marginHorizontal: -20, flexGrow: 0 },
  row: { gap: 6, paddingHorizontal: 20 },
  thumbnail: { width: 72, height: 72, borderRadius: 3 },
  placeholder: { backgroundColor: colors.raised },
  thumbnailSelected: { borderWidth: 2, borderColor: colors.text },
  label: { color: colors.dim, fontSize: 12, marginTop: 6 },
  labelSelected: { color: colors.text, fontWeight: '600' },
});
