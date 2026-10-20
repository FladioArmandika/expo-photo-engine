import ExpoModulesCore
import Metal
import QuartzCore
import UIKit

/// A plain UIView whose backing layer is a CAMetalLayer: the GPU draws straight into it.
private final class MetalLayerView: UIView {
  override class var layerClass: AnyClass { CAMetalLayer.self }
  var metalLayer: CAMetalLayer { layer as! CAMetalLayer }
}

/// CADisplayLink keeps a strong reference to its target, so it points at this proxy
/// instead of the view to avoid a retain cycle.
@MainActor
private final class DisplayLinkProxy: NSObject {
  weak var view: PhotoCanvasView?
  init(_ view: PhotoCanvasView) { self.view = view }
  @objc func tick(_ link: CADisplayLink) { view?.renderFrame() }
}

/// Longest side of the preview texture for a given quality setting. `zoom` is how much the crop
/// enlarges the photo on screen: a crop of half the photo needs twice the pixels to stay sharp.
private func previewPixelSize(quality: String, viewLongest: Int, fullLongest: Int, zoom: Double) -> Int {
  if quality == "full" {
    return min(fullLongest, PhotoRenderer.maxTextureSize)
  }
  let base = Double(quality == "fast" ? viewLongest / 2 : viewLongest)
  // Zooming in never asks for more than previewZoomLimit pixels, to bound memory.
  let zoomed = min(base * zoom, max(base, Double(previewZoomLimit)))
  return max(1, min(fullLongest, PhotoRenderer.maxTextureSize, Int(zoomed.rounded(.up))))
}

/// Largest preview texture a crop can ask for (a 4096x3072 texture is 48 MB).
private let previewZoomLimit = 4096

/// The crop's zoom rounded up to steps of √2, so small crop changes don't each cause a new decode.
private func zoomStep(_ crop: CropGeometry, width: Int, height: Int) -> Double {
  guard width > 0, height > 0 else { return 1 }
  let zoom = 1 / Double(max(crop.longestFraction(width: width, height: height), 0.01))
  return pow(2, ((log2(zoom) * 2) - 0.05).rounded(.up) / 2)
}

final class PhotoCanvasView: ExpoView {
  let onLoad = EventDispatcher()
  let onError = EventDispatcher()
  let onRenderStats = EventDispatcher()

  private let renderer = PhotoRenderer.shared
  private let canvas = MetalLayerView()
  private var displayLink: CADisplayLink?

  private var source: String?
  private var previewQuality = "auto"
  private var params = ShaderParams()
  private var texture: MTLTexture?
  private var sourceSize = (width: 0, height: 0)
  private var loadGeneration = 0
  /// Source, quality and view size of the current texture, and the crop zoom it was decoded for.
  private var loadedKey: String?
  private var loadedZoom = 1.0

  // Render coalescing: inputs only set a flag; the display link draws at most once per refresh.
  private var needsRender = false
  private var pendingInputTime: CFTimeInterval?
  private var interacting = false
  private let stats = RenderStatsAccumulator()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    canvas.isOpaque = false
    canvas.backgroundColor = .clear
    let layer = canvas.metalLayer
    layer.device = renderer?.device
    layer.pixelFormat = .bgra8Unorm
    layer.framebufferOnly = true
    layer.isOpaque = false
    // The shader outputs sRGB-encoded values; tell the compositor so it color-matches correctly.
    layer.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
    addSubview(canvas)

