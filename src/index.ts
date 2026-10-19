import ExpoPhotoEngineModule from './ExpoPhotoEngineModule';
import type { EditStack } from './edit-stack/types';
import type { ExportOptions, ExportResult } from './types';

export { PhotoCanvas } from './PhotoCanvas';
export type { PhotoCanvasProps, PhotoCanvasRef } from './PhotoCanvas';
export * from './types';
export * from './edit-stack';
export * from './editor';

/**
 * Renders `edits` onto `source` with the same shaders as the preview and writes a file.
 * Does not need a mounted PhotoCanvas.
 */
export function exportImage(
  source: string,
  edits: EditStack,
  options: ExportOptions = {}
): Promise<ExportResult> {
  return ExpoPhotoEngineModule.exportImageAsync(source, edits, {
    format: options.format ?? 'png',
    quality: options.quality ?? 0.92,
    maxDimension: options.maxDimension ?? 0,
  });
}
