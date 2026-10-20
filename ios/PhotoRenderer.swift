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

/// Crop, rotation, straighten and flips, as the vertex shader reads them. Mirrors `Crop` in
/// src/edit-stack/types.ts; the default is no crop.
struct CropGeometry: Equatable {
  /// Normalized [x, y, width, height] in the image after rotation and flips.
  var rect = SIMD4<Float>(0, 0, 1, 1)
  /// Clockwise quarter turns, 0...3.
  var turns = 0
  /// Degrees, clockwise.
  var straighten: Float = 0
  var flipH = false
  var flipV = false

  init() {}

  init(_ record: CropRecord) {
    if record.rect.count == 4 {
      rect = SIMD4(record.rect.map { Float($0) })
    }
    turns = ((record.rotation / 90) % 4 + 4) % 4
    straighten = Float(record.straighten)
    flipH = record.flipH
    flipV = record.flipV
  }

  /// Output size in pixels when cropping an image of `width` x `height`.
  func outputSize(width: Int, height: Int) -> (width: Int, height: Int) {
    let (w, h) = turns % 2 == 1 ? (height, width) : (width, height)
    return (
      max(1, Int((Float(w) * rect.z).rounded())),
      max(1, Int((Float(h) * rect.w).rounded()))
    )
  }

  /// Longest side of the crop as a fraction of the image's longest side.
  func longestFraction(width: Int, height: Int) -> Float {
    let (w, h) = turns % 2 == 1 ? (height, width) : (width, height)
    return max(Float(w) * rect.z, Float(h) * rect.w) / Float(max(w, h))
  }

  var packed: [SIMD4<Float>] {
    [rect, SIMD4(Float(turns), straighten * .pi / 180, flipH ? 1 : 0, flipV ? 1 : 0)]
  }
}

/// Everything the shaders read, keyed like `AdjustmentKey` in src/edit-stack/types.ts.
/// Unknown keys are ignored, missing ones are neutral (0).
struct ShaderParams {
  /// Slot of each key in the three float4s the fragment shader receives. Mirrors applyAdjustments in Shaders.swift.
  static let slots: [String: Int] = [
    "exposure": 0, "contrast": 1, "highlights": 2, "shadows": 3,
    "saturation": 4, "vibrance": 5, "warmth": 6, "tint": 7,
    "sharpness": 8, "vignette": 9,
  ]
  /// p2.z: the output's width / height, filled in at draw time.
  static let outputAspectSlot = 10

  /// Floats applyFilter reads: eight float4s, packed by src/filters/looks.ts.
  static let filterCount = 32

  private(set) var values = [Float](repeating: 0, count: 12)
  var crop = CropGeometry()
  /// All zeros (intensity 0) means no filter.
  private(set) var filter = [Float](repeating: 0, count: filterCount)

  init() {}

  init(_ edits: EditStackRecord) {
    for (key, value) in edits.adjustments {
      set(key, value)
    }
    if let crop = edits.crop {
      self.crop = CropGeometry(crop)
    }
    if let uniforms = edits.filter?.uniforms, uniforms.count == Self.filterCount {
      filter = uniforms.map { Float($0) }
    }
  }

  /// Returns false for a key the shader doesn't know.
  @discardableResult
  mutating func set(_ key: String, _ value: Double) -> Bool {
    guard let slot = Self.slots[key] else { return false }
    values[slot] = Float(value)
    return true
  }

  /// The fragment shader's params: applyAdjustments' p0, p1, p2, then applyFilter's f0...f7.
  func packed(outputAspect: Float) -> [SIMD4<Float>] {
    var v = values + filter
    v[Self.outputAspectSlot] = outputAspect
    return stride(from: 0, to: v.count, by: 4).map { SIMD4(v[$0], v[$0 + 1], v[$0 + 2], v[$0 + 3]) }
  }
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

