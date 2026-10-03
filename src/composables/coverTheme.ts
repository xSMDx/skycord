/**
 * Take a colour scheme from a piece of cover art.
 *
 * The idea is borrowed from the mybox player, which washes its modal in the
 * artwork's own colours, and it is the one place in this app where colour is
 * not from the token file. That is deliberate and narrow: the wash sits
 * behind a header that changes whenever you open a different record, so it
 * reads as a property of the music rather than as the app changing clothes.
 * Every control on top of it keeps its tokens.
 *
 * Two colours come out, and they do different jobs:
 *
 *  · The **wash** is the most common colour, dragged down to near-black. It
 *    is a background, so it must lose almost all of its lightness or the
 *    text on it stops being readable — which is the failure mode of every
 *    "colour from the image" header that has ever shipped.
 *  · The **accent** is the most *saturated* colour that is not too dark or
 *    too pale, which is usually not the most common one. A record sleeve
 *    that is 80% black and 20% orange should give orange, not black.
 */

import { onAccentText } from './onAccent'

export interface CoverTheme {
  /** Deep, for a header background. */
  wash: string
  /** Vivid, for a highlight on top of the wash. */
  accent: string
  /**
   * What to write ON the accent.
   *
   * Not optional, and not `--text-on-accent`. That token is measured
   * against the app's own accent; this colour came off a record sleeve and
   * could be anything inside the lightness band below. Ink on a mustard
   * sleeve and white on a navy one are both right, and only measuring says
   * which — so it is measured, with the same helper the theme picker uses.
   */
  onAccent: string
}

type Rgb = [number, number, number]

const toHsl = ([r, g, b]: Rgb): [number, number, number] => {
  const R = r / 255, G = g / 255, B = b / 255
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B)
  const l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l * 100]
  const d = mx - mn
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === R ? ((G - B) / d + (G < B ? 6 : 0))
          : mx === G ? ((B - R) / d + 2)
          :            ((R - G) / d + 4)
  return [(h / 6) * 360, s * 100, l * 100]
}

const toRgb = (h: number, s: number, l: number): Rgb => {
  const H = h / 360, S = s / 100, L = l / 100
  if (S === 0) { const v = Math.round(L * 255); return [v, v, v] }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S
  const p = 2 * L - q
  const f = (t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [Math.round(f(H + 1 / 3) * 255), Math.round(f(H) * 255), Math.round(f(H - 1 / 3) * 255)]
}

const css = ([r, g, b]: Rgb): string => `rgb(${r}, ${g}, ${b})`
const hex = ([r, g, b]: Rgb): string =>
  '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')

/** Quantised into 32-wide buckets: exact colours never repeat, buckets do. */
const palette = (data: Uint8ClampedArray): Rgb[] => {
  const seen = new Map<string, { n: number; c: Rgb }>()
  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3] < 128) continue                    // skip transparency
    const c: Rgb = [
      Math.round(data[i] / 32) * 32,
      Math.round(data[i + 1] / 32) * 32,
      Math.round(data[i + 2] / 32) * 32,
    ]
    const k = c.join(',')
    const hit = seen.get(k)
    if (hit) hit.n++
    else seen.set(k, { n: 1, c })
  }
  return [...seen.values()].sort((a, b) => b.n - a.n).map(v => v.c)
}

/**
 * Resolves to null for anything that cannot be read — no cover, a decode
 * failure, a canvas the browser refuses to read back. Every caller falls
 * back to the token palette, so a null here is a quieter header and never
 * a broken one.
 */
export const coverTheme = (src: string | null): Promise<CoverTheme | null> =>
  new Promise((resolve) => {
    if (!src) { resolve(null); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onerror = () => resolve(null)
    img.onload = () => {
      try {
        const size = 48           // plenty: this is colour, not detail
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) { resolve(null); return }
        ctx.drawImage(img, 0, 0, size, size)

        const sorted = palette(ctx.getImageData(0, 0, size, size).data)
        if (!sorted.length) { resolve(null); return }

        const dominant = sorted[0]
        // The first colour with real saturation that is neither nearly black
        // nor nearly white. Falls back to the dominant for a grey sleeve.
        let vivid = dominant
        for (const c of sorted.slice(0, 10)) {
          const [, s, l] = toHsl(c)
          if (s > 30 && l > 20 && l < 80) { vivid = c; break }
        }

        const [vh, vs, vl] = toHsl(vivid)
        const [dh, ds, dl] = toHsl(dominant)
        const accent = toRgb(vh, Math.min(100, vs + 15), Math.max(42, Math.min(62, vl + 8)))
        resolve({
          accent:   css(accent),
          onAccent: onAccentText(hex(accent)),
          wash:     css(toRgb(dh, Math.min(55, ds), Math.max(8, Math.min(18, dl * 0.22)))),
        })
      } catch {
        // A tainted canvas throws on getImageData. Nothing to do but give up.
        resolve(null)
      }
    }
    img.src = src
  })
