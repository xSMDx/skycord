/**
 * When animated avatars and banners are allowed to move.
 *
 * A wall of looping GIFs is the fastest way to make a chat unreadable — the
 * eye is drawn to motion, and a member list of twenty animated pictures is
 * twenty things competing with the message you're trying to read. So they hold
 * still, and move only when there's a reason to.
 *
 *   Pointer devices   play while hovered. Hovering IS the reason: you looked
 *                     at it, so it plays, and only that one plays.
 *
 *   Touch devices     no hover exists, so instead they all play a short burst
 *                     together every 37–45 seconds. Long enough not to nag,
 *                     short enough that you learn the picture is animated.
 *
 * The burst is driven by ONE shared timer that every subscriber listens to,
 * not a timer each. Thirty independent timers would fire at thirty different
 * moments and turn the list into a flicker; firing together reads as a single
 * deliberate beat, and costs one interval instead of thirty.
 */
import { ref, onBeforeUnmount } from 'vue'

/** How long a burst runs. Most avatar GIFs loop in about this. */
const BURST_MS = 4000
/**
 * Gap between bursts. The user's range, jittered per cycle rather than fixed:
 * a metronome is more noticeable than an irregular beat, and a fixed period
 * would sync every device that opened the app at the same moment.
 */
const GAP_MIN_MS = 37_000
const GAP_MAX_MS = 45_000
const nextGap = () => GAP_MIN_MS + Math.random() * (GAP_MAX_MS - GAP_MIN_MS)

const reduced = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** True while the shared burst is running. Touch devices read this. */
export const bursting = ref(false)

/** Hover exists — a mouse or trackpad, not a finger. */
export const hasHover = typeof window !== 'undefined'
  && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches

let subscribers = 0
let burstTimer: ReturnType<typeof setTimeout> | null = null
let gapTimer: ReturnType<typeof setTimeout> | null = null

const scheduleBurst = () => {
  gapTimer = setTimeout(() => {
    // A hidden tab has nobody watching; playing there spends battery on an
    // animation no one sees. Skip the beat and wait for the next one.
    if (!document.hidden) {
      bursting.value = true
      burstTimer = setTimeout(() => { bursting.value = false }, BURST_MS)
    }
    scheduleBurst()
  }, nextGap())
}

/**
 * Join the shared beat. Returns a stop function; also auto-stops on unmount
 * when called from a component.
 */
export const useGifBurst = () => {
  // Hover devices never need the timer, and reduced-motion never plays at all.
  if (hasHover || reduced) return { bursting: ref(false) }

  subscribers++
  if (subscribers === 1) scheduleBurst()

  const stop = () => {
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers === 0) {
      if (gapTimer) { clearTimeout(gapTimer); gapTimer = null }
      if (burstTimer) { clearTimeout(burstTimer); burstTimer = null }
      bursting.value = false
    }
  }
  onBeforeUnmount(stop)
  return { bursting }
}

/** Reduced motion means still — a burst is still vestibular motion. */
export const motionAllowed = !reduced

/**
 * A frozen first frame of an animated image, as a data URL.
 *
 * Drawing a GIF to a canvas captures whatever frame is showing, which right
 * after load is the first one — that's the poster. Returns null when the image
 * is cross-origin and taints the canvas (KLIPY GIFs are), in which case the
 * caller must fall back to letting it animate rather than showing nothing.
 */
export const freezeFrame = (src: string): Promise<string | null> =>
  new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth; c.height = img.naturalHeight
        const ctx = c.getContext('2d')
        if (!ctx) { resolve(null); return }
        ctx.drawImage(img, 0, 0)
        resolve(c.toDataURL('image/png'))
      } catch {
        resolve(null)   // tainted canvas — cross-origin without CORS headers
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
