import { NativeModule, requireNativeModule } from 'expo';

import type { EditStack, ExportOptions, ExportResult } from './types';

declare class ExpoPhotoEngineModule extends NativeModule<{}> {
  exportImageAsync(source: string, edits: EditStack, options: ExportOptions): Promise<ExportResult>;
}

export default requireNativeModule<ExpoPhotoEngineModule>('ExpoPhotoEngine');
