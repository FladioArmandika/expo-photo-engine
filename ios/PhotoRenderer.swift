import CoreGraphics
import ImageIO
import QuartzCore
import Metal
import UniformTypeIdentifiers

enum PhotoEngineError: Error, CustomStringConvertible {
  case noMetalDevice
  case invalidSource(String)
  case decodeFailed(String)
  case renderFailed(String)

  var description: String {
    switch self {
    case .noMetalDevice: return "Metal is not available on this device"
    case .invalidSource(let s): return "Invalid image source: \(s)"
    case .decodeFailed(let s): return "Could not decode image: \(s)"
    case .renderFailed(let s): return "Render failed: \(s)"
    }
  }
}

/// Parameters the fragment shader reads. Mirrors `params` in Shaders.swift.
struct ShaderParams {
  var exposure: Float = 0

  var packed: SIMD4<Float> { SIMD4(exposure, 0, 0, 0) }
}

/// Process-wide Metal objects. Creating a device, queue and pipelines is expensive,
/// so every PhotoCanvas and every export shares one set.
final class PhotoRenderer: @unchecked Sendable {
  static let shared: PhotoRenderer? = try? PhotoRenderer()

  /// Apple GPUs from A9 onwards support 16384px textures.
  static let maxTextureSize = 16384

  let device: MTLDevice
  let queue: MTLCommandQueue
  /// Pipeline that draws into the on-screen layer (BGRA is the layer's native format).
  let screenPipeline: MTLRenderPipelineState
  /// Pipeline that draws into an offscreen RGBA texture for export.
  let exportPipeline: MTLRenderPipelineState
  let linearSampler: MTLSamplerState
  let nearestSampler: MTLSamplerState

  private init() throws {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
      throw PhotoEngineError.noMetalDevice
    }
    self.device = device
    self.queue = queue

