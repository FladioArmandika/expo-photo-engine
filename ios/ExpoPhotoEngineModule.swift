import ExpoModulesCore

struct EditStackRecord: Record {
  @Field var version: Int = 1
  @Field var adjustments: [String: Double] = [:]
}

struct ExportOptionsRecord: Record {
  @Field var format: String = "png"
  @Field var quality: Double = 0.92
  @Field var maxDimension: Int = 0
}

public class ExpoPhotoEngineModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoPhotoEngine")

    // Runs on the module's background queue, never on the JS or main thread.
    AsyncFunction("exportImageAsync") { (source: String, edits: EditStackRecord, options: ExportOptionsRecord) -> [String: Any] in
      guard let renderer = PhotoRenderer.shared else {
        throw PhotoEngineError.noMetalDevice
      }
      let params = ShaderParams(adjustments: edits.adjustments)
      return try renderer.export(
        source: source, params: params, format: options.format, quality: options.quality,
        maxDimension: options.maxDimension)
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
