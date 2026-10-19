export type PreviewQuality = 'auto' | 'fast' | 'full';

export type RenderStats = {
  /** Frames rendered per second over the last sampling window (only frames that had new input). */
  fps: number;
  /** Average CPU time spent encoding + submitting one frame, in ms. */
  frameTimeMs: number;
  /** Average GPU time per frame in ms (iOS only; -1 when the platform cannot report it). */
  gpuTimeMs: number;
  /** Average time from the native side receiving an input to that frame being presented (iOS) or submitted (Android), in ms. */
  latencyMs: number;
  /** Size of the texture the preview renders from. */
  previewWidth: number;
  previewHeight: number;
  /** Full size of the source image (after EXIF orientation). */
  sourceWidth: number;
  sourceHeight: number;
  /** True while between beginInteraction() and endInteraction(). */
  interacting: boolean;
};

export type LoadEvent = {
  sourceWidth: number;
  sourceHeight: number;
  previewWidth: number;
  previewHeight: number;
  /** Time spent decoding + uploading the preview texture, in ms. */
  decodeMs: number;
};

export type ErrorEvent = { message: string };

export type ExportFormat = 'png' | 'jpeg';

export type ExportOptions = {
  format?: ExportFormat;
  /** 0..1, JPEG only. Default 0.92. */
  quality?: number;
  /** Longest side of the output in px. 0 or undefined = full resolution (clamped to the GPU's max texture size). */
  maxDimension?: number;
};

export type ExportResult = {
  uri: string;
  width: number;
  height: number;
  /** Decode + render + encode time, in ms. */
  totalMs: number;
  renderMs: number;
};
