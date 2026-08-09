/**
 * useEdgeSwipe — left-edge drag to go back from a conversation to the list.
 *
 * Doubles as the Discord reflex: same motion, so both a Discord user's habit
 * and the platform back-swipe land on the same gesture.
 *
 * Built on the fluid-interface rules rather than a CSS transition:
 *   · tracks the finger 1:1 the whole way, not only on release
 *   · projects release velocity to decide the destination, so a short flick
 *     commits and a long slow drag that stalls snaps back
 *   · interruptible — grabbing a settling pane picks it up from where it is
 *
 * A CSS transition cannot do the last one: it can't be caught mid-flight and
 * redirected, which is exactly what makes a gesture feel alive.
 */
import { onBeforeUnmount } from 'vue'

/** Distance from the left edge that starts the gesture. Matches iOS. */
const EDGE_ZONE = 24
/** Movement before we commit to a direction, so a tap or a vertical scroll
 *  isn't mistaken for a swipe. */
const THRESHOLD = 10
/** Apple's projection constant — the same exponential decay scroll uses. */
const DECELERATION = 0.998

/** Where a flick would come to rest, given its release velocity (px/s). */
const project = (velocity: number) =>
  (velocity / 1000) * DECELERATION / (1 - DECELERATION)

interface EdgeSwipeOptions {
  /** Width the pane travels across — normally the viewport width. */
  width: () => number
  /** 0 = list, 1 = conversation. Called continuously during the drag. */
  onProgress: (p: number) => void
  /** Fired once on release with the chosen destination. */
  onSettle: (toConversation: boolean) => void
  onDragStart?: () => void
  /** Gate — the gesture is inert when this returns false. */
  enabled: () => boolean
}

export const useEdgeSwipe = (opts: EdgeSwipeOptions) => {
  let tracking = false
  let decided  = false
  let startX = 0, startY = 0
  // Short history, not just the last point: a single delta between two frames
  // is noisy, and one stalled frame at release would read as zero velocity.
  let samples: { x: number; t: number }[] = []

  const reset = () => { tracking = false; decided = false; samples = [] }

  const onPointerDown = (e: PointerEvent) => {
    if (!opts.enabled() || e.pointerType === 'mouse') return
    if (e.clientX > EDGE_ZONE) return
    tracking = true
    decided  = false
    startX = e.clientX
    startY = e.clientY
    samples = [{ x: e.clientX, t: performance.now() }]
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!tracking) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY

    if (!decided) {
      if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return
      // Vertical intent wins — that's a scroll, and stealing it would make the
      // message list feel broken near the left edge.
      if (Math.abs(dy) > Math.abs(dx)) { reset(); return }
      decided = true
      opts.onDragStart?.()
    }

    samples.push({ x: e.clientX, t: performance.now() })
    if (samples.length > 5) samples.shift()

    const w = opts.width() || 1
    // Dragging right (positive dx) moves toward the list, so progress falls.
    opts.onProgress(1 - Math.min(1, Math.max(0, dx / w)))
    e.preventDefault()
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!tracking) { reset(); return }
    if (!decided)  { reset(); return }

    const w  = opts.width() || 1
    const dx = e.clientX - startX

    // Velocity over the sampled window rather than the last frame alone.
    const first = samples[0]
    const last  = samples[samples.length - 1]
    const dt    = Math.max(1, last.t - first.t)
    const velocity = ((last.x - first.x) / dt) * 1000   // px/s

    // Decide from where the flick is HEADED, not where the finger stopped.
    const projected = dx + project(velocity)
    opts.onSettle(projected < w / 2)
    reset()
  }

  const bind = (el: HTMLElement) => {
    el.addEventListener('pointerdown', onPointerDown, { passive: true })
    el.addEventListener('pointermove', onPointerMove, { passive: false })
    el.addEventListener('pointerup', onPointerUp, { passive: true })
    el.addEventListener('pointercancel', reset, { passive: true })
  }

  const unbind = (el: HTMLElement) => {
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('pointercancel', reset)
  }

  onBeforeUnmount(reset)

  return { bind, unbind }
}
