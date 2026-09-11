/**
 * What the search popup offers while a filter is being typed, and the Filters
 * list itself. Pure, so the ordering rules are tested rather than eyeballed.
 */
import { HAS_TYPES, type HasType } from './searchQuery'

export interface SuggestMember {
  id: string
  name: string
  /** Empty when the app does not know it (a DM partner is known by name only). */
  username: string
  avatar?: string | null
  crop?: { zoom: number; x: number; y: number } | null
}
export interface SuggestChannel { id: string; name: string }
export const SUGGEST_LIMIT = 10

/** One choice in a More filters picker. */
export interface PickerOption {
  value: string
  label: string
  sub?: string
  avatar?: string
  crop?: SuggestMember['crop']
  soon?: boolean
}

const lc = (s: string) => s.toLowerCase()

/** Anything containing what was typed; names that START with it first, otherwise in the given order. */
const rank = <T>(items: T[], partial: string, keys: (t: T) => string[]): T[] => {
  const p = lc(partial)
  const hits = p ? items.filter(t => keys(t).some(k => lc(k).includes(p))) : items
  const starts = (t: T) => keys(t).some(k => lc(k).startsWith(p))
  return [...hits].sort((a, b) => Number(!starts(a)) - Number(!starts(b))).slice(0, SUGGEST_LIMIT)
}

export const suggestMembers = (members: SuggestMember[], partial: string, exclude: Set<string> = new Set()) =>
  rank(members.filter(m => !exclude.has(m.id)), partial, m => [m.name, m.username])

export const suggestChannels = (channels: SuggestChannel[], partial: string, exclude: Set<string> = new Set()) =>
  rank(channels.filter(c => !exclude.has(c.id)), partial, c => [c.name])

export const suggestHas = (partial: string, exclude: Set<string> = new Set()): HasType[] =>
  HAS_TYPES.filter(h => !exclude.has(h.value) && h.value.startsWith(lc(partial)))

/**
 * One row of the Filters list. `hint` is the placeholder word shown after
 * `key:` ("from: user"); for More filters, which has no key, it is the line
 * under the title.
 */
export interface FilterRow { key: 'from' | 'in' | 'has' | 'mentions' | 'more'; title: string; hint: string }

/** The Filters list, in the reference's order and words. `in:` needs channels. */
export const filterRows = (kind: 'server' | 'group' | 'dm'): FilterRow[] => [
  { key: 'from', title: 'From a specific user', hint: 'user' },
  ...(kind === 'server' ? [{ key: 'in' as const, title: 'Sent in a specific channel', hint: 'channel' }] : []),
  { key: 'has', title: 'Includes a specific type of data', hint: 'link, embed or file' },
  { key: 'mentions', title: 'Mentions a specific user', hint: 'user' },
  { key: 'more', title: 'More filters', hint: 'dates, author type, and more' },
]
