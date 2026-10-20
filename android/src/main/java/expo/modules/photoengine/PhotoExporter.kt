package expo.modules.photoengine

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.opengl.GLES30
import android.os.Build
import android.os.SystemClock
import androidx.exifinterface.media.ExifInterface
import androidx.heifwriter.HeifWriter
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
  /** [metadata] is "all", "no-location" (drops GPS) or "none". */
  fun export(
    context: Context, source: String, params: ShaderParams,
    format: String, quality: Double, maxDimension: Int, metadata: String
  ): Map<String, Any> {
    val start = SystemClock.elapsedRealtimeNanos()
    if (format == "heic" && Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
      throw IllegalStateException("HEIC export needs Android 9 or newer")
    }
    return withRenderer(context, source, listOf(params.crop), maxDimension) { renderer ->
      val renderStart = SystemClock.elapsedRealtimeNanos()
      val output = renderer.render(params)
      val renderMs = (SystemClock.elapsedRealtimeNanos() - renderStart) / 1e6
      val file = write(context, output, format, quality)
      val metadataKept = metadata != "none" && format != "heic" &&
        copyMetadata(context, source, file, metadata != "no-location", output.width, output.height)
      mapOf(
        "uri" to Uri.fromFile(file).toString(),
        "width" to output.width,
        "height" to output.height,
        "metadata" to metadataKept,
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
    val extension = when (format) {
      "jpeg" -> "jpg"
      "heic" -> "heic"
      else -> "png"
    }
    val directory = File(context.cacheDir, "ExpoPhotoEngine").apply { mkdirs() }
    val file = File(directory, "${UUID.randomUUID()}.$extension")
    val percent = (quality * 100).toInt().coerceIn(0, 100)
    if (format == "heic") {
      writeHeic(bitmap, file, percent)
      return file
    }
    FileOutputStream(file).use {
      bitmap.compress(
        if (format == "jpeg") Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG,
        percent,
        it
      )
    }
    return file
  }

  /** Android has no HEIC option in Bitmap.compress; HeifWriter encodes with the device's HEVC encoder. */
  private fun writeHeic(bitmap: Bitmap, file: File, quality: Int) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
      throw IllegalStateException("HEIC export needs Android 9 or newer")
    }
    val writer = HeifWriter.Builder(file.absolutePath, bitmap.width, bitmap.height, HeifWriter.INPUT_MODE_BITMAP)
      .setQuality(quality)
      .setMaxImages(1)
      .build()
    try {
      writer.start()
      writer.addBitmap(bitmap)
      writer.stop(30_000)
    } finally {
      writer.close()
    }
  }

  /**
   * Copies the source photo's EXIF (camera, lens, exposure, date, copyright and, if
   * [keepLocation], GPS) into [file]. Orientation becomes "normal" because the pixels are already
   * upright, and the pixel size is the edited one. Returns false when the source has none or the
   * file can't take it.
   */
  private fun copyMetadata(
    context: Context, source: String, file: File, keepLocation: Boolean, width: Int, height: Int
  ): Boolean {
    return try {
      val from = PhotoDecoder.open(context, source).use { ExifInterface(it) }
      val tags = if (keepLocation) COPIED_TAGS + GPS_TAGS else COPIED_TAGS
      val values = tags.mapNotNull { tag -> from.getAttribute(tag)?.let { tag to it } }
      if (values.isEmpty()) return false
      val to = ExifInterface(file.absolutePath)
      for ((tag, value) in values) to.setAttribute(tag, value)
      to.setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
      to.setAttribute(ExifInterface.TAG_PIXEL_X_DIMENSION, width.toString())
      to.setAttribute(ExifInterface.TAG_PIXEL_Y_DIMENSION, height.toString())
      to.saveAttributes()
      true
    } catch (e: Exception) {
      false
    }
  }

  private val COPIED_TAGS = listOf(
    ExifInterface.TAG_MAKE, ExifInterface.TAG_MODEL, ExifInterface.TAG_SOFTWARE,
    ExifInterface.TAG_ARTIST, ExifInterface.TAG_COPYRIGHT, ExifInterface.TAG_IMAGE_DESCRIPTION,
    ExifInterface.TAG_DATETIME, ExifInterface.TAG_DATETIME_ORIGINAL, ExifInterface.TAG_DATETIME_DIGITIZED,
    ExifInterface.TAG_OFFSET_TIME, ExifInterface.TAG_OFFSET_TIME_ORIGINAL, ExifInterface.TAG_OFFSET_TIME_DIGITIZED,
    ExifInterface.TAG_SUBSEC_TIME, ExifInterface.TAG_SUBSEC_TIME_ORIGINAL, ExifInterface.TAG_SUBSEC_TIME_DIGITIZED,
    ExifInterface.TAG_EXPOSURE_TIME, ExifInterface.TAG_F_NUMBER, ExifInterface.TAG_APERTURE_VALUE,
    ExifInterface.TAG_SHUTTER_SPEED_VALUE, ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY,
    ExifInterface.TAG_EXPOSURE_PROGRAM, ExifInterface.TAG_EXPOSURE_MODE, ExifInterface.TAG_EXPOSURE_BIAS_VALUE,
    ExifInterface.TAG_METERING_MODE, ExifInterface.TAG_FLASH, ExifInterface.TAG_WHITE_BALANCE,
    ExifInterface.TAG_FOCAL_LENGTH, ExifInterface.TAG_FOCAL_LENGTH_IN_35MM_FILM,
    ExifInterface.TAG_LENS_MAKE, ExifInterface.TAG_LENS_MODEL, ExifInterface.TAG_LENS_SPECIFICATION,
    ExifInterface.TAG_SCENE_CAPTURE_TYPE, ExifInterface.TAG_BRIGHTNESS_VALUE,
  )

  private val GPS_TAGS = listOf(
    ExifInterface.TAG_GPS_LATITUDE, ExifInterface.TAG_GPS_LATITUDE_REF,
    ExifInterface.TAG_GPS_LONGITUDE, ExifInterface.TAG_GPS_LONGITUDE_REF,
    ExifInterface.TAG_GPS_ALTITUDE, ExifInterface.TAG_GPS_ALTITUDE_REF,
    ExifInterface.TAG_GPS_TIMESTAMP, ExifInterface.TAG_GPS_DATESTAMP,
    ExifInterface.TAG_GPS_IMG_DIRECTION, ExifInterface.TAG_GPS_IMG_DIRECTION_REF,
    ExifInterface.TAG_GPS_SPEED, ExifInterface.TAG_GPS_SPEED_REF,
  )

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
