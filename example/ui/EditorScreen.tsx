import { Ionicons } from '@expo/vector-icons';
import {
  CropOverlay,
  PhotoCanvas,
  usePhotoEditor,
  type AdjustmentKey,
  type CurveChannel,
  type HslColor,
  type LoadEvent,
  type PreviewQuality,
  type RenderStats,
} from '@fladioarmandika/expo-photo-engine';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DevOverlay } from './DevOverlay';
import { ExportSheet } from './ExportSheet';
import { IconButton, TextButton, tick } from './controls';
import { AdjustPanel } from './panels/AdjustPanel';
import { ColorPanel } from './panels/ColorPanel';
import { CropPanel } from './panels/CropPanel';
import { CurvesPanel } from './panels/CurvesPanel';
import { FilterPanel } from './panels/FilterPanel';
import { colors } from './theme';

type Tool = 'filters' | 'adjust' | 'color' | 'curves' | 'crop';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'filters', label: 'Filters' },
  { id: 'adjust', label: 'Adjust' },
  { id: 'color', label: 'Color' },
  { id: 'curves', label: 'Curves' },
  { id: 'crop', label: 'Crop' },
];

// usePhotoEditor sends slider moves straight to the canvas, so dragging never re-renders this
// screen. Only the slider being dragged re-renders, to show its value.
export function EditorScreen({ source, onClose }: { source: string; onClose: () => void }) {
  const editor = usePhotoEditor();
  const insets = useSafeAreaInsets();
  const [tool, setTool] = useState<Tool>('adjust');
  const [adjustment, setAdjustment] = useState<AdjustmentKey>('exposure');
  const [hslColor, setHslColor] = useState<HslColor>('orange');
  const [curveChannel, setCurveChannel] = useState<CurveChannel>('rgb');
  const [photo, setPhoto] = useState<LoadEvent | null>(null);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [quality, setQuality] = useState<PreviewQuality>('auto');
  const [showStats, setShowStats] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compared, setCompared] = useState(false);
  if (editor.comparing && !compared) setCompared(true);

  const selectTool = (next: Tool) => {
    tick();
    setTool(next);
    // The crop box only shows on the Crop tab.
    editor.setCropping(next === 'crop');
  };

  const close = () => {
    if (!editor.isDirty) return onClose();
    Alert.alert('Discard your edits?', 'They haven’t been exported.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + 4 }]}>
        <View style={styles.topSide}>
          <IconButton icon="close" label="Close" onPress={close} />
          <IconButton
            icon="pulse-outline"
            label="Show speed"
            onPress={() => setShowStats((s) => !s)}
          />
        </View>
        <View style={styles.topCenter}>
          <IconButton
            icon="arrow-undo"
            label="Undo"
            disabled={!editor.canUndo}
            onPress={editor.undo}
          />
          <IconButton
            icon="arrow-redo"
            label="Redo"
            disabled={!editor.canRedo}
            onPress={editor.redo}
          />
        </View>
        <View style={[styles.topSide, styles.topRight]}>
          <TextButton strong title="Export" disabled={!photo} onPress={() => setExporting(true)} />
        </View>
      </View>

      <View style={styles.stage}>
        <View style={styles.frame}>
          {/* Hold the photo to see it without edits. */}
          <Pressable
            {...editor.compareProps}
            disabled={editor.cropping}
            style={StyleSheet.absoluteFill}>
            <PhotoCanvas
              {...editor.canvasProps}
              source={source}
              previewQuality={quality}
              style={StyleSheet.absoluteFill}
              onLoad={setPhoto}
              onError={(e) => setError(e.message)}
              onRenderStats={showStats ? setStats : undefined}
            />
          </Pressable>
          {photo && editor.cropping && (
            // Same size as the canvas, so the box lines up with the photo.
            <CropOverlay {...editor.cropOverlayProps(photo)} style={StyleSheet.absoluteFill} />
          )}
        </View>
        {!photo && !error && <ActivityIndicator style={styles.spinner} color={colors.dim} />}
        {editor.comparing && (
          <View style={styles.badge} pointerEvents="none">
            <Text style={styles.badgeText}>Original</Text>
          </View>
        )}
        {editor.isDirty && !compared && !editor.cropping && (
          <View style={styles.hint} pointerEvents="none">
            <Text style={styles.hintText}>Hold the photo to see the original</Text>
          </View>
        )}
        {showStats && (
          <DevOverlay
            editor={editor}
            photo={photo}
            stats={stats}
            sweepKey={adjustment}
            quality={quality}
            onQualityChange={setQuality}
          />
        )}
        {error && (
          <Pressable style={styles.error} onPress={() => setError(null)}>
            <Ionicons name="warning-outline" size={16} color={colors.danger} />
            <Text style={styles.errorText} numberOfLines={3}>
              {error}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.dock, { paddingBottom: insets.bottom }]}>
        <View style={styles.panel}>
          {tool === 'filters' && <FilterPanel editor={editor} source={source} onError={setError} />}
          {tool === 'adjust' && (
            <AdjustPanel editor={editor} active={adjustment} onSelect={setAdjustment} />
          )}
          {tool === 'color' && (
            <ColorPanel editor={editor} color={hslColor} onSelect={setHslColor} />
          )}
          {tool === 'curves' && (
            <CurvesPanel editor={editor} channel={curveChannel} onSelect={setCurveChannel} />
          )}
          {tool === 'crop' && <CropPanel editor={editor} photo={photo} />}
        </View>
        <View style={styles.tabs}>
          {TOOLS.map((t) => {
            const selected = t.id === tool;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => selectTool(t.id)}
                style={styles.tab}>
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ExportSheet
        visible={exporting}
        source={source}
        getEdits={editor.getEdits}
        onExported={editor.markSaved}
        onClose={() => setExporting(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.chrome },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  topSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  topRight: { justifyContent: 'flex-end', paddingRight: 4 },
  topCenter: { flexDirection: 'row', gap: 12 },
  stage: { flex: 1, backgroundColor: colors.surround },
  frame: { position: 'absolute', top: 16, right: 16, bottom: 16, left: 16 },
  spinner: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  badge: {
    position: 'absolute',
    top: 24,
    left: 24,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  hint: { position: 'absolute', bottom: 22, alignSelf: 'center' },
  hintText: { color: colors.dim, fontSize: 12 },
  badgeText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  error: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: colors.chrome,
    borderRadius: 8,
    padding: 12,
  },
  errorText: { color: colors.text, flex: 1, fontSize: 13 },
  dock: { backgroundColor: colors.chrome },
  panel: { height: 212, paddingHorizontal: 20, justifyContent: 'center' },
  tabs: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabText: { color: colors.dim, fontSize: 14 },
  tabTextSelected: { color: colors.text, fontWeight: '700' },
});
