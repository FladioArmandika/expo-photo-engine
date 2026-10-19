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

/** Headless export: decode → same shader → offscreen framebuffer → file. No view involved. */
internal object PhotoExporter {
  fun export(
    context: Context, source: String, params: ShaderParams,
    format: String, quality: Double, maxDimension: Int
  ): Map<String, Any> {
    val start = SystemClock.elapsedRealtimeNanos()
    // Each export gets its own short-lived GL context on the calling (background) thread.
    val egl = EglCore()
    val pbuffer = egl.createPbufferSurface(1, 1)
    egl.makeCurrent(pbuffer)
    var program: GlPhotoProgram? = null
    var input = 0
    val framebuffers = IntArray(1)
    val outputs = IntArray(1)
    try {
      val info = PhotoDecoder.readInfo(context, source)
      val fullLongest = max(info.width, info.height)
      var longest = fullLongest
      if (maxDimension > 0) {
        // maxDimension limits the cropped output, so decode just large enough for the crop to reach it.
        val needed = ceil(maxDimension / params.crop.longestFraction(info.width, info.height))
        longest = min(longest, min(needed, fullLongest.toFloat()).toInt())
      }
      longest = min(longest, GlPhotoProgram.maxTextureSize())

      val bitmap = PhotoDecoder.decode(context, source, longest, info)
      val textureWidth = bitmap.width
      val textureHeight = bitmap.height
      val (width, height) = params.crop.outputSize(textureWidth, textureHeight)
      program = GlPhotoProgram()
      input = GlPhotoProgram.uploadTexture(bitmap)
      bitmap.recycle()

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

      val renderStart = SystemClock.elapsedRealtimeNanos()
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
      val renderMs = (SystemClock.elapsedRealtimeNanos() - renderStart) / 1e6

      val output = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      pixels.rewind()
      output.copyPixelsFromBuffer(pixels)

      val isJpeg = format == "jpeg"
      val directory = File(context.cacheDir, "ExpoPhotoEngine").apply { mkdirs() }
      val file = File(directory, "${UUID.randomUUID()}.${if (isJpeg) "jpg" else "png"}")
      FileOutputStream(file).use {
        output.compress(
          if (isJpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG,
          (quality * 100).toInt().coerceIn(0, 100),
          it
        )
      }
      output.recycle()

      return mapOf(
        "uri" to Uri.fromFile(file).toString(),
        "width" to width,
        "height" to height,
        "totalMs" to (SystemClock.elapsedRealtimeNanos() - start) / 1e6,
        "renderMs" to renderMs
      )
    } finally {
      if (framebuffers[0] != 0) GLES30.glDeleteFramebuffers(1, framebuffers, 0)
      if (outputs[0] != 0) GLES30.glDeleteTextures(1, outputs, 0)
      if (input != 0) GlPhotoProgram.deleteTexture(input)
      program?.release()
      egl.releaseSurface(pbuffer)
      egl.release()
    }
  }
}
