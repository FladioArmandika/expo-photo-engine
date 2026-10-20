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

/** `heic` needs iOS 11+ on a device with a HEVC encoder, or Android 9+. */
export type ExportFormat = 'png' | 'jpeg' | 'heic';

/**
 * Which of the original photo's metadata goes into the export: `all` (camera, lens, exposure,
 * date, copyright and GPS location), `no-location` (the same without GPS) or `none`.
 */
export type ExportMetadata = 'all' | 'no-location' | 'none';

export type ExportOptions = {
  format?: ExportFormat;
  /** 0..1, JPEG and HEIC. Default 0.92. */
  quality?: number;
  /** Longest side of the output in px. 0 or undefined = full resolution (clamped to the GPU's max texture size). */
  maxDimension?: number;
  /** Default `all`. Orientation is always reset to "up", since the pixels are already upright. */
  metadata?: ExportMetadata;
};

export type ExportResult = {
  uri: string;
  width: number;
  height: number;
  /**
   * True when metadata from the original was written. False when `metadata` was `none`, the
   * original had none, or writing it failed.
   */
  metadata: boolean;
  /** Decode + render + encode time, in ms. */
  totalMs: number;
  renderMs: number;
};

export type Thumbnail = {
  /** file:// URI of a JPEG in the app's cache directory. */
  uri: string;
  width: number;
  height: number;
};

export type ThumbnailOptions = {
  /** Longest side of each thumbnail in px. Default 200. */
  maxDimension?: number;
  /** JPEG quality, 0..1. Default 0.8. */
  quality?: number;
};
