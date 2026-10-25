import ExpoModulesCore

struct CropRecord: Record {
  @Field var rect: [Double] = [0, 0, 1, 1]
  @Field var rotation: Int = 0
  @Field var straighten: Double = 0
  @Field var flipH: Bool = false
  @Field var flipV: Bool = false
}

/// `uniforms` is filled in by toNativeEdits in src/filters/registry.ts; the id is only for JS.
struct FilterRecord: Record {
  @Field var id: String = ""
  @Field var intensity: Double = 0
  @Field var uniforms: [Double] = []
}

struct EditStackRecord: Record {
  @Field var version: Int = 1
  @Field var crop: CropRecord? = nil
  @Field var adjustments: [String: Double] = [:]
  @Field var filter: FilterRecord? = nil
  /// Packed by packHsl in src/edit-stack/hsl.ts. Empty or all zeros = no HSL change.
  @Field var hsl: [Double] = []
}

struct ThumbnailOptionsRecord: Record {
  @Field var maxDimension: Int = 200
  @Field var quality: Double = 0.8
}

struct ExportOptionsRecord: Record {
  @Field var format: String = "png"
  @Field var quality: Double = 0.92
  @Field var maxDimension: Int = 0
  @Field var metadata: String = "all"
}

public class ExpoPhotoEngineModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoPhotoEngine")

    // Runs on the module's background queue, never on the JS or main thread.
    AsyncFunction("exportImageAsync") { (source: String, edits: EditStackRecord, options: ExportOptionsRecord) -> [String: Any] in
      guard let renderer = PhotoRenderer.shared else {
        throw PhotoEngineError.noMetalDevice
      }
      let params = ShaderParams(edits)
      return try renderer.export(
        source: source, params: params, format: options.format, quality: options.quality,
        maxDimension: options.maxDimension, metadata: options.metadata)
    }

    AsyncFunction("renderThumbnailsAsync") { (source: String, edits: [EditStackRecord], options: ThumbnailOptionsRecord) -> [[String: Any]] in
      guard let renderer = PhotoRenderer.shared else {
        throw PhotoEngineError.noMetalDevice
      }
      return try renderer.thumbnails(
        source: source, params: edits.map { ShaderParams($0) }, maxDimension: options.maxDimension,
        quality: options.quality)
    }

    View(PhotoCanvasView.self) {
      Events("onLoad", "onError", "onRenderStats")

      Prop("source") { (view: PhotoCanvasView, source: String?) in
        view.setSource(source)
      }

      Prop("previewQuality") { (view: PhotoCanvasView, quality: String?) in
        view.setPreviewQuality(quality)
      }

      Prop("edits") { (view: PhotoCanvasView, edits: EditStackRecord?) in
        if let edits {
          view.setEdits(edits)
        }
      }

      // Ref methods. Expo runs view functions on the main thread.
      AsyncFunction("setAdjustment") { (view: PhotoCanvasView, key: String, value: Double) in
        view.setAdjustment(key, value)
      }

      AsyncFunction("setEdits") { (view: PhotoCanvasView, edits: EditStackRecord) in
        view.setEdits(edits)
      }

      AsyncFunction("beginInteraction") { (view: PhotoCanvasView) in
        view.beginInteraction()
      }

      AsyncFunction("endInteraction") { (view: PhotoCanvasView) in
        view.endInteraction()
      }
    }
  }
}
