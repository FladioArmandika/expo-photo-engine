package expo.modules.photoengine

import android.graphics.Bitmap
import android.opengl.GLES30
import android.opengl.GLUtils
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** The compiled edit shader plus the GL objects needed to draw one image. GL-thread only. */
internal class GlPhotoProgram {
  private val program: Int
  private val uVParams: Int
  private val uParams: Int
  private val uCrop: Int
  private val uFilter: Int
  private val uImage: Int
  private val vertexArray: Int
  private val vertexBuffer: Int

  init {
    val vertex = compile(GLES30.GL_VERTEX_SHADER, Shaders.VERTEX)
    val fragment = compile(GLES30.GL_FRAGMENT_SHADER, Shaders.FRAGMENT)
    program = GLES30.glCreateProgram()
    GLES30.glAttachShader(program, vertex)
    GLES30.glAttachShader(program, fragment)
    GLES30.glLinkProgram(program)
    val status = IntArray(1)
    GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, status, 0)
    check(status[0] == GLES30.GL_TRUE) { "Shader link failed: ${GLES30.glGetProgramInfoLog(program)}" }
    GLES30.glDeleteShader(vertex)
    GLES30.glDeleteShader(fragment)

    uVParams = GLES30.glGetUniformLocation(program, "uVParams")
    uParams = GLES30.glGetUniformLocation(program, "uParams")
    uCrop = GLES30.glGetUniformLocation(program, "uCrop")
    uFilter = GLES30.glGetUniformLocation(program, "uFilter")
    uImage = GLES30.glGetUniformLocation(program, "uImage")

    // The quad's corners come from a real vertex buffer. Building them from gl_VertexID with no
    // attributes enabled draws nothing on some GLES implementations (the Android emulator's).
    val arrays = IntArray(1)
    GLES30.glGenVertexArrays(1, arrays, 0)
    vertexArray = arrays[0]
    GLES30.glBindVertexArray(vertexArray)
    val buffers = IntArray(1)
    GLES30.glGenBuffers(1, buffers, 0)
    vertexBuffer = buffers[0]
    val corners = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
    val data = ByteBuffer.allocateDirect(corners.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
    data.put(corners).position(0)
    GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vertexBuffer)
    GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, corners.size * 4, data, GLES30.GL_STATIC_DRAW)
    GLES30.glEnableVertexAttribArray(0)
    GLES30.glVertexAttribPointer(0, 2, GLES30.GL_FLOAT, false, 0, 0)
    GLES30.glBindVertexArray(0)
    GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, 0)
  }

  /**
   * Draws [texture], cropped as [params] says, aspect-fitted into the current viewport of size
   * [targetWidth]x[targetHeight].
   */
  fun draw(
    texture: Int, textureWidth: Int, textureHeight: Int,
    targetWidth: Int, targetHeight: Int,
    params: ShaderParams, flipY: Boolean, nearest: Boolean
  ) {
    val output = params.crop.outputSize(textureWidth, textureHeight)
    val imageAspect = output.first.toFloat() / output.second
    val targetAspect = targetWidth.toFloat() / maxOf(targetHeight, 1)
    var scaleX = 1f
    var scaleY = 1f
    if (imageAspect > targetAspect) scaleY = targetAspect / imageAspect else scaleX = imageAspect / targetAspect

    GLES30.glUseProgram(program)
    GLES30.glBindVertexArray(vertexArray)
    GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
    GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, texture)
    val filter = if (nearest) GLES30.GL_NEAREST else GLES30.GL_LINEAR
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, filter)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, filter)
    GLES30.glUniform1i(uImage, 0)
    GLES30.glUniform4f(uVParams, scaleX, scaleY, if (flipY) 1f else 0f, textureWidth.toFloat() / textureHeight)
    GLES30.glUniform4fv(uCrop, 2, params.crop.packed, 0)
    GLES30.glUniform4fv(uParams, 3, params.packed(outputAspect = imageAspect), 0)
    GLES30.glUniform4fv(uFilter, 8, params.filter, 0)
    GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4)
  }

  fun release() {
    GLES30.glDeleteProgram(program)
    GLES30.glDeleteVertexArrays(1, intArrayOf(vertexArray), 0)
    GLES30.glDeleteBuffers(1, intArrayOf(vertexBuffer), 0)
  }

  companion object {
    fun maxTextureSize(): Int {
      val value = IntArray(1)
      GLES30.glGetIntegerv(GLES30.GL_MAX_TEXTURE_SIZE, value, 0)
      return value[0]
    }

    /** Uploads an ARGB_8888 bitmap as an RGBA8 texture (plain unorm, no sRGB decode by the GPU). */
    fun uploadTexture(bitmap: Bitmap): Int {
      val textures = IntArray(1)
      GLES30.glGenTextures(1, textures, 0)
      GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textures[0])
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
      GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, bitmap, 0)
      val error = GLES30.glGetError()
      check(error == GLES30.GL_NO_ERROR) { "Texture upload failed (${bitmap.width}x${bitmap.height}): 0x${Integer.toHexString(error)}" }
      return textures[0]
    }

    fun deleteTexture(texture: Int) {
      GLES30.glDeleteTextures(1, intArrayOf(texture), 0)
    }

    private fun compile(type: Int, source: String): Int {
      val shader = GLES30.glCreateShader(type)
      GLES30.glShaderSource(shader, source)
      GLES30.glCompileShader(shader)
      val status = IntArray(1)
      GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, status, 0)
      if (status[0] != GLES30.GL_TRUE) {
        val log = GLES30.glGetShaderInfoLog(shader)
        GLES30.glDeleteShader(shader)
        error("Shader compile failed: $log")
      }
      return shader
    }
  }
}

