# Changelog

## 0.1.0

First public release. iOS and Android render the same pixels: every CI run exports the same
edits on the iOS simulator and the Android emulator and fails if any channel is more than 2/255
apart.

- `PhotoCanvas`: a native view that draws with Metal on iOS and OpenGL ES 3 on Android. Slider
  updates go straight to the native side and are drawn at most once per display refresh.
- Adjustments: exposure, contrast, highlights, shadows, saturation, vibrance, warmth, tint,
  sharpness and vignette.
- HSL: hue, saturation and luminance for eight color ranges.
- Tone curves for RGB, red, green and blue, and an optional `ToneCurveEditor`.
- Filters with intensity: 11 built in, your own as plain data, and filter thumbnails rendered on
  the photo being edited.
- Crop, quarter-turn rotation, straighten and flip, and an optional `CropOverlay` with drag
  handles and aspect lock.
- Export to PNG, JPEG or HEIC at full resolution with the same shaders as the preview, keeping
  the original's metadata (GPS optional).
- Edit stacks: versioned JSON with validation and migration, so saved edits can be reopened later.
- `usePhotoEditor`: undo and redo, an unsaved-changes flag, ready-made slider props, and
  hold-to-compare with the original.

Requires Expo SDK 58+, React Native 0.88+ and the New Architecture.
