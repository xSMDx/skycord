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

/** The CSS a cropped image needs. Returns undefined for an identity crop so
 *  the common case emits no style at all. */
export const cropStyle = (c?: Crop | null) =>
  isIdentityCrop(c) ? undefined : {
    transform: `translate(${c!.x}%, ${c!.y}%) scale(${c!.zoom})`,
    transformOrigin: 'center center',
  }
