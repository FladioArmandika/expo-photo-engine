import { Asset } from 'expo-asset';
import * as ImagePicker from 'expo-image-picker';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from './theme';

export function StartScreen({ onOpen }: { onOpen: (uri: string) => void }) {
  const insets = useSafeAreaInsets();

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      // Keep the original file (full resolution, HEIC stays HEIC) instead of a converted copy.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    const uri = result.assets?.[0]?.uri;
    if (uri) onOpen(uri);
  };

  const openChart = async () => {
    const [asset] = await Asset.loadAsync(require('../assets/parity-chart.png'));
    if (asset?.localUri) onOpen(asset.localUri);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.body}>
        <Text style={styles.title}>Photo Engine</Text>
        <Text style={styles.text}>
          The example app for expo-photo-engine. Open a big photo, 24MP or more, to see how it holds
          up.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={pickPhoto}
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
        <Text style={styles.primaryText}>Choose a photo</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={openChart}
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
        <Text style={styles.secondaryText}>Open the test chart</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.chrome, paddingHorizontal: 24 },
  body: { flex: 1, justifyContent: 'flex-end', paddingBottom: 40, gap: 12 },
  title: { color: colors.text, fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  text: { color: colors.dim, fontSize: 17, lineHeight: 24, maxWidth: 320 },
  primary: {
    height: 54,
    borderRadius: 10,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: colors.chrome, fontSize: 17, fontWeight: '700' },
  secondary: { height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  secondaryText: { color: colors.text, fontSize: 16 },
  pressed: { opacity: 0.7 },
});
