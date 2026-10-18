import {
  exportImage,
  PhotoCanvas,
  type ExportResult,
  type LoadEvent,
  type PhotoCanvasRef,
  type PreviewQuality,
  type RenderStats,
} from '@fladioarmandika/expo-photo-engine';
import Slider from '@react-native-community/slider';
import { Asset } from 'expo-asset';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

// Spike screen: one adjustment (exposure) rendered by the native shader, driven through the
// imperative ref so slider ticks never cause a React render.
export default function App() {
  const canvas = useRef<PhotoCanvasRef>(null);
  const exposure = useRef(0);
  const [source, setSource] = useState<string | null>(null);
  const [quality, setQuality] = useState<PreviewQuality>('auto');
  const [load, setLoad] = useState<LoadEvent | null>(null);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-sweep exposure every frame from JS (the "stress test" input), no hands needed.
  useEffect(() => {
    if (!sweeping) return;
    canvas.current?.beginInteraction();
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const value = Math.sin((now - start) / 600) * 2;
      exposure.current = value;
      canvas.current?.setAdjustment('exposure', value);
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      canvas.current?.endInteraction();
    };
  }, [sweeping]);

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
      const result = await exportImage(
        source,
        { version: 1, adjustments: { exposure: exposure.current } },
        { format: 'png', maxDimension: 0 }
      );
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
            ref={canvas}
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

      <Text style={styles.label}>Exposure (EV)</Text>
      <Slider
        style={styles.slider}
        minimumValue={-3}
        maximumValue={3}
        value={0}
        onSlidingStart={() => canvas.current?.beginInteraction()}
        onValueChange={(value) => {
          exposure.current = value;
          canvas.current?.setAdjustment('exposure', value);
        }}
        onSlidingComplete={() => canvas.current?.endInteraction()}
      />

      <View style={styles.row}>
        <Button
          title={sweeping ? 'Stop sweep' : 'Auto-sweep'}
          onPress={() => setSweeping((s) => !s)}
        />
        <Button title="Export PNG" onPress={runExport} />
        {exported && <Button title="Share" onPress={() => Sharing.shareAsync(exported.uri)} />}
      </View>
      {exported && (
        <Text style={styles.info}>
          Exported {exported.width}x{exported.height} at EV {exposure.current.toFixed(2)} in{' '}
          {exported.totalMs.toFixed(0)}ms (render {exported.renderMs.toFixed(1)}ms)
        </Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function Button({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
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
  label: { color: '#ddd', marginBottom: 4 },
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
