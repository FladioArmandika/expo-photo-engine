import { exportImage } from '@fladioarmandika/expo-photo-engine';
import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { GOLDEN_CASES } from './cases';

// Shown instead of the demo app when the bundle is built with EXPO_PUBLIC_GOLDEN_SERVER (CI only).
// Exports every golden case at full resolution and uploads the PNGs to that server.
const SERVER = process.env.EXPO_PUBLIC_GOLDEN_SERVER;

export default function GoldenRunner() {
  const [status, setStatus] = useState('starting');

  useEffect(() => {
    run(setStatus).catch(async (e) => {
      setStatus(`failed: ${e}`);
      await post(`/done?platform=${Platform.OS}&error=${encodeURIComponent(String(e))}`);
    });
  }, []);

  return (
    <View style={styles.screen}>
      <Text style={styles.text}>Golden export: {status}</Text>
    </View>
  );
}

async function run(setStatus: (status: string) => void) {
  const [asset] = await Asset.loadAsync(require('../assets/parity-chart.png'));
  if (!asset?.localUri) throw new Error('could not load the test chart');

  for (const [i, c] of GOLDEN_CASES.entries()) {
    setStatus(`${i + 1}/${GOLDEN_CASES.length} ${c.name}`);
    const result = await exportImage(asset.localUri, c.edits, { format: 'png', metadata: 'none' });
    // React Native reads file:// URIs into a Blob and can send one as a request body.
    const file = await (await fetch(result.uri)).blob();
    await post(`/upload?platform=${Platform.OS}&name=${encodeURIComponent(c.name)}`, file);
  }
  await post(`/done?platform=${Platform.OS}`);
  setStatus('done');
}

async function post(path: string, body?: Blob) {
  const response = await fetch(`${SERVER}${path}`, { method: 'POST', body });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  text: { color: '#fff' },
});
