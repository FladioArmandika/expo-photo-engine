import {
  ADJUSTMENT_KEYS,
  ADJUSTMENTS,
  CropOverlay,
  exportImage,
  flipHorizontal,
  PhotoCanvas,
  renderFilterThumbnails,
  rotateRight,
  usePhotoEditor,
  withCropAspect,
  withStraighten,
  type AdjustmentKey,
  type CropAspect,
  type ExportFormat,
  type ExportResult,
  type FilterThumbnail,
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
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// Test screen: every adjustment rendered by the native shader. usePhotoEditor sends slider ticks
// straight to the canvas, so dragging never causes a React render, and makes each drag one undo step.
export default function App() {
  const editor = usePhotoEditor();
  // One control at a time: an adjustment, the straighten angle, or the filter picker.
  const [active, setActive] = useState<AdjustmentKey | 'straighten' | 'filters'>('exposure');
  const [source, setSource] = useState<string | null>(null);
  const [quality, setQuality] = useState<PreviewQuality>('auto');
  const [load, setLoad] = useState<LoadEvent | null>(null);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [error, setError] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<FilterThumbnail[]>([]);

  // Filter thumbnails show the photo as currently cropped and adjusted, so re-render them when
  // either changes. Picking a filter doesn't change them.
  const { crop, adjustments } = editor.edits;
  const thumbnailKey = JSON.stringify([source, crop, adjustments]);
  useEffect(() => {
    if (!source || active !== 'filters') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      renderFilterThumbnails(source, editor.getEdits(), { maxDimension: 160 })
        .then((result) => !cancelled && setThumbnails(result))
        .catch((e) => setError(String(e)));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [thumbnailKey, active]);

  // Auto-sweep the selected adjustment every frame from JS (the "stress test" input), no hands needed.
  useEffect(() => {
    if (!sweeping || active === 'filters') return;
    const { controller } = editor;
    controller.beginGesture();
    const { min, max } = active === 'straighten' ? { min: -20, max: 20 } : ADJUSTMENTS[active];
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = (Math.sin((now - start) / 600) + 1) / 2;
      const value = min + (max - min) * (min < 0 ? 0.15 + t * 0.7 : t);
      if (active === 'straighten') controller.update((s) => withStraighten(s, value));
      else controller.setAdjustment(active, value);
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
        format,
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
          // Hold the photo to see it without edits.
          <Pressable
            {...editor.compareProps}
            disabled={editor.cropping}
            style={StyleSheet.absoluteFill}>
            <PhotoCanvas
              {...editor.canvasProps}
              source={source}
              previewQuality={quality}
              style={StyleSheet.absoluteFill}
              onLoad={setLoad}
              onError={(e) => setError(e.message)}
              onRenderStats={setStats}
            />
          </Pressable>
        ) : (
          <Text style={styles.hint}>Pick a 24MP+ photo or use the parity chart.</Text>
        )}
        {source && load && editor.cropping && (
          <CropOverlay
            {...editor.cropOverlayProps(load)}
            // Same size as the canvas, so the box lines up with the photo.
            style={StyleSheet.absoluteFill}
          />
        )}
        {editor.comparing && (
          <View style={styles.badge} pointerEvents="none">
            <Text style={styles.badgeText}>Original</Text>
          </View>
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
        <Pressable
          style={[styles.chip, active === 'straighten' && styles.chipActive]}
          onPress={() => setActive('straighten')}>
          <Text style={styles.chipText}>Straighten</Text>
        </Pressable>
        <Pressable
          style={[styles.chip, active === 'filters' && styles.chipActive]}
          onPress={() => setActive('filters')}>
          <Text style={styles.chipText}>Filters</Text>
        </Pressable>
      </ScrollView>
      {active === 'filters' ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbnails}>
            {thumbnails.map((t) => {
              const selected = (editor.edits.filter?.id ?? null) === t.id;
              return (
                <Pressable
                  key={t.id ?? 'original'}
                  onPress={() =>
                    editor.setFilter(t.id === null ? null : { id: t.id, intensity: 1 })
                  }>
                  <Image
                    source={{ uri: t.uri }}
                    style={[styles.thumbnail, selected && styles.thumbnailSelected]}
                  />
                  <Text style={styles.thumbnailLabel}>{t.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {editor.edits.filter && <Slider style={styles.slider} {...editor.filterSliderProps()} />}
        </>
      ) : active === 'straighten' ? (
        <Slider
          style={styles.slider}
          minimumValue={-45}
          maximumValue={45}
          value={editor.edits.crop?.straighten ?? 0}
          onSlidingStart={editor.beginGesture}
          onValueChange={(value) => editor.update((s) => withStraighten(s, value))}
          onSlidingComplete={editor.endGesture}
        />
      ) : (
        <Slider key={active} style={styles.slider} {...editor.sliderProps(active)} />
      )}

      <View style={styles.row}>
        <Button title="Rotate" onPress={() => editor.update(rotateRight)} />
        <Button title="Flip" onPress={() => editor.update(flipHorizontal)} />
        {load && (
          <Button
            title={editor.cropping ? 'Done' : 'Crop'}
            onPress={() => editor.setCropping(!editor.cropping)}
          />
        )}
      </View>
      {load && editor.cropping && (
        <View style={[styles.row, styles.aspects]}>
          {ASPECTS.map((aspect) => (
            <Button
              key={aspect}
              title={aspect}
              selected={(editor.edits.crop?.aspect ?? 'free') === aspect}
              onPress={() =>
                editor.update((s) => withCropAspect(s, aspect, load.sourceWidth, load.sourceHeight))
              }
            />
          ))}
        </View>
      )}

      <View style={styles.row}>
        <Button
          title={sweeping ? 'Stop sweep' : 'Auto-sweep'}
          onPress={() => setSweeping((s) => !s)}
        />
        <Button title="Undo" disabled={!editor.canUndo} onPress={editor.undo} />
        <Button title="Redo" disabled={!editor.canRedo} onPress={editor.redo} />
        <Button title="Reset" onPress={() => editor.reset()} />
        <Button
          title={format.toUpperCase()}
          onPress={() => setFormat((f) => (f === 'png' ? 'jpeg' : f === 'jpeg' ? 'heic' : 'png'))}
        />
        <Button title="Export" onPress={runExport} />
        {exported && <Button title="Share" onPress={() => Sharing.shareAsync(exported.uri)} />}
      </View>
      {exported && (
        <Text style={styles.info}>
          Exported {exported.width}x{exported.height} in {exported.totalMs.toFixed(0)}ms (render{' '}
          {exported.renderMs.toFixed(1)}ms){exported.metadata ? ', metadata kept' : ''}
        </Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const ASPECTS: CropAspect[] = ['free', 'original', '1:1', '4:5', '16:9'];

function Button({
  title,
  onPress,
  disabled,
  selected,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        selected && styles.selected,
        (pressed || disabled) && styles.pressed,
      ]}
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
  badge: {
    position: 'absolute',
    right: 8,
    top: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
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
  thumbnails: { gap: 8, paddingVertical: 6 },
  thumbnail: { width: 64, height: 64, borderRadius: 6, borderWidth: 2, borderColor: 'transparent' },
  thumbnailSelected: { borderColor: '#fff' },
  thumbnailLabel: { color: '#ccc', fontSize: 11, textAlign: 'center', marginTop: 2 },
  button: {
    backgroundColor: '#2a2a2e',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  pressed: { opacity: 0.6 },
  selected: { backgroundColor: '#55555c' },
  aspects: { marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
  info: { color: '#bbb', marginTop: 8 },
  error: { color: '#ff6b6b', marginTop: 8 },
});
