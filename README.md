# @fladioarmandika/expo-photo-engine

**A native photo-editing engine for Expo. Your UI, our GPU.**

> Status: pre-alpha spike. Only `exposure` is implemented, to validate the architecture
> (Metal on iOS, OpenGL ES 3 on Android, one shared shader math, imperative updates without
> React renders). Not usable in apps yet.

## Spike: what to run

Requirements: macOS with Xcode for iOS, Android Studio / SDK for Android, a real iPhone and a real
Android phone (simulators don't give meaningful GPU numbers).

```sh
npm install
cd example
npm install
npx expo run:ios --device --configuration Release      # iPhone
npx expo run:android --device --variant release        # Android phone
```

Release builds matter: debug JS is much slower and skews the fps numbers.

### 1. fps while dragging on a 24MP+ photo

1. Put a 24MP+ photo on each phone (an iPhone 48MP shot or a recent Android main-camera photo).
2. **Pick photo**, then drag the Exposure slider for a few seconds. The overlay shows fps, CPU
   frame time, GPU time (iOS), input-to-frame latency, the preview size and the source size.
3. Tap **Auto-sweep** for a hands-free run: JS calls `setAdjustment` on every animation frame.
4. Tap **Preview: auto** to switch to **full**: the shader then samples the full-resolution
   texture (clamped to the GPU's max texture size), the worst case for the GPU.

Write down: device, OS, source size, preview size, fps / frame ms / latency for slider and
sweep, in both `auto` and `full`.

### 2. iOS vs Android output parity

1. On both phones tap **Parity chart** (a synthetic 2048x1536 PNG bundled with the example, so
   JPEG decoder differences don't count), set a non-zero exposure, e.g. drag to about +1.0 and
   note the value shown after export, or use the same EV on both.
2. **Export PNG** then **Share** the file to your computer.
3. Compare:

```sh
node scripts/compare-images.mjs ios.png android.png diff.png
```

It prints mean / max channel difference and the share of pixels off by more than 1, 2 and 4
levels, and writes a diff map. Target: max difference <= 2/255.

### Shader check without a phone

`node scripts/check-glsl.mjs` runs the Android GLSL in headless Chromium (WebGL2 = GLSL ES 3.00)
over every 8-bit value at 12 exposure settings and compares with a float64 JavaScript reference.

## License

MIT
