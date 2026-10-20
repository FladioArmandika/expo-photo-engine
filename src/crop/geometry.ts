import { createCrop } from '../edit-stack/operations';
import type { Crop, CropAspect, EditStack } from '../edit-stack/types';

/** A rectangle in pixels. */
export type Box = { x: number; y: number; width: number; height: number };

/** Which part of the crop box a drag grabbed. */
export type CropHandle =
  | 'move'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

/**
 * Width / height of the photo as shown: the source size after the crop's quarter turns.
 * `sourceWidth` and `sourceHeight` are the photo's size after EXIF orientation (PhotoCanvas onLoad).
 */
export function shownAspect(crop: Crop | null, sourceWidth: number, sourceHeight: number): number {
  const turned = (crop?.rotation ?? 0) % 180 !== 0;
  return turned ? sourceHeight / sourceWidth : sourceWidth / sourceHeight;
}

/** Width / height that `aspect` asks for, or null for `free`. */
export function aspectRatio(aspect: CropAspect, shown: number): number | null {
  if (aspect === 'free') return null;
  if (aspect === 'original') return shown;
  const [w, h] = aspect.split(':').map(Number);
  return w && h ? w / h : null;
}

/** Where a photo of aspect `shown` sits when fitted (contain) into `width` x `height`, minus `inset`. */
export function fitFrame(shown: number, width: number, height: number, inset = 0): Box {
  const w = Math.max(1, width - inset * 2);
  const h = Math.max(1, height - inset * 2);
  const fitted = shown > w / h ? { width: w, height: w / shown } : { width: h * shown, height: h };
  return { x: (width - fitted.width) / 2, y: (height - fitted.height) / 2, ...fitted };
}

/**
 * What the canvas should show while the crop is being edited: the whole photo, still rotated,
 * flipped and straightened, so the crop box can be drawn over it.
 */
export function cropEditingView(stack: EditStack): EditStack {
  if (!stack.crop) return stack;
  return { ...stack, crop: { ...stack.crop, rect: [0, 0, 1, 1] } };
}

/**
 * Sets the crop's aspect. For anything but `free` the crop becomes the largest box of that shape
 * that fits in the photo, centered where the current crop is centered.
 */
export function withCropAspect(
  stack: EditStack,
  aspect: CropAspect,
  sourceWidth: number,
  sourceHeight: number
): EditStack {
  const crop = stack.crop ?? createCrop();
  const shown = shownAspect(crop, sourceWidth, sourceHeight);
  const ratio = aspectRatio(aspect, shown);
  if (ratio === null) return { ...stack, crop: { ...crop, aspect } };
  // In normalized units a box of pixel ratio `ratio` has width / height = ratio / shown.
  const relative = ratio / shown;
  const [x, y, w, h] = crop.rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const width = relative >= 1 ? 1 : relative;
  const height = relative >= 1 ? 1 / relative : 1;
  const left = clamp(cx - width / 2, 0, 1 - width);
  const top = clamp(cy - height / 2, 0, 1 - height);
  return {
    ...stack,
    crop: { ...crop, aspect, rect: [left, top, width, height].map(tidy) as Crop['rect'] },
  };
}

/** Which handle is under (x, y), or null when the point is outside the crop box. */
export function hitTest(box: Box, x: number, y: number, slop = 24): CropHandle | null {
  const nearLeft = Math.abs(x - box.x) <= slop;
  const nearRight = Math.abs(x - (box.x + box.width)) <= slop;
  const nearTop = Math.abs(y - box.y) <= slop;
  const nearBottom = Math.abs(y - (box.y + box.height)) <= slop;
  const withinX = x >= box.x - slop && x <= box.x + box.width + slop;
  const withinY = y >= box.y - slop && y <= box.y + box.height + slop;
  if (!withinX || !withinY) return null;
  if (nearTop && nearLeft) return 'topLeft';
  if (nearTop && nearRight) return 'topRight';
  if (nearBottom && nearLeft) return 'bottomLeft';
  if (nearBottom && nearRight) return 'bottomRight';
  if (nearLeft) return 'left';
  if (nearRight) return 'right';
  if (nearTop) return 'top';
  if (nearBottom) return 'bottom';
  const inside = x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height;
  return inside ? 'move' : null;
}

/**
 * The crop box after dragging `handle` by (dx, dy) pixels, kept inside `bounds` and at least
 * `minSize` pixels on each side. With a `ratio` (width / height) a corner keeps the opposite
 * corner fixed and an edge keeps the opposite edge fixed, centered on the other axis.
 */
