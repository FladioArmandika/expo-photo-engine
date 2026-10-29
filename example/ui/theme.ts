import { Platform } from 'react-native';

export const colors = {
  background: '#000',
  panel: '#0f0f11',
  surface: '#1c1c1f',
  surfaceHigh: '#2c2c31',
  border: '#26262a',
  text: '#f2f2f3',
  textDim: '#8e8e93',
  textFaint: '#55555b',
  accent: '#ffd60a',
  onAccent: '#111',
  danger: '#ff453a',
};

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });
