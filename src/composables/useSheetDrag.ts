/**
 * Drag-to-dismiss for anything presented as a bottom sheet.
 *
 * Extracted so the context menu and every modal share ONE implementation of
 * the physics. Two copies of this drift, and the drift is invisible until one
 * sheet feels wrong and nobody can say why.
 *
 * The behaviour it implements, and why:
 *
 *   1:1 tracking      The sheet is glued to the finger while it's down. Motion
 *                     that lags the finger is the fastest way to make a surface
 *                     feel like software rather than an object.
 *
 *   Rubber-banding    Dragging UP moves the sheet a quarter as far. It's
 *                     already at its resting place; a hard stop reads as
 *                     frozen, progressive resistance reads as "nothing more
 *                     this way".
 *
 *   Velocity + throw  Release is judged on where the gesture was GOING, not
 *                     where it stopped. A short fast flick dismisses; a long
 *                     slow drag that stalls springs back.
 */
import { ref, type Ref } from 'vue'

/** Fraction of the sheet's own height past which release dismisses. A flat
 *  pixel threshold punishes tall sheets and lets short ones go too easily. */
const DISMISS_AT = 0.35
const DECELERATION = 0.998
/** Where a flick would come to rest — Apple's projection, not v²/2a. */
const project = (v: number) => (v / 1000) * DECELERATION / (1 - DECELERATION)
/**
 * Only the last 100ms counts toward velocity.
 *
 * Averaging the whole gesture means a drag that moved and then STOPPED still
 * reads as fast, and the projection multiplier (~499) turns that into a
 * dismiss the user never asked for. A finger resting still has no momentum.
 */
const RECENT_MS = 100
/** Upward resistance. 4 = the sheet follows a quarter of the finger. */
const RUBBER = 4

export interface SheetDrag {
  /** Live offset in px. 0 = at rest. Bind to translateY. */
  offset: Ref<number>
  /** True while a finger is down — disable transitions so the drag IS the position. */
  dragging: Ref<boolean>
  onPointerDown: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: () => void
  /** Snap back to rest without dismissing (used when reopening). */
  reset: () => void
}

/**
 * @param getHeight  the sheet's current height, read at release so a sheet
 *                   that grew or shrank is judged against its real size.
 * @param onDismiss  called when the gesture resolves to "close".
 */
export const useSheetDrag = (getHeight: () => number, onDismiss: () => void): SheetDrag => {
  const offset = ref(0)
  const dragging = ref(false)
  let startY = 0
  let samples: { y: number; t: number }[] = []

  const onPointerDown = (e: PointerEvent) => {
    dragging.value = true
    startY = e.clientY
    samples = [{ y: e.clientY, t: performance.now() }]
    // Capture, so tracking survives the finger leaving the handle's bounds.
    ;(e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging.value) return
    const dy = e.clientY - startY
    offset.value = dy < 0 ? dy / RUBBER : dy
    samples.push({ y: e.clientY, t: performance.now() })
    if (samples.length > 8) samples.shift()
  }

  const onPointerUp = () => {
    if (!dragging.value) return
    dragging.value = false
    const now = performance.now()
    const recent = samples.filter(s => now - s.t <= RECENT_MS)
    const first = recent[0], last = recent[recent.length - 1]
    const dt = first && last ? last.t - first.t : 0
    const v = dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0
    const height = getHeight() || 300
    if (offset.value + project(v) > height * DISMISS_AT) onDismiss()
    else offset.value = 0
  }

  const reset = () => { offset.value = 0; dragging.value = false; samples = [] }

  return { offset, dragging, onPointerDown, onPointerMove, onPointerUp, reset }
}
