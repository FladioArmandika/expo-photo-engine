# expo-photo-engine

[![npm](https://img.shields.io/npm/v/@fladioarmandika/expo-photo-engine)](https://www.npmjs.com/package/@fladioarmandika/expo-photo-engine) [![CI](https://github.com/FladioArmandika/expo-photo-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/FladioArmandika/expo-photo-engine/actions/workflows/ci.yml) [![license](https://img.shields.io/npm/l/@fladioarmandika/expo-photo-engine)](LICENSE)

Photo editing for Expo apps, with your own UI.

You make the sliders and buttons. This draws the photo with your edits on the GPU (Metal on iOS,
OpenGL on Android) and exports it. Both platforms give the same pixels.

```tsx
const editor = usePhotoEditor();

<PhotoCanvas source={uri} style={{ flex: 1 }} {...editor.canvasProps} />
<Slider {...editor.sliderProps('exposure')} />
<Button title="Undo" onPress={editor.undo} />
<Button title="Save" onPress={() => exportImage(uri, editor.getEdits())} />
```

Runs at 60 fps on an iPhone with a 24.5MP photo.

## What it can do

Exposure, contrast, highlights, shadows, saturation, vibrance, warmth, tint, sharpness, vignette,
HSL per color, tone curves, 11 filters (or your own), crop, rotate, straighten, flip, hold to
compare, undo, and export to JPEG, PNG or HEIC.

Edits are plain JSON, so you can save them and reopen the photo later with everything still
editable.

```ts
editor.setHsl('blue', 'luminance', -0.5);   // darker sky
editor.setCurve('rgb', [[0, 0.1], [1, 1]]); // faded blacks
editor.setFilter({ id: 'film', intensity: 0.8 });

const saved = serializeEditStack(editor.edits);
usePhotoEditor({ initialEdits: saved }); // pick up where you left off
```

## Install

```sh
npx expo install @fladioarmandika/expo-photo-engine
```

Needs a [development build](https://docs.expo.dev/develop/development-builds/introduction/) (not
Expo Go), Expo SDK 58+ with the New Architecture, iOS 16.4+ and Android 7+.

## Usage

### Sliders and undo

`editor.sliderProps(key)` works with `@react-native-community/slider`. Dragging doesn't re-render
your component, and each drag is one undo step.

`editor.edits` is what you save. `editor.getEdits()` also includes a drag in progress, so use it
for export. `editor.isDirty` tells you if there are unsaved changes.

<details>
<summary>Adjustment ranges</summary>

All are -1 to 1 except `exposure` (-3 to 3, in stops) and `sharpness` (0 to 1). 0 means unchanged.
`ADJUSTMENTS` has the ranges and labels if you want them for your sliders.

</details>

### HSL

8 colors (`red`, `orange`, `yellow`, `green`, `aqua`, `blue`, `purple`, `magenta`), each with
`hue`, `saturation` and `luminance` from -1 to 1.

```tsx
<Slider {...editor.hslSliderProps('blue', 'luminance')} />
```

### Tone curves

Curves for `rgb`, `red`, `green` and `blue`, as `[input, output]` points from 0 to 1. There's a
curve editor you can drop in:

```tsx
<ToneCurveEditor style={{ width: 200, height: 200 }} {...editor.curveEditorProps('rgb')} />
```

Tap to add a point, drag to move it, drag it out of the box to remove it.

### Filters

```ts
editor.setFilter({ id: 'film', intensity: 0.8 });
const thumbs = await renderFilterThumbnails(uri, editor.getEdits()); // for a picker
```

Built in: `vivid`, `golden`, `nordic`, `matte`, `film`, `teal-orange`, `chrome`, `dramatic`,
`mono`, `noir`, `sepia`.

<details>
<summary>Making your own</summary>

```ts
registerFilters([
  {
    id: 'warm',
    label: 'Warm',
    look: { slope: [1.05, 1, 0.92], offset: [0.02, 0.01, 0], saturation: 1.1 },
  },
]);
```

A look can also have `power`, `contrast`, `shadowTint`, `highlightTint` and `mixer` (3x3).

</details>

### Crop

```ts
editor.update(rotateRight);
editor.update(flipHorizontal);
editor.update((s) => withStraighten(s, 2.5));
editor.update((s) => withCrop(s, createCrop({ rect: [0.1, 0.1, 0.8, 0.8] })));
```

For a crop box with drag handles, turn on crop mode and put `CropOverlay` over the canvas:

```tsx
{editor.cropping && <CropOverlay {...editor.cropOverlayProps(photo)} style={StyleSheet.absoluteFill} />}
```

`photo` is what `PhotoCanvas` gives to `onLoad`.

### Before and after

```tsx
<Pressable {...editor.compareProps}>
  <PhotoCanvas source={uri} {...editor.canvasProps} />
</Pressable>
```

Hold the photo to see the original.

### Export

```ts
const { uri } = await exportImage(source, edits, {
  format: 'jpeg', // or 'png', 'heic'
  maxDimension: 4096,
  metadata: 'no-location',
});
```

Full size by default. Keeps the camera info from the original, and the location unless you say
`no-location`. You don't need a `PhotoCanvas` on screen to export.

## How it works

Both platforms run the same shader code, so the output matches. CI exports the same photo on the
iOS simulator and the Android emulator with every edit and fails if any pixel is more than 2/255
apart.

Slider moves never wait on React. They go straight to the native side, which draws once per screen
refresh.

## FAQ

**Why not Skia?**
You'd have to write the shaders, EXIF and HEIC handling, big-photo memory handling, export and
undo yourself. This is that, done.

**Production ready?**
It's 0.x, so the API may still change. Android has only been tested on the emulator so far.

**RAW, masks, text, LUT files?**
Not yet. [Open an issue](https://github.com/FladioArmandika/expo-photo-engine/issues) if you need
one.

## Contributing

```sh
npm install && cd example && npm install
npx expo run:ios --device --configuration Release
```

`npm test` runs the unit tests and `node scripts/check-glsl.mjs` checks the shaders. Use release
builds on a real phone when measuring speed.

## License

[MIT](LICENSE)
