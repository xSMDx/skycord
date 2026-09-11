/**
 * The two list operations behind reordering the sidebar.
 *
 * Pure, and shared by every way an order changes — dragging a channel,
 * dragging a category header, the category menu's Move Up / Move Down — so a
 * drop and a menu step cannot disagree about where something lands.
 */

/**
 * `ids` with `moved` taken out and put back just before `before`, or at the
 * end when `before` is null or no longer in the list.
 *
 * A marker names the row it sits above rather than an index, because the list
 * can re-sort between the dragover that set it and the drop that reads it; an
 * index would then point at a different row. Last is the honest fallback — it
 * is where a drop with no target lands anyway.
 */
export const placeBefore = (ids: string[], moved: string, before: string | null): string[] => {
  // Dropped just above itself: nowhere new to go.
  if (before === moved) return [...ids]
  const without = ids.filter(id => id !== moved)
  const at = before === null ? -1 : without.indexOf(before)
  const index = at === -1 ? without.length : at
  return [...without.slice(0, index), moved, ...without.slice(index)]
}

/** One step up (-1) or down (1); unchanged at either end or for an unknown id. */
export const nudge = (ids: string[], id: string, dir: -1 | 1): string[] => {
  const i = ids.indexOf(id)
  const j = i + dir
  if (i === -1 || j < 0 || j >= ids.length) return [...ids]
  const next = [...ids]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}
