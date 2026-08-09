/**
 * Long-press → context menu, for touch.
 *
 * Right-click doesn't exist on a phone, which means every context menu in the
 * app — conversation, user, message, call tile — is unreachable there. That's
 * not cosmetic: pin, mute, close, remove friend and profile have no other
 * entry point on some surfaces.
 *
 * Rather than adding a directive to all 27 @contextmenu bindings, this installs
 * ONE document-level listener that synthesises a real `contextmenu` MouseEvent
 * at the touch point. Every existing handler then fires unchanged, and any menu
 * added later is covered for free. The menu registry already positions from
 * clientX/clientY, so nothing downstream needs to know a finger caused it.
 */

/** Long enough not to fire on a tap, short enough not to feel broken. */
const HOLD_MS = 500
/** Movement that reclassifies the gesture as a scroll or a drag. */
const MOVE_TOLERANCE = 10

let timer: ReturnType<typeof setTimeout> | null = null
let startX = 0, startY = 0
let target: EventTarget | null = null
let fired = false

const cancel = () => {
  if (timer) { clearTimeout(timer); timer = null }
  target = null
}

const fire = () => {
  timer = null
  if (!target) return
  fired = true

  // Confirms the press registered before the menu paints. Reserved for commit
  // moments like this rather than sprinkled around — feedback everywhere trains
  // people to ignore it.
  navigator.vibrate?.(10)

  ;(target as HTMLElement).dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: startX, clientY: startY,
  }))
  target = null
}

export const installLongPress = () => {
  if (typeof document === 'undefined') return

  document.addEventListener('pointerdown', e => {
    // Mouse already has right-click; adding hold-to-open there would make
    // click-and-think open menus by accident.
    if (e.pointerType === 'mouse') return
    fired = false
    startX = e.clientX
    startY = e.clientY
    target = e.target
    timer = setTimeout(fire, HOLD_MS)
  }, { passive: true, capture: true })

  document.addEventListener('pointermove', e => {
    if (!timer) return
    if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE ||
        Math.abs(e.clientY - startY) > MOVE_TOLERANCE) cancel()
  }, { passive: true, capture: true })

  document.addEventListener('pointerup', cancel, { passive: true, capture: true })
  document.addEventListener('pointercancel', cancel, { passive: true, capture: true })
  // A scroll that starts under the finger must not leave a menu queued.
  document.addEventListener('scroll', cancel, { passive: true, capture: true })

  /*
   * Swallow the click that follows the press.
   *
   * Without this, long-pressing a conversation row opens the menu AND the
   * conversation underneath it — the pointerup still produces a click, and the
   * row's @click has no idea a long press just happened.
   */
  document.addEventListener('click', e => {
    if (!fired) return
    fired = false
    e.preventDefault()
    e.stopPropagation()
  }, { capture: true })
}
