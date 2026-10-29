import {
  ADJUSTMENTS,
  type AdjustmentKey,
  type LoadEvent,
  type PhotoEditor,
  type PreviewQuality,
  type RenderStats,
} from '@fladioarmandika/expo-photo-engine';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from './theme';

/**
 * Numbers for checking speed: photo size, decode time, fps and latency. "Sweep" moves the selected
 * adjustment every frame from JS, so you can watch the fps without touching the screen.
 */
export function DevOverlay({
  editor,
  photo,
  stats,
  sweepKey,
  quality,
  onQualityChange,
}: {
  editor: PhotoEditor;
  photo: LoadEvent | null;
  stats: RenderStats | null;
  sweepKey: AdjustmentKey;
  quality: PreviewQuality;
  onQualityChange: (quality: PreviewQuality) => void;
}) {
  const [sweeping, setSweeping] = useState(false);

  useEffect(() => {
    if (!sweeping) return;
    const { controller } = editor;
    controller.beginGesture();
    const { min, max } = ADJUSTMENTS[sweepKey];
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = (Math.sin((now - start) / 600) + 1) / 2;
      controller.setAdjustment(sweepKey, min + (max - min) * (min < 0 ? 0.15 + t * 0.7 : t));
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      controller.endGesture();
    };
  }, [editor.controller, sweeping, sweepKey]);

  const lines = [`${Platform.OS} ${Platform.Version}`];
  if (photo) {
    const mp = ((photo.sourceWidth * photo.sourceHeight) / 1e6).toFixed(1);
    lines.push(`photo ${photo.sourceWidth}×${photo.sourceHeight} (${mp}MP)`);
    lines.push(
      `preview ${photo.previewWidth}×${photo.previewHeight}, ${photo.decodeMs.toFixed(0)}ms`
    );
  }
  if (stats) {
    const gpu = stats.gpuTimeMs >= 0 ? `  gpu ${stats.gpuTimeMs.toFixed(2)}ms` : '';
    lines.push(`fps ${stats.fps.toFixed(1)}`);
    lines.push(`cpu ${stats.frameTimeMs.toFixed(2)}ms${gpu}`);
    lines.push(`latency ${stats.latencyMs.toFixed(1)}ms${stats.interacting ? ' (live)' : ''}`);
  }

  return (
    <View style={styles.box} pointerEvents="box-none">
      <Text style={styles.text}>{lines.join('\n')}</Text>
      <View style={styles.row}>
        <Toggle
          label={sweeping ? `Sweeping ${ADJUSTMENTS[sweepKey].label}` : 'Sweep'}
          on={sweeping}
          onPress={() => setSweeping((s) => !s)}
        />
        <Toggle
          label="Full-size preview"
          on={quality === 'full'}
          onPress={() => onQualityChange(quality === 'full' ? 'auto' : 'full')}
        />
      </View>
    </View>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.toggle, on && styles.toggleOn]}>
      <Text style={[styles.toggleText, on && styles.toggleTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    left: 24,
    top: 24,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    padding: 10,
    gap: 8,
  },
  text: { color: colors.text, fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: 6 },
  toggle: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  toggleOn: { backgroundColor: colors.text },
  toggleText: { color: colors.text, fontSize: 11, fontWeight: '600' },
  toggleTextOn: { color: colors.chrome },
});