    if renderer == nil {
      onError(["message": PhotoEngineError.noMetalDevice.description])
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    canvas.frame = bounds
    let scale = max(traitCollection.displayScale, 1)
    canvas.contentScaleFactor = scale
    canvas.metalLayer.drawableSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
    reloadIfNeeded()
    setNeedsRender()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      guard displayLink == nil else { return }
      let link = CADisplayLink(target: DisplayLinkProxy(self), selector: #selector(DisplayLinkProxy.tick(_:)))
      // Allows 120Hz on ProMotion iPhones (the app also needs CADisableMinimumFrameDurationOnPhone).
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 120, preferred: 120)
      link.isPaused = !needsRender
      link.add(to: .main, forMode: .common)
      displayLink = link
    } else {
      displayLink?.invalidate()
      displayLink = nil
    }
  }

  // MARK: - Props and ref methods (all called on the main thread)

  func setSource(_ value: String?) {
    source = value
    reloadIfNeeded()
  }

  func setPreviewQuality(_ value: String?) {
    previewQuality = value ?? "auto"
    reloadIfNeeded()
  }

  func setEdits(_ edits: EditStackRecord) {
    params = ShaderParams(edits)
    markInput()
    // A tighter crop may need a sharper preview. Wait for the end of a drag before decoding.
    if !interacting {
      reloadIfNeeded()
    }
  }

  func setAdjustment(_ key: String, _ value: Double) {
    guard params.set(key, value) else { return }
    markInput()
  }

  func beginInteraction() {
    interacting = true
  }

  func endInteraction() {
    interacting = false
    emitStats(force: true)
    setNeedsRender()
    reloadIfNeeded()
  }

  private func markInput() {
    if pendingInputTime == nil {
      pendingInputTime = CACurrentMediaTime()
    }
    setNeedsRender()
  }

  private func setNeedsRender() {
    needsRender = true
    displayLink?.isPaused = false
  }

  // MARK: - Loading

  private func reloadIfNeeded() {
    guard let renderer, let source, !source.isEmpty else { return }
    let drawable = canvas.metalLayer.drawableSize
    let viewLongest = Int(max(drawable.width, drawable.height))
    guard viewLongest > 0 else { return }

    let quality = previewQuality
    let key = "\(source)|\(quality)|\(quality == "full" ? 0 : viewLongest)"
    let zoom = quality == "full" ? 1 : zoomStep(params.crop, width: sourceSize.width, height: sourceSize.height)
    // Same photo and view: only decode again when the crop needs more pixels than the texture has.
    // A looser crop keeps the sharper texture.
    let sharpen = key == loadedKey
    if sharpen && zoom <= loadedZoom { return }
    loadedKey = key
    loadedZoom = zoom
    loadGeneration += 1
    let generation = loadGeneration

    // Decoding a 24MP+ JPEG takes far longer than a frame, so it runs off the main thread.
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let start = CACurrentMediaTime()
      do {
        let url = try PhotoRenderer.url(for: source)
        let full = try PhotoRenderer.orientedSize(of: url)
        let target = previewPixelSize(
          quality: quality, viewLongest: viewLongest, fullLongest: max(full.width, full.height),
          zoom: zoom)
        let image = try PhotoRenderer.decode(url: url, maxPixelSize: target)
        let texture = try renderer.makeTexture(from: image)
        let decodeMs = (CACurrentMediaTime() - start) * 1000
        DispatchQueue.main.async {
          guard let self, generation == self.loadGeneration else { return }
          self.texture = texture
          self.sourceSize = full
          self.setNeedsRender()
          // A sharper texture for a crop is not a new load.
          guard !sharpen else { return }
          self.onLoad([
            "sourceWidth": full.width,
            "sourceHeight": full.height,
            "previewWidth": texture.width,
            "previewHeight": texture.height,
            "decodeMs": decodeMs,
          ])
          // The first decode didn't know the photo's size yet, so it couldn't account for the crop.
          self.reloadIfNeeded()
        }
      } catch {
        DispatchQueue.main.async {
          guard let self, generation == self.loadGeneration else { return }
          self.loadedKey = nil
          self.onError(["message": "\(error)"])
        }
      }
    }
  }

  // MARK: - Rendering

  fileprivate func renderFrame() {
    guard needsRender else {
      // Nothing changed since the last frame: stop the display link until the next input.
      displayLink?.isPaused = true
      emitStats(force: true)
      return
    }
    needsRender = false

    let layer = canvas.metalLayer
    guard let renderer, let texture, layer.drawableSize.width > 0,
          let drawable = layer.nextDrawable(),
          let commandBuffer = renderer.queue.makeCommandBuffer()
    else { return }

    let cpuStart = CACurrentMediaTime()
    let inputTime = pendingInputTime
    pendingInputTime = nil

    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = drawable.texture
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0)
    pass.colorAttachments[0].storeAction = .store
    guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass) else { return }
    renderer.encodeDraw(
      encoder, pipeline: renderer.screenPipeline, texture: texture,
      params: params, targetSize: layer.drawableSize)
    encoder.endEncoding()

    let stats = self.stats
    #if !targetEnvironment(simulator)
    // Presentation callbacks don't exist in the simulator SDK; latency reads -1 there.
    if let inputTime {
      // presentedTime is on the same clock as CACurrentMediaTime: true input-to-glass latency.
      drawable.addPresentedHandler { presented in
        if presented.presentedTime > 0 {
          stats.addLatency(presented.presentedTime - inputTime)
        }
      }
    }
    #else
    _ = inputTime
    #endif
    commandBuffer.addCompletedHandler { buffer in
      stats.addGpuTime(buffer.gpuEndTime - buffer.gpuStartTime)
    }
    commandBuffer.present(drawable)
    commandBuffer.commit()

    stats.addFrame(cpuTime: CACurrentMediaTime() - cpuStart, at: cpuStart)
    emitStats(force: false)
  }

  private func emitStats(force: Bool) {
    guard let snapshot = stats.takeSnapshot(now: CACurrentMediaTime(), force: force) else { return }
    onRenderStats([
      "fps": snapshot.fps,
      "frameTimeMs": snapshot.cpuMs,
      "gpuTimeMs": snapshot.gpuMs,
      "latencyMs": snapshot.latencyMs,
      "previewWidth": texture?.width ?? 0,
      "previewHeight": texture?.height ?? 0,
      "sourceWidth": sourceSize.width,
      "sourceHeight": sourceSize.height,
      "interacting": interacting,
    ])
  }
}

