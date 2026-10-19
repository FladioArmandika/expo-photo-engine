package expo.modules.photoengine

import android.content.Context
import android.graphics.SurfaceTexture
import android.opengl.EGLSurface
import android.opengl.GLES30
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Choreographer
import android.view.TextureView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max
import kotlin.math.min

/**
 * Threads:
 * - main: props, ref methods, layout, events.
 * - render thread (one per view): owns the EGL context and every GL call. Draws at most once
 *   per vsync via its own Choreographer, so many slider updates in one frame cost one draw.
 * - decode pool: JPEG/HEIC decoding, which takes far longer than a frame for 24MP+ files.
 */
class PhotoCanvasView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), TextureView.SurfaceTextureListener {

  private val onLoad by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any>>()
  private val onRenderStats by EventDispatcher<Map<String, Any>>()

  private val textureView = TextureView(context)
  private val renderThread = HandlerThread("ExpoPhotoEngine-render").apply { start() }
  private val renderHandler = Handler(renderThread.looper)

  // Main-thread state.
  private var source: String? = null
  private var previewQuality = "auto"
  private var loadedKey: String? = null
  private var surfaceLongest = 0

  // Written on one thread, read on another.
  private val loadGeneration = AtomicInteger(0)
  @Volatile private var params = ShaderParams()
  @Volatile private var interacting = false
  @Volatile private var maxTextureSize = 0
  private val pendingInputNanos = AtomicLong(0)
  private val frameRequested = AtomicBoolean(false)

  // Render-thread state.
  private var egl: EglCore? = null
  private var idleSurface: EGLSurface? = null
  private var windowSurface: EGLSurface? = null
  private var program: GlPhotoProgram? = null
  private lateinit var choreographer: Choreographer
  private var imageTexture = 0
  private var imageWidth = 0
  private var imageHeight = 0
  private var sourceWidth = 0
  private var sourceHeight = 0
  private var surfaceWidth = 0
  private var surfaceHeight = 0
  private val stats = RenderStatsAccumulator()

  private val frameCallback = Choreographer.FrameCallback { renderFrame() }
  private val flushStats = Runnable { emitStats(force = true) }

  init {
    textureView.isOpaque = false
    textureView.surfaceTextureListener = this
    addView(textureView)

    renderHandler.post {
      try {
        val core = EglCore()
        // A 1x1 offscreen surface keeps the context usable before the on-screen one exists,
        // so the image can be uploaded while the view is still being laid out.
        val idle = core.createPbufferSurface(1, 1)
        core.makeCurrent(idle)
        egl = core
        idleSurface = idle
        program = GlPhotoProgram()
        maxTextureSize = GlPhotoProgram.maxTextureSize()
        choreographer = Choreographer.getInstance()
      } catch (e: Throwable) {
        emitError(e)
      }
    }
  }

