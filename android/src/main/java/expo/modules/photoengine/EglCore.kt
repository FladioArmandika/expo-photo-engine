package expo.modules.photoengine

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface

/**
 * Minimal EGL wrapper. EGL is the glue between OpenGL ES and the OS: it owns the GL
 * context (all GL state) and the surfaces GL draws into. A context is bound to one
 * thread at a time, so every call on an EglCore must come from the thread that made it.
 */
internal class EglCore {
  private val display: EGLDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
  private val config: EGLConfig
  private val context: EGLContext

  init {
    check(display != EGL14.EGL_NO_DISPLAY) { "No EGL display" }
    val version = IntArray(2)
    check(EGL14.eglInitialize(display, version, 0, version, 1)) { "eglInitialize failed" }

    val attribs = intArrayOf(
      EGL14.EGL_RED_SIZE, 8,
      EGL14.EGL_GREEN_SIZE, 8,
      EGL14.EGL_BLUE_SIZE, 8,
      EGL14.EGL_ALPHA_SIZE, 8,
      EGL14.EGL_RENDERABLE_TYPE, EGLExt.EGL_OPENGL_ES3_BIT_KHR,
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT,
      EGL14.EGL_NONE
    )
    val configs = arrayOfNulls<EGLConfig>(1)
    val count = IntArray(1)
    check(EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, count, 0) && count[0] > 0) {
      "No RGBA8888 OpenGL ES 3 config"
    }
    config = configs[0]!!

    context = EGL14.eglCreateContext(
      display, config, EGL14.EGL_NO_CONTEXT,
      intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0
    )
    check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext failed: 0x${Integer.toHexString(EGL14.eglGetError())}" }
  }

  /** [surface] is a SurfaceTexture or Surface. */
  fun createWindowSurface(surface: Any): EGLSurface {
    val result = EGL14.eglCreateWindowSurface(display, config, surface, intArrayOf(EGL14.EGL_NONE), 0)
    check(result != EGL14.EGL_NO_SURFACE) { "eglCreateWindowSurface failed: 0x${Integer.toHexString(EGL14.eglGetError())}" }
    return result
  }

  /** An offscreen surface, used to keep the context current when nothing is on screen. */
  fun createPbufferSurface(width: Int, height: Int): EGLSurface {
    val attribs = intArrayOf(EGL14.EGL_WIDTH, width, EGL14.EGL_HEIGHT, height, EGL14.EGL_NONE)
    val result = EGL14.eglCreatePbufferSurface(display, config, attribs, 0)
    check(result != EGL14.EGL_NO_SURFACE) { "eglCreatePbufferSurface failed" }
    return result
  }

  fun makeCurrent(surface: EGLSurface) {
    check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "eglMakeCurrent failed" }
  }

  /** Hands the finished frame to the compositor. Blocks if the GPU is too far behind (vsync). */
  fun swapBuffers(surface: EGLSurface): Boolean = EGL14.eglSwapBuffers(display, surface)

  fun releaseSurface(surface: EGLSurface) {
    EGL14.eglDestroySurface(display, surface)
  }

  fun release() {
    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
    EGL14.eglDestroyContext(display, context)
    EGL14.eglReleaseThread()
    // No eglTerminate: the default display is shared with every other GL user in the process.
  }
}
