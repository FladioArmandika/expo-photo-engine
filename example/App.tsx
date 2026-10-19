import {
  ADJUSTMENT_KEYS,
  ADJUSTMENTS,
  exportImage,
  PhotoCanvas,
  usePhotoEditor,
  type AdjustmentKey,
  type ExportResult,
  type LoadEvent,
  type PreviewQuality,
  type RenderStats,
} from '@fladioarmandika/expo-photo-engine';
import Slider from '@react-native-community/slider';
import { Asset } from 'expo-asset';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// Test screen: every adjustment rendered by the native shader. usePhotoEditor sends slider ticks
// straight to the canvas, so dragging never causes a React render, and makes each drag one undo step.
export default function App() {
  const editor = usePhotoEditor();
  const [active, setActive] = useState<AdjustmentKey>('exposure');
  const [source, setSource] = useState<string | null>(null);
  const [quality, setQuality] = useState<PreviewQuality>('auto');
  const [load, setLoad] = useState<LoadEvent | null>(null);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-sweep the selected adjustment every frame from JS (the "stress test" input), no hands needed.
  useEffect(() => {
    if (!sweeping) return;
    const { controller } = editor;
    controller.beginGesture();
    const { min, max } = ADJUSTMENTS[active];
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = (Math.sin((now - start) / 600) + 1) / 2;
      controller.setAdjustment(active, min + (max - min) * (min < 0 ? 0.15 + t * 0.7 : t));
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      controller.endGesture();
    };
  }, [editor.controller, sweeping, active]);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      // Keep the original file (full resolution, HEIC stays HEIC) instead of a converted copy.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    const uri = result.assets?.[0]?.uri;
    if (uri) reset(uri);
  };

  const useChart = async () => {
    const [asset] = await Asset.loadAsync(require('./assets/parity-chart.png'));
    if (asset?.localUri) reset(asset.localUri);
  };

  const reset = (uri: string) => {
    editor.reset();
    setSource(uri);
    setLoad(null);
    setStats(null);
    setExported(null);
    setError(null);
  };

  const runExport = async () => {
    if (!source) return;
    setExported(null);
    try {
      const result = await exportImage(source, editor.getEdits(), {
        format: 'png',
        maxDimension: 0,
      });
      setExported(result);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.row}>
        <Button title="Pick photo" onPress={pickPhoto} />
        <Button title="Parity chart" onPress={useChart} />
        <Button
          title={`Preview: ${quality}`}
          onPress={() => setQuality((q) => (q === 'auto' ? 'full' : 'auto'))}
        />
      </View>

      <View style={styles.canvasWrap}>
        {source ? (
          <PhotoCanvas
            {...editor.canvasProps}
            source={source}
            previewQuality={quality}
            style={StyleSheet.absoluteFill}
            onLoad={setLoad}
            onError={(e) => setError(e.message)}
            onRenderStats={setStats}
          />
        ) : (
          <Text style={styles.hint}>Pick a 24MP+ photo or use the parity chart.</Text>
        )}
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.overlayText}>
            {Platform.OS} {Platform.Version}
            {load &&
              `\nsource ${load.sourceWidth}x${load.sourceHeight} (${((load.sourceWidth * load.sourceHeight) / 1e6).toFixed(1)}MP)` +
                `\npreview ${load.previewWidth}x${load.previewHeight}, decode ${load.decodeMs.toFixed(0)}ms`}
            {stats &&
              `\nfps ${stats.fps.toFixed(1)}  cpu ${stats.frameTimeMs.toFixed(2)}ms` +
                (stats.gpuTimeMs >= 0 ? `  gpu ${stats.gpuTimeMs.toFixed(2)}ms` : '') +
                `\nlatency ${stats.latencyMs.toFixed(1)}ms${stats.interacting ? '  (interacting)' : ''}`}
          </Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}>
        {ADJUSTMENT_KEYS.map((key) => (
          <Pressable
            key={key}
            style={[styles.chip, key === active && styles.chipActive]}
            onPress={() => setActive(key)}>
            <Text style={styles.chipText}>{ADJUSTMENTS[key].label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Slider key={active} style={styles.slider} {...editor.sliderProps(active)} />

      <View style={styles.row}>
        <Button
          title={sweeping ? 'Stop sweep' : 'Auto-sweep'}
          onPress={() => setSweeping((s) => !s)}
        />
        <Button title="Undo" disabled={!editor.canUndo} onPress={editor.undo} />
        <Button title="Redo" disabled={!editor.canRedo} onPress={editor.redo} />
        <Button title="Reset" onPress={() => editor.reset()} />
        <Button title="Export PNG" onPress={runExport} />
        {exported && <Button title="Share" onPress={() => Sharing.shareAsync(exported.uri)} />}
      </View>
      {exported && (
        <Text style={styles.info}>
          Exported {exported.width}x{exported.height} in {exported.totalMs.toFixed(0)}ms (render{' '}
          {exported.renderMs.toFixed(1)}ms)
        </Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function Button({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.pressed]}
      onPress={onPress}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0b0b0c',
    paddingTop: 60,
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  canvasWrap: {
    flex: 1,
    marginVertical: 12,
    backgroundColor: '#151517',
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  hint: { color: '#888', textAlign: 'center' },
  overlay: {
    position: 'absolute',
    left: 8,
    top: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 8,
  },
  overlayText: {
    color: '#7CFC9A',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 12,
  },
  chips: { gap: 6, paddingBottom: 4 },
  chip: {
    backgroundColor: '#1d1d20',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  chipActive: { backgroundColor: '#3b3b42' },
  chipText: { color: '#eee', fontSize: 13 },
  slider: { width: '100%', height: 40 },
  button: {
    backgroundColor: '#2a2a2e',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  pressed: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  info: { color: '#bbb', marginTop: 8 },
  error: { color: '#ff6b6b', marginTop: 8 },
});
