import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { EditorScreen } from './ui/EditorScreen';
import { StartScreen } from './ui/StartScreen';

// A small photo editor built on the engine: pick a photo, edit it, export it.
export default function App() {
  const [source, setSource] = useState<string | null>(null);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {source ? (
        // Keyed by photo, so each one starts with fresh edits and history.
        <EditorScreen key={source} source={source} onClose={() => setSource(null)} />
      ) : (
        <StartScreen onOpen={setSource} />
      )}
    </SafeAreaProvider>
  );
}
