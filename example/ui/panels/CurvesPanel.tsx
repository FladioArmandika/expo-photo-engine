import {
  CURVE_CHANNELS,
  ToneCurveEditor,
  type CurveChannel,
  type PhotoEditor,
} from '@fladioarmandika/expo-photo-engine';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TextButton, tick } from '../controls';
import { colors } from '../theme';

const CHANNELS: Record<CurveChannel, { label: string; color: string }> = {
  rgb: { label: 'RGB', color: colors.text },
  red: { label: 'Red', color: '#ef6a6a' },
  green: { label: 'Green', color: '#62c47a' },
  blue: { label: 'Blue', color: '#5f9cf0' },
};

export function CurvesPanel({
  editor,
  channel,
  onSelect,
}: {
  editor: PhotoEditor;
  channel: CurveChannel;
  onSelect: (channel: CurveChannel) => void;
}) {
  return (
    <View style={styles.panel}>
      <ToneCurveEditor
        key={channel}
        style={styles.editor}
        color={CHANNELS[channel].color}
        gridColor="rgba(255,255,255,0.08)"
        {...editor.curveEditorProps(channel)}
      />
      <View style={styles.side}>
        {CURVE_CHANNELS.map((c) => {
          const selected = c === channel;
          return (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => {
                tick();
                onSelect(c);
              }}
              style={styles.channel}>
              <View
                style={[
                  styles.bar,
                  { backgroundColor: selected ? CHANNELS[c].color : 'transparent' },
                ]}
              />
              <Text style={[styles.channelText, selected && styles.channelTextSelected]}>
                {CHANNELS[c].label}
              </Text>
              {editor.edits.curves?.[c] && <View style={styles.changed} />}
            </Pressable>
          );
        })}
        <View style={styles.spacer} />
        <TextButton
          title="Reset curve"
          disabled={!editor.edits.curves?.[channel]}
          onPress={() => editor.setCurve(channel, null)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flexDirection: 'row', gap: 18 },
  editor: { width: 176, height: 176, backgroundColor: colors.surround },
  side: { flex: 1, alignItems: 'flex-start' },
  channel: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  bar: { width: 3, height: 16, borderRadius: 1.5 },
  channelText: { color: colors.dim, fontSize: 15 },
  channelTextSelected: { color: colors.text, fontWeight: '600' },
  changed: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.dim },
  spacer: { flex: 1 },
});