export function dragCropBox(
  start: Box,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: Box,
  ratio: number | null,
  minSize = 40
): Box {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;

  if (handle === 'move') {
    return {
      ...start,
      x: clamp(start.x + dx, bounds.x, right - start.width),
      y: clamp(start.y + dy, bounds.y, bottom - start.height),
    };
  }

  const movesLeft = handle === 'left' || handle === 'topLeft' || handle === 'bottomLeft';
  const movesRight = handle === 'right' || handle === 'topRight' || handle === 'bottomRight';
  const movesTop = handle === 'top' || handle === 'topLeft' || handle === 'topRight';
  const movesBottom = handle === 'bottom' || handle === 'bottomLeft' || handle === 'bottomRight';

  if (ratio === null) {
    let l = start.x;
    let r = start.x + start.width;
    let t = start.y;
    let b = start.y + start.height;
    if (movesLeft) l = clamp(l + dx, bounds.x, r - minSize);
    if (movesRight) r = clamp(r + dx, l + minSize, right);
    if (movesTop) t = clamp(t + dy, bounds.y, b - minSize);
    if (movesBottom) b = clamp(b + dy, t + minSize, bottom);
    return { x: l, y: t, width: r - l, height: b - t };
  }

  const minWidth = Math.max(minSize, minSize * ratio);
  const horizontal = movesLeft || movesRight;
  const vertical = movesTop || movesBottom;

  if (horizontal && vertical) {
    // Corner: the opposite corner stays put.
    const ax = movesLeft ? start.x + start.width : start.x;
    const ay = movesTop ? start.y + start.height : start.y;
    const wanted = Math.max(
      movesLeft ? start.width - dx : start.width + dx,
      (movesTop ? start.height - dy : start.height + dy) * ratio
    );
    const roomX = movesLeft ? ax - bounds.x : right - ax;
    const roomY = movesTop ? ay - bounds.y : bottom - ay;
    const width = clamp(wanted, Math.min(minWidth, roomX), Math.min(roomX, roomY * ratio));
    const height = width / ratio;
    return {
      x: movesLeft ? ax - width : ax,
      y: movesTop ? ay - height : ay,
      width,
      height,
    };
  }

  if (horizontal) {
    // Left or right edge: the opposite edge stays put, the height grows about the middle.
    const ax = movesLeft ? start.x + start.width : start.x;
    const cy = start.y + start.height / 2;
    const roomX = movesLeft ? ax - bounds.x : right - ax;
    const roomY = 2 * Math.min(cy - bounds.y, bottom - cy);
    const wanted = movesLeft ? start.width - dx : start.width + dx;
    const width = clamp(wanted, Math.min(minWidth, roomX), Math.min(roomX, roomY * ratio));
    const height = width / ratio;
    return { x: movesLeft ? ax - width : ax, y: cy - height / 2, width, height };
  }

  // Top or bottom edge.
  const ay = movesTop ? start.y + start.height : start.y;
  const cx = start.x + start.width / 2;
  const roomY = movesTop ? ay - bounds.y : bottom - ay;
  const roomX = 2 * Math.min(cx - bounds.x, right - cx);
  const wanted = (movesTop ? start.height - dy : start.height + dy) * ratio;
  const width = clamp(wanted, Math.min(minWidth, roomY * ratio), Math.min(roomX, roomY * ratio));
  const height = width / ratio;
  return { x: cx - width / 2, y: movesTop ? ay - height : ay, width, height };
}

/** The crop's normalized rect as a box inside `frame`. */
export function rectToBox(rect: Crop['rect'], frame: Box): Box {
  return {
    x: frame.x + rect[0] * frame.width,
    y: frame.y + rect[1] * frame.height,
    width: rect[2] * frame.width,
    height: rect[3] * frame.height,
  };
}

/** A box inside `frame` as the crop's normalized rect. */
export function boxToRect(box: Box, frame: Box): Crop['rect'] {
  const x = clamp((box.x - frame.x) / frame.width, 0, 1);
  const y = clamp((box.y - frame.y) / frame.height, 0, 1);
  return [
    tidy(x),
    tidy(y),
    tidy(clamp(box.width / frame.width, 0, 1 - x)),
    tidy(clamp(box.height / frame.height, 0, 1 - y)),
  ];
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function tidy(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}