/// Collects per-frame timings from the main thread and from Metal's completion threads.
final class RenderStatsAccumulator: @unchecked Sendable {
  struct Snapshot {
    let fps: Double
    let cpuMs: Double
    let gpuMs: Double
    let latencyMs: Double
  }

  private let lock = NSLock()
  private var windowStart: CFTimeInterval = 0
  private var lastFrame: CFTimeInterval = 0
  private var frames = 0
  private var cpuTotal = 0.0
  private var gpuTotal = 0.0
  private var gpuCount = 0
  private var latencyTotal = 0.0
  private var latencyCount = 0

  func addFrame(cpuTime: CFTimeInterval, at time: CFTimeInterval) {
    lock.lock()
    defer { lock.unlock() }
    if frames == 0 || time - lastFrame > 0.25 {
      // First frame after an idle gap starts a new window, so idle time never drags fps down.
      resetLocked()
      windowStart = time
    }
    frames += 1
    cpuTotal += cpuTime
    lastFrame = time
  }

  func addGpuTime(_ seconds: CFTimeInterval) {
    lock.lock()
    gpuTotal += seconds
    gpuCount += 1
    lock.unlock()
  }

  func addLatency(_ seconds: CFTimeInterval) {
    lock.lock()
    latencyTotal += seconds
    latencyCount += 1
    lock.unlock()
  }

  /// Returns averages once the window is at least 0.5s long (or immediately when forced), then resets.
  func takeSnapshot(now: CFTimeInterval, force: Bool) -> Snapshot? {
    lock.lock()
    defer { lock.unlock() }
    guard frames > 1, force || now - windowStart >= 0.5 else { return nil }
    let elapsed = max(lastFrame - windowStart, 0.000_001)
    let snapshot = Snapshot(
      fps: Double(frames - 1) / elapsed,
      cpuMs: cpuTotal / Double(frames) * 1000,
      gpuMs: gpuCount > 0 ? gpuTotal / Double(gpuCount) * 1000 : -1,
      latencyMs: latencyCount > 0 ? latencyTotal / Double(latencyCount) * 1000 : -1)
    resetLocked()
    return snapshot
  }

  private func resetLocked() {
    frames = 0
    cpuTotal = 0
    gpuTotal = 0
    gpuCount = 0
    latencyTotal = 0
    latencyCount = 0
  }
}