/**
 * Crop, rotation, straighten and flips, as the vertex shader reads them. Mirrors `Crop` in
 * src/edit-stack/types.ts; the default is no crop.
 */
internal class CropGeometry(
  /** Normalized [x, y, width, height] in the image after rotation and flips. */
  val rect: FloatArray = floatArrayOf(0f, 0f, 1f, 1f),
  /** Clockwise quarter turns, 0..3. */
  val turns: Int = 0,
  /** Degrees, clockwise. */
  val straighten: Float = 0f,
  val flipH: Boolean = false,
  val flipV: Boolean = false,
) {
  constructor(record: CropRecord) : this(
    rect = if (record.rect.size == 4) FloatArray(4) { record.rect[it].toFloat() } else floatArrayOf(0f, 0f, 1f, 1f),
    turns = Math.floorMod(record.rotation / 90, 4),
    straighten = record.straighten.toFloat(),
    flipH = record.flipH,
    flipV = record.flipV,
  )

  /** Output size in pixels when cropping an image of [width] x [height]. */
  fun outputSize(width: Int, height: Int): Pair<Int, Int> {
    val (w, h) = if (turns % 2 == 1) height to width else width to height
    return maxOf(1, Math.round(w * rect[2])) to maxOf(1, Math.round(h * rect[3]))
  }

  /** Longest side of the crop as a fraction of the image's longest side. */
  fun longestFraction(width: Int, height: Int): Float {
    val (w, h) = if (turns % 2 == 1) height to width else width to height
    return maxOf(w * rect[2], h * rect[3]) / maxOf(w, h)
  }

  val packed: FloatArray
    get() = floatArrayOf(
      rect[0], rect[1], rect[2], rect[3],
      turns.toFloat(), Math.toRadians(straighten.toDouble()).toFloat(),
      if (flipH) 1f else 0f, if (flipV) 1f else 0f,
    )
}

/**
 * Everything the shaders read, keyed like `AdjustmentKey` in src/edit-stack/types.ts.
 * Unknown keys are ignored, missing ones are neutral (0). Immutable, so the render thread can read
 * one while the main thread builds the next.
 */
internal class ShaderParams private constructor(
  private val values: FloatArray,
  val crop: CropGeometry,
  /** applyFilter's f0..f7 (uFilter[8]), packed by src/filters/looks.ts. All zeros = no filter. */
  val filter: FloatArray,
) {
  constructor() : this(FloatArray(12), CropGeometry(), FloatArray(FILTER_COUNT))

  constructor(
    adjustments: Map<String, Double>,
    crop: CropGeometry = CropGeometry(),
    filter: List<Double> = emptyList(),
  ) : this(
    FloatArray(12).also { values ->
      for ((key, value) in adjustments) SLOTS[key]?.let { values[it] = value.toFloat() }
    },
    crop,
    if (filter.size == FILTER_COUNT) FloatArray(FILTER_COUNT) { filter[it].toFloat() } else FloatArray(FILTER_COUNT),
  )

  /** Returns a copy with [key] changed, or null for a key the shader doesn't know. */
  fun with(key: String, value: Double): ShaderParams? {
    val slot = SLOTS[key] ?: return null
    return ShaderParams(values.copyOf().also { it[slot] = value.toFloat() }, crop, filter)
  }

  /** The fragment shader's uParams[3], with the output's width / height filled in. */
  fun packed(outputAspect: Float): FloatArray = values.copyOf().also { it[OUTPUT_ASPECT_SLOT] = outputAspect }

  companion object {
    /** Slot of each key in `uParams[3]`. Mirrors applyAdjustments in Shaders.kt. */
    private val SLOTS = mapOf(
      "exposure" to 0, "contrast" to 1, "highlights" to 2, "shadows" to 3,
      "saturation" to 4, "vibrance" to 5, "warmth" to 6, "tint" to 7,
      "sharpness" to 8, "vignette" to 9,
    )
    private const val OUTPUT_ASPECT_SLOT = 10
    private const val FILTER_COUNT = 32
  }
}
