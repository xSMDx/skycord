/**
 * Render-time image framing, shared by the editor and every surface that
 * draws a cropped image.
 *
 * Why this exists at all: a static image is cropped by canvas at upload and
 * stored already-cropped, so nothing downstream needs to know. An animated GIF
 * cannot be — canvas flattens it to one frame — so its framing has to survive
 * as data and be re-applied wherever it's drawn.
 */

export interface Crop {
  /** 1 = fitted (cover). Above 1 magnifies. */
  zoom: number
  /** Offset from centre, as a PERCENTAGE of the container. Percent rather
   *  than pixels so one crop frames the same face at 20px and at 300px. */
  x: number
  y: number
}

export const NO_CROP: Crop = { zoom: 1, x: 0, y: 0 }

export const isIdentityCrop = (c?: Crop | null): boolean =>
  !c || (c.zoom === 1 && c.x === 0 && c.y === 0)

/** True when this source must be framed by CSS instead of baked by canvas. */
export const isAnimated = (src?: string | null): boolean =>
  !!src && (/^data:image\/gif/i.test(src) || /\.gif($|\?|#)/i.test(src)
         || /^data:image\/webp/i.test(src) && /ANMF/.test(src.slice(0, 200)))

/** Clamp to the same bounds the server enforces, so the preview can't show a
 *  framing the server will refuse to store. */
export const clampCrop = (c: Crop): Crop => ({
  zoom: Math.min(5, Math.max(1, c.zoom)),
  x:    Math.min(1000, Math.max(-1000, c.x)),
  y:    Math.min(1000, Math.max(-1000, c.y)),
})

/**
 * Geometry for drawing a cropped image inside a box its PARENT clips.
 *
 * Why not object-fit: cover plus a transform, which is what this used to do:
 * cover crops to the element box FIRST. The painted result is exactly the box,
 * and the overflow is already discarded — so translating it slides a finished
 * image around inside its frame and leaves the background showing. There is no
 * overhang to pan into. Any non-zero offset is a gap, which is exactly the
 * band that kept coming back.
 *
 * So the image is sized to its real cover dimensions, which may be far larger
 * than the box, and positioned. The overhang is then genuinely there, the
 * offset moves within it, and the parent's overflow does the cropping.
 *
 * The offset is a percentage of the BOX, so one stored crop frames the same
 * thing at 20px and at 340px. It is clamped to the overhang that actually
 * exists, so a crop from elsewhere can never expose an edge.
 */
export const cropLayout = (nw: number, nh: number, w: number, h: number, c?: Crop | null) => {
  if (!nw || !nh || !w || !h) return undefined
  const zoom  = c?.zoom ?? 1
  const cover = Math.max(w / nw, h / nh)
  const cw = nw * cover * zoom, ch = nh * cover * zoom
  const maxX = Math.max(0, (cw - w) / 2), maxY = Math.max(0, (ch - h) / 2)
  const dx = Math.min(maxX, Math.max(-maxX, ((c?.x ?? 0) / 100) * w))
  const dy = Math.min(maxY, Math.max(-maxY, ((c?.y ?? 0) / 100) * h))
  return {
    position: 'absolute',
    width:  `${cw}px`, height: `${ch}px`,
    left:   `${(w - cw) / 2 + dx}px`,
    top:    `${(h - ch) / 2 + dy}px`,
    // cw/ch already carry the image's exact aspect, so there is nothing left
    // for object-fit to do — and letting it re-crop would undo the point.
    objectFit: 'fill', maxWidth: 'none', maxHeight: 'none',
  } as Record<string, string>
}

/** The CSS a cropped image needs. Returns undefined for an identity crop so
 *  the common case emits no style at all. */
export const cropStyle = (c?: Crop | null) =>
  isIdentityCrop(c) ? undefined : {
    transform: `translate(${c!.x}%, ${c!.y}%) scale(${c!.zoom})`,
    transformOrigin: 'center center',
  }
