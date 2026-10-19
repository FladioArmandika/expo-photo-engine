import { NativeModule, requireNativeModule } from 'expo';

import type { EditStack } from './edit-stack/types';
import type { ExportOptions, ExportResult } from './types';

declare class ExpoPhotoEngineModule extends NativeModule<{}> {
  exportImageAsync(source: string, edits: EditStack, options: ExportOptions): Promise<ExportResult>;
}

export default requireNativeModule<ExpoPhotoEngineModule>('ExpoPhotoEngine');
