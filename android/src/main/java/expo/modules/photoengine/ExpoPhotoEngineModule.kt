package expo.modules.photoengine

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class CropRecord : Record {
  @Field val rect: List<Double> = listOf(0.0, 0.0, 1.0, 1.0)
  @Field val rotation: Int = 0
  @Field val straighten: Double = 0.0
  @Field val flipH: Boolean = false
  @Field val flipV: Boolean = false
}

/** `uniforms` is filled in by toNativeEdits in src/filters/registry.ts; the id is only for JS. */
class FilterRecord : Record {
  @Field val id: String = ""
  @Field val intensity: Double = 0.0
  @Field val uniforms: List<Double> = emptyList()
}

class EditStackRecord : Record {
  @Field val version: Int = 1
  @Field val crop: CropRecord? = null
  @Field val adjustments: Map<String, Double> = emptyMap()
  @Field val filter: FilterRecord? = null
}

class ThumbnailOptionsRecord : Record {
  @Field val maxDimension: Int = 200
  @Field val quality: Double = 0.8
}

class ExportOptionsRecord : Record {
  @Field val format: String = "png"
  @Field val quality: Double = 0.92
  @Field val maxDimension: Int = 0
  @Field val metadata: String = "all"
}

internal fun EditStackRecord.toShaderParams() =
  ShaderParams(adjustments, crop?.let(::CropGeometry) ?: CropGeometry(), filter?.uniforms ?: emptyList())

class ExpoPhotoEngineModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoPhotoEngine")

    // Runs on Expo's background queue, never on the JS or main thread.
    AsyncFunction("exportImageAsync") { source: String, edits: EditStackRecord, options: ExportOptionsRecord ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      PhotoExporter.export(
        context, source, edits.toShaderParams(),
        options.format, options.quality, options.maxDimension, options.metadata
      )
    }

    AsyncFunction("renderThumbnailsAsync") { source: String, edits: List<EditStackRecord>, options: ThumbnailOptionsRecord ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      PhotoExporter.thumbnails(
        context, source, edits.map { it.toShaderParams() }, options.maxDimension, options.quality
      )
    }

    View(PhotoCanvasView::class) {
      Events("onLoad", "onError", "onRenderStats")

      Prop("source") { view: PhotoCanvasView, source: String? ->
        view.setSource(source)
      }

      Prop("previewQuality") { view: PhotoCanvasView, quality: String? ->
        view.setPreviewQuality(quality)
      }

      Prop("edits") { view: PhotoCanvasView, edits: EditStackRecord? ->
        if (edits != null) view.setEdits(edits)
      }

      // Ref methods.
      AsyncFunction("setAdjustment") { view: PhotoCanvasView, key: String, value: Double ->
        view.setAdjustment(key, value)
      }

      AsyncFunction("setEdits") { view: PhotoCanvasView, edits: EditStackRecord ->
        view.setEdits(edits)
      }

      AsyncFunction("beginInteraction") { view: PhotoCanvasView ->
        view.beginInteraction()
      }

      AsyncFunction("endInteraction") { view: PhotoCanvasView ->
        view.endInteraction()
      }

      OnViewDestroys { view: PhotoCanvasView ->
        view.release()
      }
    }
  }
}
