import type { FilterDefinition, RGB } from './types';

// Rec. 709 luma weights: three of these rows turn a photo black and white.
const LUMA: RGB = [0.2126, 0.7152, 0.0722];

/** The filters that ship with the engine, in display order. */
export const BUILT_IN_FILTERS: readonly FilterDefinition[] = [
  {
    id: 'vivid',
    label: 'Vivid',
    look: { contrast: 0.2, saturation: 1.3, slope: [1.03, 1.03, 1.03], offset: [-0.01, -0.01, -0.01] },
  },
  {
    id: 'golden',
    label: 'Golden',
    look: {
      slope: [1.06, 1.01, 0.9],
      offset: [0.015, 0.01, 0],
      saturation: 1.05,
      highlightTint: [0.03, 0.015, -0.03],
    },
  },
  {
    id: 'nordic',
    label: 'Nordic',
    look: {
      slope: [0.94, 0.99, 1.05],
      offset: [0, 0.005, 0.02],
      saturation: 0.85,
      contrast: 0.1,
      shadowTint: [-0.02, 0, 0.03],
    },
  },
  {
    id: 'matte',
    label: 'Matte',
    look: {
      slope: [0.86, 0.86, 0.86],
      offset: [0.09, 0.085, 0.08],
      contrast: -0.15,
      saturation: 0.85,
    },
  },
  {
    id: 'film',
    label: 'Film',
    look: {
      slope: [0.95, 0.95, 0.93],
      offset: [0.04, 0.035, 0.04],
      power: [1, 1.02, 1.06],
      contrast: 0.15,
      saturation: 0.9,
      shadowTint: [-0.02, 0.01, 0.02],
      highlightTint: [0.03, 0.01, -0.02],
    },
  },
  {
    id: 'teal-orange',
    label: 'Teal & Orange',
    look: {
      contrast: 0.2,
      saturation: 1.1,
      shadowTint: [-0.05, 0.02, 0.06],
      highlightTint: [0.06, 0.02, -0.05],
    },
  },
  {
    id: 'chrome',
    label: 'Chrome',
    look: { contrast: 0.3, saturation: 1.15, power: [1.05, 1, 0.95], slope: [1, 1, 1.03] },
  },
  {
    id: 'dramatic',
    label: 'Dramatic',
    look: { contrast: 0.45, saturation: 0.75, power: [1.12, 1.12, 1.12], slope: [1.08, 1.08, 1.08] },
  },
  {
    id: 'mono',
    label: 'Mono',
    look: { mixer: [LUMA, LUMA, LUMA], contrast: 0.1 },
  },
  {
    id: 'noir',
    label: 'Noir',
    // Weighted towards red, like a red lens filter on black-and-white film: skies go darker.
    look: {
      mixer: [
        [0.5, 0.45, 0.05],
        [0.5, 0.45, 0.05],
        [0.5, 0.45, 0.05],
      ],
      contrast: 0.5,
      power: [1.1, 1.1, 1.1],
    },
  },
  {
    id: 'sepia',
    label: 'Sepia',
    look: {
      mixer: [LUMA, LUMA, LUMA],
      slope: [1.05, 0.95, 0.78],
      offset: [0.04, 0.03, 0.02],
      contrast: 0.05,
    },
  },
];