  /// Encodes one draw of `texture` with `params` into `encoder`: the cropped image,
  /// aspect-fitted to `targetSize`.
  func encodeDraw(
    _ encoder: MTLRenderCommandEncoder, pipeline: MTLRenderPipelineState, sampler: MTLSamplerState,
    texture: MTLTexture, params: ShaderParams, targetSize: CGSize, flipY: Bool = false
  ) {
    let output = params.crop.outputSize(width: texture.width, height: texture.height)
    let imageAspect = Float(output.width) / Float(output.height)
    let targetAspect = Float(targetSize.width / max(targetSize.height, 1))
    var scale = SIMD2<Float>(1, 1)
    if imageAspect > targetAspect {
      scale.y = targetAspect / imageAspect
    } else {
      scale.x = imageAspect / targetAspect
    }
    let textureAspect = Float(texture.width) / Float(texture.height)
    var vparams = [SIMD4<Float>(scale.x, scale.y, flipY ? 1 : 0, textureAspect)] + params.crop.packed
    var fparams = params.packed(outputAspect: imageAspect)

    encoder.setRenderPipelineState(pipeline)
    encoder.setVertexBytes(&vparams, length: MemoryLayout<SIMD4<Float>>.stride * vparams.count, index: 0)
    encoder.setFragmentBytes(&fparams, length: MemoryLayout<SIMD4<Float>>.stride * fparams.count, index: 0)
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
    let input = try decodeTexture(source: source, crops: [params.crop], maxDimension: maxDimension)
    let renderStart = CACurrentMediaTime()
    let image = try render(input: input, params: params)
    let renderMs = (CACurrentMediaTime() - renderStart) * 1000
    let fileURL = try write(image, format: format, quality: quality)
    return [
      "uri": fileURL.absoluteString,
      "width": image.width,
      "height": image.height,
      "totalMs": (CACurrentMediaTime() - start) * 1000,
      "renderMs": renderMs,
    ]
  }

  /// Renders several edit stacks of one photo as small JPEGs, decoding the photo only once.
  /// Used for filter thumbnails.
  func thumbnails(
    source: String, params: [ShaderParams], maxDimension: Int, quality: Double
  ) throws -> [[String: Any]] {
    guard !params.isEmpty else { return [] }
    let input = try decodeTexture(source: source, crops: params.map(\.crop), maxDimension: maxDimension)
    return try params.map { p in
      let image = try render(input: input, params: p)
      let fileURL = try write(image, format: "jpeg", quality: quality)
      return ["uri": fileURL.absoluteString, "width": image.width, "height": image.height]
    }
  }

  /// Decodes `source` just large enough that every crop in `crops` reaches `maxDimension`
  /// (0 = full size), and uploads it.
  private func decodeTexture(source: String, crops: [CropGeometry], maxDimension: Int) throws -> MTLTexture {
    let url = try Self.url(for: source)
    let full = try Self.orientedSize(of: url)
    let fullLongest = max(full.width, full.height)
    var longest = fullLongest
    if maxDimension > 0 {
      // maxDimension limits the cropped output, so decode just large enough for the crop to reach it.
      let fraction = crops.map { $0.longestFraction(width: full.width, height: full.height) }.min() ?? 1
      let needed = (Float(maxDimension) / fraction).rounded(.up)
      longest = min(longest, Int(min(needed, Float(fullLongest))))
    }
    longest = min(longest, Self.maxTextureSize)
    return try makeTexture(from: Self.decode(url: url, maxPixelSize: longest))
  }

  /// Draws `input` with `params` into an offscreen texture the size of the crop and reads it back.
  private func render(input: MTLTexture, params: ShaderParams) throws -> CGImage {
    let (width, height) = params.crop.outputSize(width: input.width, height: input.height)

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
    // Without straightening every output pixel lands on exactly one input pixel, so nearest
    // sampling copies it exactly. A straightened image falls between pixels and needs filtering.
    let sampler = params.crop.straighten == 0 ? nearestSampler : linearSampler
    encodeDraw(
      encoder, pipeline: exportPipeline, sampler: sampler, texture: input, params: params,
      targetSize: CGSize(width: width, height: height))
    encoder.endEncoding()
    commandBuffer.commit()
    commandBuffer.waitUntilCompleted()
    if let error = commandBuffer.error {
      throw PhotoEngineError.renderFailed(error.localizedDescription)
    }

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
    return cgImage
  }

  /// Writes `image` to a new file in the caches directory.
  private func write(_ image: CGImage, format: String, quality: Double) throws -> URL {
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
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      throw PhotoEngineError.renderFailed("could not write file")
    }
    return fileURL
  }
}
