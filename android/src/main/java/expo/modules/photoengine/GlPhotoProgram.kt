package expo.modules.photoengine

import android.graphics.Bitmap
import android.opengl.GLES30
import android.opengl.GLUtils

/** The compiled edit shader plus the GL objects needed to draw one image. GL-thread only. */
internal class GlPhotoProgram {
  private val program: Int
  private val uVParams: Int
  private val uParams: Int
  private val uImage: Int
  private val vertexArray: Int

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
    uImage = GLES30.glGetUniformLocation(program, "uImage")

    // The quad comes from gl_VertexID, but some drivers still refuse to draw without a VAO bound.
    val arrays = IntArray(1)
    GLES30.glGenVertexArrays(1, arrays, 0)
    vertexArray = arrays[0]
  }

  /** Draws [texture] aspect-fitted into the current viewport of size [targetWidth]x[targetHeight]. */
  fun draw(
    texture: Int, textureWidth: Int, textureHeight: Int,
    targetWidth: Int, targetHeight: Int,
    params: ShaderParams, flipY: Boolean, nearest: Boolean
  ) {
    val imageAspect = textureWidth.toFloat() / textureHeight
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
    GLES30.glUniform4f(uVParams, scaleX, scaleY, if (flipY) 1f else 0f, 0f)
    GLES30.glUniform4f(uParams, params.exposure, 0f, 0f, 0f)
    GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4)
  }

  fun release() {
    GLES30.glDeleteProgram(program)
    GLES30.glDeleteVertexArrays(1, intArrayOf(vertexArray), 0)
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

/** Parameters the fragment shader reads. Mirrors `uParams` in Shaders.kt. */
internal data class ShaderParams(val exposure: Float = 0f)
