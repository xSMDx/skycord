import { ref } from 'vue'
import type { SearchScope } from './useApi'
import { describeQuery, isEmpty, type SearchQuery } from './searchQuery'

/**
 * The last few searches, per scope, on this device only — a search you ran in
 * one server is no help in another, and none of it is the server's business.
 * Storage can be missing or full; history then simply is not kept.
 */
const KEY = 'sky.searchHistory.v1'
const MAX = 5

export interface HistoryEntry { label: string; query: SearchQuery }

const read = (): Record<string, HistoryEntry[]> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
const write = (all: Record<string, HistoryEntry[]>) => {
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* not kept */ }
}
const keyOf = (s: SearchScope) => `${s.kind}:${s.id}`

/** Bumped on every write, so a computed that reads `entries` re-runs. */
const revision = ref(0)

export const useSearchHistory = () => {
  const entries = (scope: SearchScope): HistoryEntry[] => {
    void revision.value
    return read()[keyOf(scope)] ?? []
  }
  const remember = (scope: SearchScope, query: SearchQuery) => {
    if (isEmpty(query)) return
    const all = read()
    const label = describeQuery(query)
    const kept = (all[keyOf(scope)] ?? []).filter(e => e.label !== label)
    all[keyOf(scope)] = [{ label, query }, ...kept].slice(0, MAX)
    write(all)
    revision.value++
  }
  const clear = (scope: SearchScope) => {
    const all = read()
    delete all[keyOf(scope)]
    write(all)
    revision.value++
  }
  return { entries, remember, clear, revision }
}
