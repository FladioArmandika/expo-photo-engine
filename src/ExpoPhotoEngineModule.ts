import { NativeModule, requireNativeModule } from 'expo';

import type { NativeEditStack } from './filters/registry';
import type { ExportOptions, ExportResult, Thumbnail } from './types';

declare class ExpoPhotoEngineModule extends NativeModule<{}> {
  exportImageAsync(
    source: string,
    edits: NativeEditStack,
    options: ExportOptions
  ): Promise<ExportResult>;
  renderThumbnailsAsync(
    source: string,
    edits: NativeEditStack[],
    options: { maxDimension: number; quality: number }
  ): Promise<Thumbnail[]>;
}

export default requireNativeModule<ExpoPhotoEngineModule>('ExpoPhotoEngine');
