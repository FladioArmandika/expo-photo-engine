import {
  exportImage,
  type EditStack,
  type ExportFormat,
  type ExportResult,
} from '@fladioarmandika/expo-photo-engine';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Segmented, TextButton } from './controls';
import { colors } from './theme';

type Size = 'full' | '4096' | '2048';

export function ExportSheet({
  visible,
  source,
  getEdits,
  onExported,
  onClose,
}: {
  visible: boolean;
  source: string;
  getEdits: () => EditStack;
  onExported: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [format, setFormat] = useState<ExportFormat>('jpeg');
  const [size, setSize] = useState<Size>('full');
  const [location, setLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const exported = await exportImage(source, getEdits(), {
        format,
        maxDimension: size === 'full' ? 0 : Number(size),
        metadata: location ? 'all' : 'no-location',
      });
      setResult(exported);
      onExported();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        {result ? (
          <>
            <Text style={styles.title}>Exported</Text>
            <Text style={styles.summary}>
              {result.width} × {result.height} {format.toUpperCase()} in{' '}
              {(result.totalMs / 1000).toFixed(1)}s{result.metadata ? ', camera info kept' : ''}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => Sharing.shareAsync(result.uri)}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              <Text style={styles.buttonText}>Share</Text>
            </Pressable>
            <View style={styles.done}>
              <TextButton title="Done" onPress={close} />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.title}>Export</Text>
            <Text style={styles.label}>Format</Text>
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: 'jpeg', label: 'JPEG' },
                { value: 'heic', label: 'HEIC' },
                { value: 'png', label: 'PNG' },
              ]}
            />
            <Text style={styles.label}>Size</Text>
            <Segmented
              value={size}
              onChange={setSize}
              options={[
                { value: 'full', label: 'Full' },
                { value: '4096', label: '4096 px' },
                { value: '2048', label: '2048 px' },
              ]}
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Include location</Text>
              <Switch
                value={location}
                onValueChange={setLocation}
                trackColor={{ true: colors.text, false: colors.raised }}
              />
            </View>
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={run}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              {busy ? (
                <ActivityIndicator color={colors.chrome} />
              ) : (
                <Text style={styles.buttonText}>Export photo</Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.chrome,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.raised,
    marginBottom: 14,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  summary: { color: colors.dim, fontSize: 15, marginBottom: 4 },
  label: { color: colors.dim, fontSize: 13, marginTop: 14, marginBottom: 8 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  switchLabel: { color: colors.text, fontSize: 15 },
  error: { color: colors.danger, marginTop: 14 },
  button: {
    marginTop: 24,
    height: 50,
    borderRadius: 10,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  buttonText: { color: colors.chrome, fontSize: 16, fontWeight: '700' },
  done: { alignItems: 'center', marginTop: 8 },
});
