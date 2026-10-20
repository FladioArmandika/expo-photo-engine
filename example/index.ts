import { registerRootComponent } from 'expo';

import App from './App';
import GoldenRunner from './golden/GoldenRunner';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
// CI builds the bundle with EXPO_PUBLIC_GOLDEN_SERVER set to run the golden-image export instead.
registerRootComponent(process.env.EXPO_PUBLIC_GOLDEN_SERVER ? GoldenRunner : App);