  // React Native positions this view but does not lay out its native children.
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val width = r - l
    val height = b - t
    textureView.measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
    )
    textureView.layout(0, 0, width, height)
  }

  // region Props and ref methods

  fun setSource(value: String?) {
    source = value
    reloadIfNeeded()
  }

  fun setPreviewQuality(value: String?) {
    previewQuality = value ?: "auto"
    reloadIfNeeded()
  }

  fun setEdits(edits: EditStackRecord) {
    params = edits.toShaderParams()
    markInput()
  }

  fun setAdjustment(key: String, value: Double) {
    params = params.with(key, value) ?: return
    markInput()
  }

  fun beginInteraction() {
    interacting = true
  }

  fun endInteraction() {
    interacting = false
    renderHandler.post(flushStats)
    requestRender()
  }

  private fun markInput() {
    pendingInputNanos.compareAndSet(0, System.nanoTime())
    requestRender()
  }

  /** Safe from any thread. Many calls before the next vsync collapse into one frame. */
  private fun requestRender() {
    if (frameRequested.compareAndSet(false, true)) {
      renderHandler.post {
        if (::choreographer.isInitialized) choreographer.postFrameCallback(frameCallback)
        else frameRequested.set(false)
      }
    }
  }

  // endregion

  // region Loading

  private fun reloadIfNeeded() {
    val src = source ?: return
    val viewLongest = surfaceLongest
    if (src.isEmpty() || viewLongest <= 0) return
    val quality = previewQuality
    val key = "$src|$quality|${if (quality == "full") 0 else viewLongest}"
    if (key == loadedKey) return
    loadedKey = key
    val generation = loadGeneration.incrementAndGet()

    decodePool.execute {
      val start = SystemClock.elapsedRealtimeNanos()
      try {
        val info = PhotoDecoder.readInfo(context, src)
        val fullLongest = max(info.width, info.height)
        val maxTexture = if (maxTextureSize > 0) maxTextureSize else 4096
        val target = when (quality) {
          "full" -> min(fullLongest, maxTexture)
          "fast" -> max(1, min(fullLongest, viewLongest / 2))
          else -> max(1, min(fullLongest, viewLongest))
        }
        val bitmap = PhotoDecoder.decode(context, src, min(target, maxTexture), info)
        renderHandler.post {
          if (generation != loadGeneration.get() || program == null) {
            bitmap.recycle()
            return@post
          }
          try {
            if (imageTexture != 0) GlPhotoProgram.deleteTexture(imageTexture)
            imageTexture = GlPhotoProgram.uploadTexture(bitmap)
            imageWidth = bitmap.width
            imageHeight = bitmap.height
            sourceWidth = info.width
            sourceHeight = info.height
          } catch (e: Throwable) {
            emitError(e)
            return@post
          } finally {
            bitmap.recycle()
          }
          val event = mapOf(
            "sourceWidth" to info.width,
            "sourceHeight" to info.height,
            "previewWidth" to imageWidth,
            "previewHeight" to imageHeight,
            "decodeMs" to (SystemClock.elapsedRealtimeNanos() - start) / 1e6
          )
          post { onLoad(event) }
          requestRender()
        }
      } catch (e: Throwable) {
        post {
          if (generation == loadGeneration.get()) {
            loadedKey = null
            onError(mapOf("message" to (e.message ?: e.toString())))
          }
        }
      }
    }
  }

  // endregion

  // region Surface lifecycle (TextureView callbacks arrive on the main thread)

  override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
    surfaceLongest = max(width, height)
    renderHandler.post {
      val core = egl ?: return@post
      try {
        windowSurface = core.createWindowSurface(surface)
        surfaceWidth = width
        surfaceHeight = height
      } catch (e: Throwable) {
        emitError(e)
      }
    }
    reloadIfNeeded()
    requestRender()
  }

  override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
    surfaceLongest = max(width, height)
    renderHandler.post {
      surfaceWidth = width
      surfaceHeight = height
    }
    reloadIfNeeded()
    requestRender()
  }

  override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
    // The EGL surface must be gone before TextureView releases the SurfaceTexture under it.
    val done = CountDownLatch(1)
    renderHandler.post {
      val core = egl
      val window = windowSurface
      if (core != null && window != null) {
        idleSurface?.let { core.makeCurrent(it) }
        core.releaseSurface(window)
      }
      windowSurface = null
      done.countDown()
    }
    done.await(500, TimeUnit.MILLISECONDS)
    return true
  }

  override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit

  // endregion

  // region Rendering (render thread)

  private fun renderFrame() {
    frameRequested.set(false)
    val core = egl ?: return
    val window = windowSurface ?: return
    val program = program ?: return
    if (imageTexture == 0 || surfaceWidth == 0 || surfaceHeight == 0) return

    val inputNanos = pendingInputNanos.getAndSet(0)
    val start = System.nanoTime()
    core.makeCurrent(window)
    GLES30.glViewport(0, 0, surfaceWidth, surfaceHeight)
    GLES30.glClearColor(0f, 0f, 0f, 0f)
    GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT)
    program.draw(
      imageTexture, imageWidth, imageHeight, surfaceWidth, surfaceHeight,
      params, flipY = false, nearest = false
    )
    core.swapBuffers(window)
    val end = System.nanoTime()

    stats.addFrame(cpuNanos = end - start, at = start, latencyNanos = if (inputNanos != 0L) end - inputNanos else -1)
    emitStats(force = false)
    // If no more frames arrive, report the last partial window shortly after.
    renderHandler.removeCallbacks(flushStats)
    renderHandler.postDelayed(flushStats, 300)
  }

  private fun emitStats(force: Boolean) {
    val snapshot = stats.takeSnapshot(System.nanoTime(), force) ?: return
    val event = mapOf(
      "fps" to snapshot.fps,
      "frameTimeMs" to snapshot.cpuMs,
      // GLES has no portable per-frame GPU timer; reported as -1.
      "gpuTimeMs" to -1.0,
      "latencyMs" to snapshot.latencyMs,
      "previewWidth" to imageWidth,
      "previewHeight" to imageHeight,
      "sourceWidth" to sourceWidth,
      "sourceHeight" to sourceHeight,
      "interacting" to interacting
    )
    post { onRenderStats(event) }
  }

  private fun emitError(e: Throwable) {
    post { onError(mapOf("message" to (e.message ?: e.toString()))) }
  }

  // endregion

  /** Called when React drops the view: frees the GPU texture, the context and the thread. */
  fun release() {
    loadGeneration.incrementAndGet()
    renderHandler.post {
      if (::choreographer.isInitialized) choreographer.removeFrameCallback(frameCallback)
      renderHandler.removeCallbacks(flushStats)
      if (imageTexture != 0) GlPhotoProgram.deleteTexture(imageTexture)
      imageTexture = 0
      program?.release()
      program = null
      egl?.let { core ->
        windowSurface?.let { core.releaseSurface(it) }
        idleSurface?.let { core.releaseSurface(it) }
        core.release()
      }
      windowSurface = null
      idleSurface = null
      egl = null
      renderThread.quitSafely()
    }
  }

  companion object {
    private val decodePool = Executors.newFixedThreadPool(2)
  }
}

