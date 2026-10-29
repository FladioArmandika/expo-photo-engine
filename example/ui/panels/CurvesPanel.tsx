import {
  CURVE_CHANNELS,
  ToneCurveEditor,
  type CurveChannel,
  type PhotoEditor,
} from '@fladioarmandika/expo-photo-engine';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PillButton, tick } from '../controls';
import { colors } from '../theme';

const CHANNELS: Record<CurveChannel, { label: string; color: string }> = {
  rgb: { label: 'RGB', color: '#ffffff' },
  red: { label: 'Red', color: '#ff6b6b' },
  green: { label: 'Green', color: '#5fd38d' },
  blue: { label: 'Blue', color: '#5aa9ff' },
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
        gridColor="rgba(255,255,255,0.12)"
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
              style={[styles.channel, selected && styles.channelSelected]}>
              <View style={[styles.dot, { backgroundColor: CHANNELS[c].color }]} />
              <Text style={[styles.channelText, selected && styles.channelTextSelected]}>
                {CHANNELS[c].label}
              </Text>
              {editor.edits.curves?.[c] && <View style={styles.changed} />}
            </Pressable>
          );
        })}
        <View style={styles.spacer} />
        <PillButton
          title="Reset"
          icon="refresh"
          disabled={!editor.edits.curves?.[channel]}
          onPress={() => editor.setCurve(channel, null)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flexDirection: 'row', gap: 16 },
  editor: {
    width: 168,
    height: 168,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  side: { flex: 1, gap: 4 },
  channel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  channelSelected: { backgroundColor: colors.surface },
  dot: { width: 10, height: 10, borderRadius: 5 },
  channelText: { color: colors.textDim, fontSize: 14, fontWeight: '500', flex: 1 },
  channelTextSelected: { color: colors.text },
  changed: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent },
  spacer: { flex: 1 },
});
