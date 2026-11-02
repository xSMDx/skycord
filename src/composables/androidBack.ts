/**
 * The page's half of the Android back button, in this order:
 *  1. whatever is open on top closes — the same Escape it already obeys, a
 *     box over the search screen included;
 *  2. the search screen closes (it has its own close button, not Escape);
 *  3. a conversation goes back to the list;
 *  4. in a call, the press is used up and the app stays in front: Android
 *     silences the microphone of an app in the background, so going there
 *     would quietly cut the call;
 *  5. otherwise the press is handed back to Android, which steps back through
 *     the server's pages and then puts the app in the background.
 */
export type BackAction = 'close-search' | 'escape' | 'to-list' | 'stay-in-call' | 'none'

export const backAction = (s: {
  searchOpen: boolean
  overlayOpen: boolean
  onConversation: boolean
  inCall: boolean
}): BackAction =>
  s.overlayOpen ? 'escape'
  : s.searchOpen ? 'close-search'
  : s.onConversation ? 'to-list'
  : s.inCall ? 'stay-in-call'
  : 'none'

/**
 * Modals, sheets and popouts are dialogs; context menus are menus; flyouts are
 * AnchoredPanel, which marks itself with data-anchored-panel. (Its class, .ap,
 * is not unique: every message's hover buttons use it too.) The search screen
 * is a dialog too, but it is closed by its own step, so it is left out (it
 * marks itself data-search-screen). Any other transient popup that closes on
 * Escape marks itself data-overlay.
 */
export const OVERLAY_SELECTOR =
  '[role="dialog"]:not([data-search-screen]), [role="menu"], [data-anchored-panel], [data-overlay]'

/** The overlays actually showing, in document order — a mounted, hidden one has no boxes. */
const openOverlays = (doc: Pick<Document, 'querySelectorAll'>): Element[] =>
  Array.from(doc.querySelectorAll(OVERLAY_SELECTOR)).filter(el => el.getClientRects().length > 0)

export const overlayOpen = (doc: Pick<Document, 'querySelectorAll'> = document): boolean =>
  openOverlays(doc).length > 0

/**
 * Escape, sent to the topmost overlay: modals listen on their own element,
 * and the event bubbles on to the document-level listeners the others use.
 * Returns the overlay it was sent to, or null when none was showing (then it
 * goes to the body, where the document-level listeners are).
 */
export const pressEscape = (doc: Pick<Document, 'querySelectorAll' | 'body'> = document): Element | null => {
  const open = openOverlays(doc)
  const top = open[open.length - 1] ?? null
  const target: EventTarget = top ?? doc.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  return top
}

/** Passes at most, and the longest one overlay is waited for on each. */
export const CLOSE_PASSES = 6
export const CLOSE_WAIT_MS = 200
const POLL_MS = 16

/** Resolves once `el` has detached or stopped showing, or after `ms`. */
const untilGone = (el: Element, ms: number): Promise<void> => new Promise(resolve => {
  const t0 = Date.now()
  const check = () => {
    if (!el.isConnected || el.getClientRects().length === 0 || Date.now() - t0 >= ms) resolve()
    else setTimeout(check, POLL_MS)
  }
  // Not at once: what Escape set going — a flag a render has yet to act on —
  // has not reached the page yet.
  setTimeout(check, 0)
})

/**
 * Close every overlay that is open, topmost first.
 *
 * Each pass sends Escape and then WAITS for that overlay to be gone before it
 * looks again. A modal keeps its dialog in the page for its leave transition
 * (about 150 ms), still showing, so looking again at once finds the same dialog
 * on top and sends the Escape to it a second time — while the box under it,
 * which never got one, stays open. The wait is bounded, so an overlay that
 * ignores Escape costs a pass and not the whole run, and so are the passes.
 */
export const closeOverlays = async (
  doc: Pick<Document, 'querySelectorAll' | 'body'> = document,
): Promise<void> => {
  for (let i = 0; i < CLOSE_PASSES && overlayOpen(doc); i++) {
    const top = pressEscape(doc)
    if (top) await untilGone(top, CLOSE_WAIT_MS)
  }
}