    // Compiled at runtime from source so the pod needs no .metallib build step.
    // Fast math is off so pow/exp2 match the Android GLSL highp results as closely as possible.
    let options = MTLCompileOptions()
    if #available(iOS 18.0, *) {
      options.mathMode = .safe
    } else {
      options.fastMathEnabled = false
    }
    let library = try device.makeLibrary(source: photoEngineMetalSource, options: options)

    func makePipeline(_ format: MTLPixelFormat) throws -> MTLRenderPipelineState {
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.vertexFunction = library.makeFunction(name: "photo_vertex")
      descriptor.fragmentFunction = library.makeFunction(name: "photo_fragment")
      descriptor.colorAttachments[0].pixelFormat = format
      return try device.makeRenderPipelineState(descriptor: descriptor)
    }
    screenPipeline = try makePipeline(.bgra8Unorm)
    exportPipeline = try makePipeline(.rgba8Unorm)

    func makeSampler(_ filter: MTLSamplerMinMagFilter) -> MTLSamplerState? {
      let descriptor = MTLSamplerDescriptor()
      descriptor.minFilter = filter
      descriptor.magFilter = filter
      descriptor.sAddressMode = .clampToEdge
      descriptor.tAddressMode = .clampToEdge
      return device.makeSamplerState(descriptor: descriptor)
    }
    guard let linear = makeSampler(.linear), let nearest = makeSampler(.nearest) else {
      throw PhotoEngineError.noMetalDevice
    }
    linearSampler = linear
    nearestSampler = nearest
  }

  // MARK: - Decoding

  static func url(for source: String) throws -> URL {
    if source.hasPrefix("file://"), let url = URL(string: source) {
      return url
    }
    if source.hasPrefix("/") {
      return URL(fileURLWithPath: source)
    }
    throw PhotoEngineError.invalidSource(source)
  }

  /// Pixel size after EXIF orientation is applied.
  static func orientedSize(of url: URL) throws -> (width: Int, height: Int) {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
          let w = props[kCGImagePropertyPixelWidth] as? Int,
          let h = props[kCGImagePropertyPixelHeight] as? Int
    else {
      throw PhotoEngineError.decodeFailed(url.lastPathComponent)
    }
    let orientation = props[kCGImagePropertyOrientation] as? UInt32 ?? 1
    // Orientations 5...8 rotate by 90 degrees and swap the axes.
    return orientation >= 5 ? (h, w) : (w, h)
  }

  /// Decodes `url` with EXIF orientation applied, downscaled so its longest side is at most
  /// `maxPixelSize`. ImageIO decodes straight to the smaller size, so a 48MP JPEG never
  /// has to sit fully decoded in memory just to make a preview.
  static func decode(url: URL, maxPixelSize: Int) throws -> CGImage {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else {
      throw PhotoEngineError.decodeFailed(url.lastPathComponent)
    }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
      kCGImageSourceShouldCacheImmediately: true,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(src, 0, options as CFDictionary) else {
      throw PhotoEngineError.decodeFailed(url.lastPathComponent)
    }
    return image
  }

  /// Draws the image into an 8-bit sRGB RGBA buffer and uploads it. Drawing through an
  /// sRGB context converts Display P3 (and any other profile) to sRGB, which is the
  /// working space the Android side uses as well.
  func makeTexture(from image: CGImage) throws -> MTLTexture {
    let width = image.width
    let height = image.height
    let bytesPerRow = width * 4
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: bytesPerRow,
            space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)
    else {
      throw PhotoEngineError.decodeFailed("could not allocate \(width)x\(height) buffer")
    }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let data = context.data else {
      throw PhotoEngineError.decodeFailed("empty bitmap")
    }

    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .rgba8Unorm, width: width, height: height, mipmapped: false)
    descriptor.usage = [.shaderRead]
    descriptor.storageMode = .shared
    guard let texture = device.makeTexture(descriptor: descriptor) else {
      throw PhotoEngineError.decodeFailed("could not allocate \(width)x\(height) texture")
    }
    texture.replace(
      region: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0, withBytes: data,
      bytesPerRow: bytesPerRow)
    return texture
  }

  // MARK: - Drawing

  /// Encodes one draw of `texture` with `params` into `encoder`, aspect-fitted to `targetSize`.
  func encodeDraw(
    _ encoder: MTLRenderCommandEncoder, pipeline: MTLRenderPipelineState, sampler: MTLSamplerState,
    texture: MTLTexture, params: ShaderParams, targetSize: CGSize, flipY: Bool = false
  ) {
    let imageAspect = Float(texture.width) / Float(texture.height)
    let targetAspect = Float(targetSize.width / max(targetSize.height, 1))
    var vparams = SIMD4<Float>(1, 1, flipY ? 1 : 0, 0)
    if imageAspect > targetAspect {
      vparams.y = targetAspect / imageAspect
    } else {
      vparams.x = imageAspect / targetAspect
    }
    var fparams = params.packed

    encoder.setRenderPipelineState(pipeline)
    encoder.setVertexBytes(&vparams, length: MemoryLayout<SIMD4<Float>>.stride, index: 0)
    encoder.setFragmentBytes(&fparams, length: MemoryLayout<SIMD4<Float>>.stride, index: 0)
    encoder.setFragmentTexture(texture, index: 0)
    encoder.setFragmentSamplerState(sampler, index: 0)
    encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
  }

  // MARK: - Export

  /// Headless export: decode → same shader → offscreen texture → file. No view involved.
  func export(
    source: String, params: ShaderParams, format: String, quality: Double, maxDimension: Int
  ) throws -> [String: Any] {
    let start = CACurrentMediaTime()
    let url = try Self.url(for: source)
    let full = try Self.orientedSize(of: url)
    var longest = max(full.width, full.height)
    if maxDimension > 0 { longest = min(longest, maxDimension) }
    longest = min(longest, Self.maxTextureSize)

    let image = try Self.decode(url: url, maxPixelSize: longest)
    let input = try makeTexture(from: image)
    let width = input.width
    let height = input.height

    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .rgba8Unorm, width: width, height: height, mipmapped: false)
    descriptor.usage = [.renderTarget, .shaderRead]
    descriptor.storageMode = .shared
    guard let output = device.makeTexture(descriptor: descriptor),
          let commandBuffer = queue.makeCommandBuffer()
    else {
      throw PhotoEngineError.renderFailed("could not allocate output")
    }

    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = output
    pass.colorAttachments[0].loadAction = .dontCare
    pass.colorAttachments[0].storeAction = .store
    guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass) else {
      throw PhotoEngineError.renderFailed("could not create encoder")
    }
    let renderStart = CACurrentMediaTime()
    // 1:1 texel mapping with nearest sampling: every output pixel reads exactly one input pixel.
    encodeDraw(
      encoder, pipeline: exportPipeline, sampler: nearestSampler, texture: input, params: params,
      targetSize: CGSize(width: width, height: height))
    encoder.endEncoding()
    commandBuffer.commit()
    commandBuffer.waitUntilCompleted()
    if let error = commandBuffer.error {
      throw PhotoEngineError.renderFailed(error.localizedDescription)
    }
    let renderMs = (CACurrentMediaTime() - renderStart) * 1000

    let bytesPerRow = width * 4
    var pixels = [UInt8](repeating: 0, count: bytesPerRow * height)
    output.getBytes(
      &pixels, bytesPerRow: bytesPerRow, from: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0)

    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let provider = CGDataProvider(data: Data(pixels) as CFData),
          let cgImage = CGImage(
            width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: bytesPerRow,
            space: space,
            bitmapInfo: CGBitmapInfo(
              rawValue: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    else {
      throw PhotoEngineError.renderFailed("could not wrap output pixels")
    }

    let isJpeg = format == "jpeg"
    let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("ExpoPhotoEngine", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let fileURL = directory.appendingPathComponent("\(UUID().uuidString).\(isJpeg ? "jpg" : "png")")
    let type = (isJpeg ? UTType.jpeg : UTType.png).identifier as CFString
    guard let destination = CGImageDestinationCreateWithURL(fileURL as CFURL, type, 1, nil) else {
      throw PhotoEngineError.renderFailed("could not create file")
    }
    let properties: [CFString: Any] = isJpeg ? [kCGImageDestinationLossyCompressionQuality: quality] : [:]
    CGImageDestinationAddImage(destination, cgImage, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      throw PhotoEngineError.renderFailed("could not write file")
    }

    return [
      "uri": fileURL.absoluteString,
      "width": width,
      "height": height,
      "totalMs": (CACurrentMediaTime() - start) * 1000,
      "renderMs": renderMs,
    ]
  }
}
