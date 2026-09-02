/**
 * Where the pointer last went down, in viewport coordinates.
 *
 * Overlays open FROM the control that summoned them rather than from their own
 * centre, which is the macOS behaviour: the menu grows out of the thing you
 * clicked. The overlay cannot read the originating event itself — it is mounted
 * as a RESULT of that click, so by the time it exists the event is gone. One
 * capture-phase listener keeps the last position for whoever needs it.
 */
const origin = { x: 0, y: 0, at: -Infinity }

let bound = false
const bind = () => {
  if (bound || typeof window === 'undefined') return
  bound = true
  // Capture phase: a handler that calls stopPropagation still counts as the
  // click that opened the thing.
  window.addEventListener('pointerdown', e => {
    origin.x = e.clientX
    origin.y = e.clientY
    origin.at = performance.now()
  }, { capture: true, passive: true })
}

/**
 * How stale a recorded click may be and still be treated as the cause of an
 * overlay opening. Keyboard activation fires no pointerdown at all, so without
 * a cutoff a Space-opened menu would fly out of wherever the mouse last
 * happened to be pressed — possibly minutes ago, on a different screen.
 */
const MAX_AGE_MS = 1000

export interface ClickOrigin { x: number; y: number }

/** The last click, or null when it is too old to have caused this. */
export const lastClickOrigin = (): ClickOrigin | null => {
  bind()
  if (performance.now() - origin.at > MAX_AGE_MS) return null
  return { x: origin.x, y: origin.y }
}

/**
 * `transform-origin` for `el` as a CSS value, so it scales out of the click.
 *
 * Clamped to the element's own box: a click far outside it (a menu that flipped
 * to the other side of the viewport) would otherwise put the origin metres away
 * and swing the element in rather than growing it.
 */
export const originFor = (el: HTMLElement): string => {
  const c = lastClickOrigin()
  if (!c) return ''                    // '' → the stylesheet's own value (centre)
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return ''
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v))
  return `${clamp(c.x - r.left, r.width)}px ${clamp(c.y - r.top, r.height)}px`
}

/** Set it on `el` for the duration of one open. */
export const applyClickOrigin = (el: HTMLElement | null | undefined) => {
  if (!el) return
  const o = originFor(el)
  if (o) el.style.transformOrigin = o
}

export const useClickOrigin = () => { bind(); return { lastClickOrigin, originFor, applyClickOrigin } }
