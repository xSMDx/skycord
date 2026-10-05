/**
 * The page's half of the Android back button, in this order:
 *  1. the search screen closes (it has its own close button, not Escape);
 *  2. whatever is open on top closes — the same Escape it already obeys;
 *  3. a conversation goes back to the list;
 *  4. otherwise the press is handed back to Android, which puts the app in
 *     the background.
 */
export type BackAction = 'close-search' | 'escape' | 'to-list' | 'none'

export const backAction = (s: { searchOpen: boolean; overlayOpen: boolean; onConversation: boolean }): BackAction =>
  s.searchOpen ? 'close-search' : s.overlayOpen ? 'escape' : s.onConversation ? 'to-list' : 'none'

/**
 * Modals, sheets and popouts are dialogs; context menus are menus; flyouts are
 * AnchoredPanel, which marks itself with data-anchored-panel. (Its class, .ap,
 * is not unique: every message's hover buttons use it too.)
 */
export const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"], [data-anchored-panel]'

/** The overlays actually showing, in document order — a mounted, hidden one has no boxes. */
const openOverlays = (doc: Pick<Document, 'querySelectorAll'>): Element[] =>
  Array.from(doc.querySelectorAll(OVERLAY_SELECTOR)).filter(el => el.getClientRects().length > 0)

export const overlayOpen = (doc: Pick<Document, 'querySelectorAll'> = document): boolean =>
  openOverlays(doc).length > 0

/**
 * Escape, sent to the topmost overlay: modals listen on their own element,
 * and the event bubbles on to the document-level listeners the others use.
 */
export const pressEscape = (doc: Pick<Document, 'querySelectorAll' | 'body'> = document): void => {
  const open = openOverlays(doc)
  const target: EventTarget = open[open.length - 1] ?? doc.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}