/** Per-frame timings, render thread only. */
internal class RenderStatsAccumulator {
  class Snapshot(val fps: Double, val cpuMs: Double, val latencyMs: Double)

  private var windowStart = 0L
  private var lastFrame = 0L
  private var frames = 0
  private var cpuTotal = 0L
  private var latencyTotal = 0L
  private var latencyCount = 0

  fun addFrame(cpuNanos: Long, at: Long, latencyNanos: Long) {
    if (frames == 0 || at - lastFrame > 250_000_000L) {
      // First frame after an idle gap starts a new window, so idle time never drags fps down.
      reset()
      windowStart = at
    }
    frames += 1
    cpuTotal += cpuNanos
    if (latencyNanos >= 0) {
      latencyTotal += latencyNanos
      latencyCount += 1
    }
    lastFrame = at
  }

  /** Returns averages once the window is at least 0.5s long (or immediately when forced), then resets. */
  fun takeSnapshot(now: Long, force: Boolean): Snapshot? {
    if (frames < 2 || (!force && now - windowStart < 500_000_000L)) return null
    val elapsed = max(lastFrame - windowStart, 1L)
    val snapshot = Snapshot(
      fps = (frames - 1) * 1e9 / elapsed,
      cpuMs = cpuTotal / 1e6 / frames,
      latencyMs = if (latencyCount > 0) latencyTotal / 1e6 / latencyCount else -1.0
    )
    reset()
    return snapshot
  }

  private fun reset() {
    frames = 0
    cpuTotal = 0
    latencyTotal = 0
    latencyCount = 0
  }
}
