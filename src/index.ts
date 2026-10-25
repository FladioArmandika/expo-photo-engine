import ExpoPhotoEngineModule from './ExpoPhotoEngineModule';
import { withFilter } from './edit-stack/operations';
import type { EditStack } from './edit-stack/types';
import { listFilters, toNativeEdits } from './filters/registry';
import type { ExportOptions, ExportResult, Thumbnail, ThumbnailOptions } from './types';

export { PhotoCanvas } from './PhotoCanvas';
export type { PhotoCanvasProps, PhotoCanvasRef } from './PhotoCanvas';
export * from './types';
export * from './edit-stack';
export * from './editor';
export * from './crop';
export * from './curves';
export * from './filters';

/**
 * Renders `edits` onto `source` with the same shaders as the preview and writes a file.
 * Does not need a mounted PhotoCanvas.
 */
export function exportImage(
  source: string,
  edits: EditStack,
  options: ExportOptions = {}
): Promise<ExportResult> {
  return ExpoPhotoEngineModule.exportImageAsync(source, toNativeEdits(edits), {
    format: options.format ?? 'png',
    quality: options.quality ?? 0.92,
    maxDimension: options.maxDimension ?? 0,
    metadata: options.metadata ?? 'all',
  });
}

/**
 * Renders small JPEG previews of `source`, one per edit stack, decoding the photo only once.
 * Results are in the same order as `edits`.
 */
export function renderThumbnails(
  source: string,
  edits: EditStack[],
  options: ThumbnailOptions = {}
): Promise<Thumbnail[]> {
  return ExpoPhotoEngineModule.renderThumbnailsAsync(source, edits.map(toNativeEdits), {
    maxDimension: options.maxDimension ?? 200,
    quality: options.quality ?? 0.8,
  });
}

export type FilterThumbnail = Thumbnail & {
  /** null for the "Original" entry (the edits without a filter). */
  id: string | null;
  label: string;
};

/**
 * Thumbnails for a filter picker: the current `edits` with each filter applied at full
 * intensity, preceded by an "Original" entry without a filter. Re-run it after the crop or the
 * adjustments change, so the thumbnails match the photo being edited.
 */
export async function renderFilterThumbnails(
  source: string,
  edits: EditStack,
  options: ThumbnailOptions & { filterIds?: string[] } = {}
): Promise<FilterThumbnail[]> {
  const filters = listFilters().filter((f) => !options.filterIds || options.filterIds.includes(f.id));
  const entries = [
    { id: null, label: 'Original' },
    ...filters.map((f) => ({ id: f.id, label: f.label })),
  ];
  const thumbnails = await renderThumbnails(
    source,
    entries.map((e) => withFilter(edits, e.id === null ? null : { id: e.id, intensity: 1 })),
    options
  );
  return entries.map((entry, i) => ({ ...entry, ...thumbnails[i]! }));
}
