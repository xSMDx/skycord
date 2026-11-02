/**
 * Which rows of a list are picked, and where a Shift-click spans from.
 *
 * Pure and immutable: every call returns a new selection and leaves the one it
 * was given alone, so a view can hold it in a ref and a test can hold it in a
 * variable. The ids are whatever the view keys its rows by — the music library
 * uses a track's id, and a playlist (which can hold one song twice) the row's
 * place in the list as well.
 *
 * The anchor is the row last clicked on its own. A Shift-click selects every
 * row between it and the one clicked, in the list's order rather than the
 * order of the clicks, and leaves the anchor where it was, the way every file
 * manager people already know does.
 */
export interface Selection {
  ids: Set<string>
  anchor: string | null
}

export const createSelection = (): Selection => ({ ids: new Set(), anchor: null })

/** In if it was out, out if it was in. Either way it becomes the anchor. */
export const toggle = (sel: Selection, id: string): Selection => {
  const ids = new Set(sel.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  return { ids, anchor: id }
}

/** In, whatever it was: a long press means "this one", never "not this one". */
export const select = (sel: Selection, id: string): Selection =>
  ({ ids: new Set(sel.ids).add(id), anchor: id })

/**
 * Everything from the anchor to `id`, added to what is already picked.
 *
 * With no anchor, or one the list no longer shows, there is nothing to span
 * from, so it picks that row alone and starts from there.
 */
export const range = (sel: Selection, orderedIds: string[], id: string): Selection => {
  const from = sel.anchor === null ? -1 : orderedIds.indexOf(sel.anchor)
  const to = orderedIds.indexOf(id)
  if (from < 0 || to < 0) return select(sel, id)
  const ids = new Set(sel.ids)
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) ids.add(orderedIds[i])
  return { ids, anchor: sel.anchor }
}

/**
 * Only what is still on screen.
 *
 * A new search, or a row that went away, must not leave something picked that
 * the person can no longer see — a bulk delete would otherwise take songs
 * they had stopped looking at. The same selection comes back when nothing was
 * hidden, so a watcher that calls this does not churn.
 */
export const retainVisible = (sel: Selection, visibleIds: Iterable<string>): Selection => {
  const shown = new Set(visibleIds)
  const ids = new Set([...sel.ids].filter(id => shown.has(id)))
  const anchor = sel.anchor !== null && shown.has(sel.anchor) ? sel.anchor : null
  if (ids.size === sel.ids.size && anchor === sel.anchor) return sel
  return { ids, anchor }
}

export const clear = (_sel: Selection): Selection => createSelection()
