package expo.modules.photoengine

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.opengl.GLES30
import android.os.SystemClock
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/** Headless rendering: decode → same shader → offscreen framebuffer → file. No view involved. */
internal object PhotoExporter {
  fun export(
    context: Context, source: String, params: ShaderParams,
    format: String, quality: Double, maxDimension: Int
  ): Map<String, Any> {
    val start = SystemClock.elapsedRealtimeNanos()
    return withRenderer(context, source, listOf(params.crop), maxDimension) { renderer ->
      val renderStart = SystemClock.elapsedRealtimeNanos()
      val output = renderer.render(params)
      val renderMs = (SystemClock.elapsedRealtimeNanos() - renderStart) / 1e6
      val file = write(context, output, format, quality)
      mapOf(
        "uri" to Uri.fromFile(file).toString(),
        "width" to output.width,
        "height" to output.height,
        "totalMs" to (SystemClock.elapsedRealtimeNanos() - start) / 1e6,
        "renderMs" to renderMs
      ).also { output.recycle() }
    }
  }

  /** Renders several edit stacks of one photo as small JPEGs, decoding the photo only once. */
  fun thumbnails(
    context: Context, source: String, params: List<ShaderParams>, maxDimension: Int, quality: Double
  ): List<Map<String, Any>> {
    if (params.isEmpty()) return emptyList()
    return withRenderer(context, source, params.map { it.crop }, maxDimension) { renderer ->
      params.map { p ->
        val output = renderer.render(p)
        val file = write(context, output, "jpeg", quality)
        mapOf<String, Any>(
          "uri" to Uri.fromFile(file).toString(),
          "width" to output.width,
          "height" to output.height
        ).also { output.recycle() }
      }
    }
  }

  /**
   * Decodes [source] just large enough that every crop in [crops] reaches [maxDimension]
   * (0 = full size), uploads it in a short-lived GL context on the calling (background) thread,
   * and runs [block] with it.
   */
  private fun <T> withRenderer(
    context: Context, source: String, crops: List<CropGeometry>, maxDimension: Int,
    block: (OffscreenRenderer) -> T
  ): T {
    val egl = EglCore()
    val pbuffer = egl.createPbufferSurface(1, 1)
    egl.makeCurrent(pbuffer)
    var renderer: OffscreenRenderer? = null
    try {
      val info = PhotoDecoder.readInfo(context, source)
      val fullLongest = max(info.width, info.height)
      var longest = fullLongest
      if (maxDimension > 0) {
        // maxDimension limits the cropped output, so decode just large enough for the crop to reach it.
        val fraction = crops.minOf { it.longestFraction(info.width, info.height) }
        val needed = ceil(maxDimension / fraction)
        longest = min(longest, min(needed, fullLongest.toFloat()).toInt())
      }
      longest = min(longest, GlPhotoProgram.maxTextureSize())

      val bitmap = PhotoDecoder.decode(context, source, longest, info)
      renderer = OffscreenRenderer(bitmap)
      bitmap.recycle()
      return block(renderer)
    } finally {
      renderer?.release()
      egl.releaseSurface(pbuffer)
      egl.release()
    }
  }

  private fun write(context: Context, bitmap: Bitmap, format: String, quality: Double): File {
    val isJpeg = format == "jpeg"
    val directory = File(context.cacheDir, "ExpoPhotoEngine").apply { mkdirs() }
    val file = File(directory, "${UUID.randomUUID()}.${if (isJpeg) "jpg" else "png"}")
    FileOutputStream(file).use {
      bitmap.compress(
        if (isJpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG,
        (quality * 100).toInt().coerceIn(0, 100),
        it
      )
    }
    return file
  }

  /** One uploaded photo plus the shader, drawn into offscreen framebuffers. GL thread only. */
  private class OffscreenRenderer(bitmap: Bitmap) {
    private val program = GlPhotoProgram()
    private val input = GlPhotoProgram.uploadTexture(bitmap)
    private val textureWidth = bitmap.width
    private val textureHeight = bitmap.height

    fun render(params: ShaderParams): Bitmap {
      val (width, height) = params.crop.outputSize(textureWidth, textureHeight)
      val framebuffers = IntArray(1)
      val outputs = IntArray(1)
      try {
        GLES30.glGenTextures(1, outputs, 0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, outputs[0])
        GLES30.glTexStorage2D(GLES30.GL_TEXTURE_2D, 1, GLES30.GL_RGBA8, width, height)
        GLES30.glGenFramebuffers(1, framebuffers, 0)
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, framebuffers[0])
        GLES30.glFramebufferTexture2D(
          GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, outputs[0], 0
        )
        check(GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER) == GLES30.GL_FRAMEBUFFER_COMPLETE) {
          "Framebuffer incomplete for ${width}x$height"
        }

        GLES30.glViewport(0, 0, width, height)
        // flipY: glReadPixels returns the bottom row first, so render upside down to read top-down.
        // nearest: without straightening every output pixel lands on exactly one input pixel, so
        // nearest sampling copies it exactly. A straightened image falls between pixels and needs filtering.
        program.draw(
          input, textureWidth, textureHeight, width, height, params,
          flipY = true, nearest = params.crop.straighten == 0f
        )
        val pixels = ByteBuffer.allocateDirect(width * height * 4).order(ByteOrder.nativeOrder())
        GLES30.glPixelStorei(GLES30.GL_PACK_ALIGNMENT, 1)
        GLES30.glReadPixels(0, 0, width, height, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, pixels)

        val output = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        pixels.rewind()
        output.copyPixelsFromBuffer(pixels)
        return output
      } finally {
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
        if (framebuffers[0] != 0) GLES30.glDeleteFramebuffers(1, framebuffers, 0)
        if (outputs[0] != 0) GLES30.glDeleteTextures(1, outputs, 0)
      }
    }

    fun release() {
      GlPhotoProgram.deleteTexture(input)
      program.release()
    }
  }
}
