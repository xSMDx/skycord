/**
 * Places visited, browser-style: back, forward, and a new place after going
 * back drops the way forward. Used for the app's own places (the desktop title
 * bar) and for the pages inside a modal (modalHistory.ts).
 */
export const createNavHistory = <T>(key: (entry: T) => string, limit = 50) => {
  let entries: T[] = []
  let at = -1
  return {
    push(entry: T) {
      if (at >= 0 && key(entries[at]) === key(entry)) { entries[at] = entry; return }
      entries = entries.slice(0, at + 1)
      entries.push(entry)
      if (entries.length > limit) entries.shift()
      at = entries.length - 1
    },
    /** Swap the place it is on, without adding a step (the first place, on an empty history). */
    replace(entry: T) {
      if (at < 0) { entries = [entry]; at = 0; return }
      entries[at] = entry
    },
    back(): T | null { if (at <= 0) return null; at -= 1; return entries[at] },
    forward(): T | null { if (at >= entries.length - 1) return null; at += 1; return entries[at] },
    /** Where back would go, without going. */
    peekBack(): T | null { return at > 0 ? entries[at - 1] : null },
    get current(): T | null { return at >= 0 ? entries[at] : null },
    get canBack() { return at > 0 },
    get canForward() { return at < entries.length - 1 },
  }
}
export type NavHistory<T> = ReturnType<typeof createNavHistory<T>>
