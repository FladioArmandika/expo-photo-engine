import {
  ADJUSTMENT_KEYS,
  BUILT_IN_FILTERS,
  createCrop,
  createEditStack,
  type EditStack,
} from '@fladioarmandika/expo-photo-engine';

// The edits CI exports on both the iOS simulator and the Android emulator. The two sets of PNGs
// are then compared pixel by pixel (scripts/golden-compare.mjs).
export const GOLDEN_CASES: { name: string; edits: EditStack }[] = [
  { name: 'original', edits: createEditStack() },
  ...ADJUSTMENT_KEYS.map((key) => ({
    name: `${key}`,
    edits: createEditStack({ adjustments: { [key]: key === 'exposure' ? 0.8 : 0.6 } }),
  })),
  ...BUILT_IN_FILTERS.map((filter) => ({
    name: `filter-${filter.id}`,
    edits: createEditStack({ filter: { id: filter.id, intensity: 1 } }),
  })),
  {
    name: 'crop-rotate-flip',
    edits: createEditStack({
      crop: createCrop({ rect: [0.1, 0.2, 0.5, 0.6], rotation: 90, flipH: true }),
    }),
  },
  {
    name: 'straighten',
    edits: createEditStack({ crop: createCrop({ rect: [0.2, 0.2, 0.6, 0.6], straighten: 7.5 }) }),
  },
  {
    name: 'everything',
    edits: createEditStack({
      crop: createCrop({ rect: [0, 0.25, 0.75, 0.75], rotation: 270 }),
      adjustments: {
        exposure: 0.3,
        contrast: 0.25,
        highlights: -0.6,
        shadows: 0.5,
        saturation: 0.15,
        vibrance: 0.3,
        warmth: 0.2,
        tint: -0.1,
        sharpness: 0.4,
        vignette: -0.35,
      },
      filter: { id: 'film', intensity: 0.7 },
    }),
  },
];
