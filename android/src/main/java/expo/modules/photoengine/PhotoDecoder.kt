package expo.modules.photoengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ColorSpace
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import kotlin.math.max
import kotlin.math.min

internal object PhotoDecoder {
  class Info(val width: Int, val height: Int, val rawWidth: Int, val rawHeight: Int, val orientation: Int)

  fun open(context: Context, source: String): InputStream {
    return when {
      source.startsWith("content://") -> context.contentResolver.openInputStream(Uri.parse(source))
        ?: throw IllegalArgumentException("Cannot open $source")
      source.startsWith("file://") -> FileInputStream(File(Uri.parse(source).path!!))
      source.startsWith("/") -> FileInputStream(File(source))
      else -> throw IllegalArgumentException("Invalid image source: $source")
    }
  }

  /** Reads the header only. Width and height are after EXIF orientation. */
  fun readInfo(context: Context, source: String): Info {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open(context, source).use { BitmapFactory.decodeStream(it, null, bounds) }
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Could not decode image: $source" }
    val orientation = try {
      open(context, source).use {
        ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      }
    } catch (e: Exception) {
      ExifInterface.ORIENTATION_NORMAL
    }
    val swaps = orientation == ExifInterface.ORIENTATION_ROTATE_90 ||
      orientation == ExifInterface.ORIENTATION_ROTATE_270 ||
      orientation == ExifInterface.ORIENTATION_TRANSPOSE ||
      orientation == ExifInterface.ORIENTATION_TRANSVERSE
    return Info(
      width = if (swaps) bounds.outHeight else bounds.outWidth,
      height = if (swaps) bounds.outWidth else bounds.outHeight,
      rawWidth = bounds.outWidth,
      rawHeight = bounds.outHeight,
      orientation = orientation
    )
  }

  /**
   * Decodes with EXIF orientation applied and the longest side at most [maxPixelSize].
   * inSampleSize lets the JPEG decoder skip detail while decoding, so a 48MP file is never
   * fully decoded just to build a screen-sized preview.
   */
  fun decode(context: Context, source: String, maxPixelSize: Int, info: Info = readInfo(context, source)): Bitmap {
    val rawLongest = max(info.rawWidth, info.rawHeight)
    var sample = 1
    while (rawLongest / (sample * 2) >= maxPixelSize) sample *= 2

    val options = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
      // Convert Display P3 / Adobe RGB sources into sRGB, the same working space as iOS.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        inPreferredColorSpace = ColorSpace.get(ColorSpace.Named.SRGB)
      }
    }
    val decoded = open(context, source).use { BitmapFactory.decodeStream(it, null, options) }
      ?: throw IllegalArgumentException("Could not decode image: $source")

    val scale = min(1f, maxPixelSize.toFloat() / max(decoded.width, decoded.height))
    val matrix = Matrix()
    if (scale < 1f) matrix.postScale(scale, scale)
    when (info.orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(-90f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(-90f)
    }
    if (matrix.isIdentity) return decoded
    val result = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    if (result !== decoded) decoded.recycle()
    return result
  }
}
