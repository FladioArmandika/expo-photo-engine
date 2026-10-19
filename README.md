<div align="center">

# expo-photo-engine

**A native photo-editing engine for Expo. Your UI, our GPU.**

[![npm](https://img.shields.io/npm/v/@fladioarmandika/expo-photo-engine?color=cb3837)](https://www.npmjs.com/package/@fladioarmandika/expo-photo-engine)
![platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-blue)
![expo](https://img.shields.io/badge/Expo%20SDK-58-000020)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<!-- DEMO: side-by-side stress-test video (Android left, iPhone right, stats overlay visible) goes here. -->
<em>Demo video coming soon: 48MP photo, live sliders, Android and iPhone side by side.</em>

</div>

You build the editor UI: sliders, filter strips, crop handles, in your own design system.
The engine renders the live preview and the full-resolution export natively, on the GPU, with the
same result on iOS and Android.

> [!WARNING]
> **Pre-alpha.** The ten adjustments and PNG/JPEG export work and are being benchmarked on
> devices. Crop and filters are not built yet. Everything marked _planned_ below is the v1 target,
> not shipped code. Don't use it in production yet.

## Why

The last real photo-filter toolkit for React Native,
[react-native-image-filter-kit](https://github.com/iyegoroff/react-native-image-filter-kit), was
abandoned in 2022. Every option since is a pop-up editor: you call `open(path)`, a third-party
full-screen UI takes over your app, and you get a file back. You can't style it, it looks
different on Android and iOS, and the edit is baked into the pixels.

`expo-photo-engine` moves the whole pipeline to native and gives the UI back to you.

## At a glance

```tsx
import {
  createEditStack,
  exportImage,
  PhotoCanvas,
  type PhotoCanvasRef,
} from '@fladioarmandika/expo-photo-engine';
import Slider from '@react-native-community/slider';
import { useRef } from 'react';
import { Button } from 'react-native';

export function Editor({ uri }: { uri: string }) {
  const canvas = useRef<PhotoCanvasRef>(null);
  const exposure = useRef(0);

  return (
    <>
      <PhotoCanvas ref={canvas} source={uri} style={{ flex: 1 }} />
      <Slider
        minimumValue={-3}
        maximumValue={3}
        onSlidingStart={() => canvas.current?.beginInteraction()}
        // Goes straight to the GPU: no setState, no React re-render per tick.
        onValueChange={(v) => {
          exposure.current = v;
          canvas.current?.setAdjustment('exposure', v);
        }}
        onSlidingComplete={() => canvas.current?.endInteraction()}
      />
      <Button
        title="Save"
        onPress={() =>
          exportImage(uri, createEditStack({ adjustments: { exposure: exposure.current } }), { format: 'jpeg' })
        }
      />
    </>
  );
}
```

## Why not a pop-up editor?

| | Pop-up editors | expo-photo-engine |
| --- | --- | --- |
| UI | Theirs, full screen | Yours, any layout |
| iOS vs Android | Usually two different native editors | One shader pipeline, same pixels |
| Result | A flattened image file | A JSON edit stack you can save and **re-edit later**, plus an export |
| Undo / redo | Inside their UI only | Yours, on the edit stack |
| Headless export | No | Yes, without a mounted view |

## Why not Skia?

You can build this on [React Native Skia](https://shopify.github.io/react-native-skia/), and for
custom drawing it's the right tool. For a photo editor you would still have to write and maintain:

- the adjustment shaders, and keep them looking right,
- decoding with EXIF orientation, color-space handling (Display P3, HEIC) and memory-safe
  downscaling of 24 to 48MP photos,
- full-resolution export that matches the preview, off the UI thread,
- a serializable, versioned edit format with undo/redo.

That is this library. It also renders directly with Metal and OpenGL ES rather than through a
general-purpose 2D canvas.

## Features

| Feature | Status |
| --- | --- |
| `PhotoCanvas` native view, Metal (iOS) / OpenGL ES 3 (Android) | ✅ spike |
| Imperative updates coalesced to the display refresh (60/120Hz) | ✅ spike |
| Render stats: fps, CPU/GPU frame time, input latency, preview size | ✅ spike |
| Exposure, contrast, highlights, shadows, saturation, vibrance, warmth, tint, sharpness, vignette | ✅ |
| Headless export (PNG, JPEG) | ✅ spike |
| Crop, 90° rotation, straighten, flip + optional `CropOverlay` | planned |
| LUT filters with intensity, filter catalog as data, live thumbnails | planned |
| Edit stack: types, validation, migration, undo/redo history | ✅ |
| `usePhotoEditor` hook binding history to the canvas | planned |
| HEIC export, metadata (EXIF) preservation | planned |
| Cross-platform golden-image tests in CI | planned |

## Installation

Requires a [development build](https://docs.expo.dev/develop/development-builds/introduction/).
It does not run in Expo Go, because it contains native code.

### Expo

```sh
npx expo install @fladioarmandika/expo-photo-engine
npx expo prebuild   # or let EAS Build do it
```

### Bare React Native

Install and configure [Expo Modules](https://docs.expo.dev/bare/installing-expo-modules/) first,
then:

```sh
npm install @fladioarmandika/expo-photo-engine
npx pod-install
```

**Minimum versions:** iOS 16.4 (set by Expo SDK 58), Android 7.0 / API 24 (tested from API 26).

## API

### `<PhotoCanvas>`

A native view that renders `source` with the current edits.

| Prop | Type | Description |
| --- | --- | --- |
| `source` | `string` | `file://` URI or absolute path of a JPEG, HEIC or PNG. `content://` on Android. |
| `edits` | `EditStack` | Initial edit stack. For live dragging use the ref methods. |
| `previewQuality` | `'auto' \| 'fast' \| 'full'` | `auto`: preview sized to the view's pixels. `fast`: half that. `full`: full resolution, clamped to the GPU's max texture size. |
| `onLoad` | `(e: LoadEvent) => void` | Source and preview size, decode time. |
| `onError` | `(e: { message: string }) => void` | Decode or GPU errors. |
| `onRenderStats` | `(s: RenderStats) => void` | About twice a second while rendering: `fps`, `frameTimeMs`, `gpuTimeMs` (iOS), `latencyMs`, preview and source size. |

**Ref methods.** None of them cause a React render.

| Method | Description |
| --- | --- |
| `setAdjustment(key, value)` | Update one adjustment. Safe to call on every slider tick. |
| `setEdits(stack)` | Replace the whole edit stack. |
| `beginInteraction()` / `endInteraction()` | Mark a gesture. Stats are reported for the gesture window; later this also switches to a fast proxy while dragging. |

### `exportImage(source, edits, options?)`

Renders `edits` onto `source` with the same shaders as the preview and writes a file to the cache
directory. Works without a mounted view.

```ts
const { uri, width, height, totalMs, renderMs } = await exportImage(source, edits, {
  format: 'jpeg',     // 'png' | 'jpeg'  (heic planned)
  quality: 0.92,      // JPEG only
  maxDimension: 4096, // 0 = full resolution
});
```

### `EditStack`

Edits are plain, versioned JSON. Save them anywhere and reopen the photo later with every edit
still adjustable.

```json
{
  "version": 1,
  "crop": null,
  "adjustments": { "exposure": 0.4, "contrast": 0.15 },
  "filter": null
}
```

```ts
import { createEditStack, withAdjustment, migrateEditStack, serializeEditStack, EditHistory } from '@fladioarmandika/expo-photo-engine';

let stack = withAdjustment(createEditStack(), 'exposure', 0.4); // clamped to the documented range
const saved = serializeEditStack(stack);                         // stable JSON, store it anywhere
stack = migrateEditStack(saved);                                 // validates and upgrades older versions

const history = new EditHistory(stack);                          // undo/redo, one step per gesture
history.commit(withAdjustment(stack, 'contrast', 0.15));
history.undo();
```

| Adjustment | Range | What it does |
| --- | --- | --- |
| `exposure` | -3 to 3 | Brightness in EV stops, applied in linear light like a camera would. |
| `contrast` | -1 to 1 | Positive pushes towards an S-curve, negative flattens towards gray. |
| `highlights` | -1 to 1 | Darkens (negative) or brightens (positive) the bright parts only. |
| `shadows` | -1 to 1 | Lifts (positive) or deepens (negative) the dark parts only. |
| `saturation` | -1 to 1 | -1 is black and white. |
| `vibrance` | -1 to 1 | Like saturation, but mostly moves muted colors and leaves vivid ones alone. |
| `warmth` | -1 to 1 | Blue (negative) to orange (positive). |
| `tint` | -1 to 1 | Green (negative) to magenta (positive). |
| `sharpness` | 0 to 1 | Unsharp mask. It works per pixel, so a downscaled preview looks a little softer than the export. |
| `vignette` | -1 to 1 | Darkens (negative) or lightens (positive) the corners. |

0 is neutral for all of them, so an empty stack is the original photo. `ADJUSTMENTS` exports the
ranges (plus a step and a label) so sliders don't hard-code them.

`crop` (normalized rect, 90° rotation, straighten, flips) and `filter` (LUT id + intensity) are
already part of the format and validated; rendering them is planned. Stacks always migrate
forward, so a stack saved today keeps opening in later versions.

## How it works

```
decode + EXIF orientation ─▶ proxy texture (sized to the view) ─▶ crop ─▶ adjustments ─▶ LUT filter ─▶ screen
                         └─▶ full-resolution texture ───────────────────── same shaders ──────────────▶ file
```

- **iOS:** ImageIO decodes straight to preview size; a Metal render pipeline draws into a
  `CAMetalLayer`, driven by `CADisplayLink`.
- **Android:** `BitmapFactory` with subsampling; OpenGL ES 3 on a dedicated render thread with its
  own EGL context, drawing into a `TextureView`, driven by `Choreographer`.
- **Same result on both:** no platform filters (Core Image, ColorMatrix) and no sRGB texture
  formats. Both GPUs receive the same 8-bit sRGB values and run the same hand-written math. The
  adjustment code is one block of text pasted into both the Metal and the GLSL shader, CI fails if
  the two copies differ, and the GLSL output is checked against a float64 JavaScript reference.
- **Order:** sharpness, then exposure, white balance and vignette in linear light, then
  highlights/shadows, contrast, saturation and vibrance on the sRGB values.
- **Never blocks JS:** slider updates only store a value and mark the frame dirty; the native side
  draws at most once per display refresh.

## Benchmarks

_Numbers land here after the device runs. Release builds, auto-sweep input._

| Device | Photo | Preview | fps | GPU ms | Input → frame | 12MP export | 48MP export |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iPhone (TBD) | 48MP HEIC | auto / full | – | – | – | – | – |
| Android 2019 mid-range (TBD) | 24MP JPEG | auto / full | – | – | – | – | – |

## Cross-platform parity

Same `EditStack`, exported on iOS and Android, compared per pixel.

_Results land here after the device runs. Target: no channel more than 2/255 apart._

```sh
node scripts/compare-images.mjs ios.png android.png diff.png
```

## Roadmap

**v1:** crop/rotate/straighten with `CropOverlay`, LUT filters with
thumbnails, `usePhotoEditor` with undo/redo, HEIC export and metadata, golden-image tests in CI.

**Later:** drawing, text, stickers, custom LUT import, masks and local adjustments, RAW, web.

## Development

```sh
npm install
cd example && npm install
npx expo run:ios --device --configuration Release
npx expo run:android --device --variant release
```

Use release builds on real devices for performance numbers: debug JS skews them, and simulators
and emulators don't give meaningful GPU numbers.

The example app's test screen has a photo picker, a bundled parity chart
(`example/assets/parity-chart.png`, synthetic so JPEG decoder differences don't count), a slider
for each adjustment, an auto-sweep that calls `setAdjustment` every frame, a stats overlay, and
export + share.

| Script | What it does |
| --- | --- |
| `node scripts/check-glsl.mjs` | Checks that iOS and Android share the same adjustment code, then runs the Android GLSL in headless Chromium (WebGL2, same shader language) on a test image for every adjustment and compares each pixel with the JS reference. Needs `playwright-core`. |
| `node scripts/compare-images.mjs a.png b.png [diff.png]` | Per-pixel comparison of two exports, with a diff map. |
| `node scripts/make-parity-chart.mjs` | Regenerates the parity chart. |
| `node scripts/check-metal.mjs` | Compiles the Metal shader source offline (macOS + Xcode). |

## License

MIT © Fladio Armandika
