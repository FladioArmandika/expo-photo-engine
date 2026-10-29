# expo-photo-engine

[![npm](https://img.shields.io/npm/v/@fladioarmandika/expo-photo-engine)](https://www.npmjs.com/package/@fladioarmandika/expo-photo-engine) [![CI](https://github.com/FladioArmandika/expo-photo-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/FladioArmandika/expo-photo-engine/actions/workflows/ci.yml) [![license](https://img.shields.io/npm/l/@fladioarmandika/expo-photo-engine)](LICENSE)

The photo editor part of a photo editing app, for Expo.

You build the screen. This does the rest: draws the photo with your edits on the GPU, handles undo, and exports the result. iOS and Android give the same pixels.

```tsx
const editor = usePhotoEditor();

<PhotoCanvas source={uri} style={{ flex: 1 }} {...editor.canvasProps} />
<Slider {...editor.sliderProps('exposure')} />
<Button title="Undo" onPress={editor.undo} />
<Button title="Save" onPress={() => exportImage(uri, editor.getEdits())} />
```

That's a working editor. It runs at 60 fps on a 24.5MP photo on an iPhone.

## What can it do?

**Make the sky darker.**

```ts
editor.setHsl('blue', 'luminance', -0.5);
```

**Get that faded film look.**

```ts
editor.setCurve('rgb', [[0, 0.1], [1, 1]]);
editor.setFilter({ id: 'film', intensity: 0.8 });
```

**Let users come back tomorrow and keep editing.**

```ts
const saved = serializeEditStack(editor.edits); // plain JSON, store it anywhere
usePhotoEditor({ initialEdits: saved });
```

Also: contrast, highlights, shadows, saturation, vibrance, warmth, tint, sharpness, vignette, 11 built-in filters (or your own), crop, rotate, straighten, flip, and hold to see the original.

## Use it

```sh
npx expo install @fladioarmandika/expo-photo-engine
```

Needs a [development build](https://docs.expo.dev/develop/development-builds/introduction/) (not Expo Go), Expo SDK 58+ with the New Architecture, iOS 16.4+ and Android 7+.

Everything goes through `usePhotoEditor()`. Spread its props onto your controls:

```tsx
<Slider {...editor.sliderProps('contrast')} />           // @react-native-community/slider
<Slider {...editor.hslSliderProps('orange', 'saturation')} />
<ToneCurveEditor {...editor.curveEditorProps('rgb')} />  // drag points on a curve
<Pressable {...editor.compareProps}>{canvas}</Pressable> // hold to see the original
{editor.cropping && <CropOverlay {...editor.cropOverlayProps(photo)} />}
```

Dragging a slider doesn't re-render your component, and each drag is one undo step.

Export when you're done:

```ts
await exportImage(uri, editor.getEdits(), { format: 'jpeg', metadata: 'no-location' });
```

Full size by default. JPEG, PNG or HEIC. Camera info is kept, and so is the location unless you say `no-location`.

<details>
<summary>The whole API</summary>

| | What it does |
| --- | --- |
| `sliderProps(key)` | Props for an adjustment slider. All go from -1 to 1, except `exposure` (-3 to 3) and `sharpness` (0 to 1) |
| `hslSliderProps(color, channel)` | `red`, `orange`, `yellow`, `green`, `aqua`, `blue`, `purple`, `magenta` × `hue`, `saturation`, `luminance` |
| `setCurve(channel, points)` | `rgb`, `red`, `green` or `blue`, with `[input, output]` points from 0 to 1 |
| `setFilter({ id, intensity })` | `vivid`, `golden`, `nordic`, `matte`, `film`, `teal-orange`, `chrome`, `dramatic`, `mono`, `noir`, `sepia`, or `null` |
| `update(fn)` | Apply a change like `rotateRight`, `flipHorizontal` or `(s) => withStraighten(s, 2.5)` |
| `undo()`, `redo()` | What you'd expect |
| `edits` | The current edits, to save |
| `getEdits()` | Same, plus a drag that's still going. Use this for export |
| `isDirty` | Are there unsaved changes? |
| `renderFilterThumbnails(uri, edits)` | Small previews for a filter picker |
| `registerFilters([...])` | Add your own filters (see below) |

</details>

<details>
<summary>Making your own filter</summary>

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

## How it works

The same shader code runs on both platforms: Metal on iOS, OpenGL on Android. To make sure they really match, CI edits the same photo on an iPhone simulator and an Android emulator and fails if any pixel is more than 2/255 apart.

Slider moves skip React entirely. They go straight to native, which draws once per screen refresh.

## FAQ

**Why not just use Skia?**
You could. Then you'd write the shaders, EXIF and HEIC handling, memory handling for big photos, export and undo yourself. This is all of that, already done.

**Can I use it in production?**
It's 0.x, so the API can still change. Android has only been tested on the emulator so far.

**RAW? Masks? Text? LUT files?**
Not yet. [Open an issue](https://github.com/FladioArmandika/expo-photo-engine/issues) if you need one.

## Contributing

<details>
<summary>Building and testing</summary>

```sh
npm install && cd example && npm install
npx expo run:ios --device --configuration Release
```

`npm test` runs the unit tests and `node scripts/check-glsl.mjs` checks the shaders. Measure speed with a release build on a real phone, not a debug build.

</details>

## License

[MIT](LICENSE)
