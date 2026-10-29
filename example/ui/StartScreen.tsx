import { Ionicons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import * as ImagePicker from 'expo-image-picker';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.center}>
        <View style={styles.logo}>
          <Ionicons name="aperture-outline" size={40} color={colors.accent} />
        </View>
        <Text style={styles.title}>Photo Engine</Text>
        <Text style={styles.subtitle}>
          Pick a photo and edit it. Big ones work too, try something over 24MP.
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={pickPhoto}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
          <Ionicons name="images-outline" size={20} color={colors.onAccent} />
          <Text style={styles.primaryText}>Choose a photo</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={openChart}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
          <Text style={styles.secondaryText}>Use the test chart</Text>
        </Pressable>
        <Text style={styles.footer}>
          {Platform.OS === 'ios' ? 'iOS' : 'Android'} {Platform.Version}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  subtitle: {
    color: colors.textDim,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 300,
  },
  actions: { gap: 8 },
  primary: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryText: { color: colors.onAccent, fontSize: 17, fontWeight: '700' },
  secondary: { height: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.text, fontSize: 16, fontWeight: '500' },
  pressed: { opacity: 0.7 },
  footer: { color: colors.textFaint, fontSize: 12, textAlign: 'center', marginTop: 4 },
});
