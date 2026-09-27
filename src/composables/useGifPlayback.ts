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
 *
 * Below Full, the performance level adds one more reason to hold still: tap.
 * A tap is a deliberate look, same as a hover, so it earns the same one-shot
 * burst — see useTapToPlay. Below Full also means the shared timer above
 * never starts (see useGifBurst): a touch device that will never show a
 * burst has no reason to pay for the wake-up that drives one.
 */
import { computed, ref, onBeforeUnmount, type Ref } from 'vue'
import { perf } from './usePerformance'

/** How long a burst runs. Most avatar GIFs loop in about this. Exported so a
 *  caller keying its own per-item tap state (the GIF picker's grid, one
 *  component serving many cells) reverts on the same beat as everything
 *  else, rather than inventing its own number. */
export const BURST_MS = 4000
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

/** The level's answer, read where a component needs it. */
export const tapOnly = computed(() => perf.animatedMedia === 'tap')

export type PlaybackReason = 'always' | 'hover' | 'burst' | 'tap' | 'never'

/**
 * Why an animated image would play, in one place, so the components only ask
 * "which reason applies to me?".
 *
 * Reduced motion outranks everything: a person who asked for stillness does not
 * get motion back because a performance level allows it. The level can only
 * take motion away, never add it.
 */
export const playbackPolicy = (o: {
  animated: boolean; alwaysAnimate: boolean; reduced: boolean; tapOnly: boolean; hasHover: boolean
}): PlaybackReason => {
  if (!o.animated || o.alwaysAnimate) return 'always'
  if (o.reduced) return 'never'
  if (o.tapOnly) return 'tap'
  return o.hasHover ? 'hover' : 'burst'
}

/** One image's "somebody tapped it": plays a single burst, then holds still again. */
export const useTapToPlay = (): { played: Ref<boolean>; play: () => void } => {
  const played = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  const play = () => {
    played.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { played.value = false }, BURST_MS)
  }
  onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
  return { played, play }
}

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
  // Hover devices never need the timer, reduced-motion never plays at all, and
  // tap-only levels never show an unprompted burst — so the wake-up that would
  // drive one is exactly the background cost this feature exists to remove.
  if (hasHover || reduced || tapOnly.value) return { bursting: ref(false) }

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
