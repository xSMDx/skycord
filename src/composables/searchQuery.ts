/**
 * A search as the field holds it — chips for filters, free text for words —
 * and the one place it is turned into the API's query string.
 */

export type ChipKind = 'from' | 'in' | 'mentions' | 'has' | 'before' | 'after' | 'during' | 'pinned'
export interface SearchChip { kind: ChipKind; value: string; label: string }
export interface SearchQuery { chips: SearchChip[]; text: string }
export type SearchSort = 'newest' | 'relevant'

export interface HasType { value: string; label: string; soon?: boolean }
/** The nine the reference shows. Five are features Skycord does not have yet. */
export const HAS_TYPES: readonly HasType[] = [
  { value: 'image',   label: 'image' },
  { value: 'video',   label: 'video' },
  { value: 'link',    label: 'link' },
  { value: 'file',    label: 'file',    soon: true },
  { value: 'embed',   label: 'embed' },
  { value: 'sound',   label: 'sound',   soon: true },
  { value: 'poll',    label: 'poll',    soon: true },
  { value: 'sticker', label: 'sticker', soon: true },
  { value: 'forward', label: 'forward', soon: true },
]

export type FilterKey = 'from' | 'in' | 'has' | 'mentions'
const TOKEN_RE = /(?:^|\s)(from|in|has|mentions):(\S*)$/i

/** A `key:` being typed at the end of the text — what the popup suggests for. */
export const tokenAtEnd = (text: string): { key: FilterKey; partial: string } | null => {
  const m = TOKEN_RE.exec(text)
  return m ? { key: m[1].toLowerCase() as FilterKey, partial: m[2] } : null
}

/** The text without its trailing `key:partial`, once that has become a chip. */
export const withoutTokenAtEnd = (text: string) => text.replace(TOKEN_RE, '').trimEnd()

/** Kinds a search can hold only one of: a second replaces the first. */
const SINGLE: ReadonlySet<ChipKind> = new Set(['before', 'after', 'during', 'pinned'])

export const addChip = (q: SearchQuery, chip: SearchChip): SearchQuery => {
  if (q.chips.some(c => c.kind === chip.kind && c.value === chip.value)) return q
  const kept = SINGLE.has(chip.kind) ? q.chips.filter(c => c.kind !== chip.kind) : q.chips
  return { ...q, chips: [...kept, chip] }
}

export const isEmpty = (q: SearchQuery) => !q.text.trim() && !q.chips.length

/** A one-line label for the history list. */
export const describeQuery = (q: SearchQuery) =>
  [...q.chips.map(c => `${c.kind}: ${c.label}`), q.text.trim()].filter(Boolean).join(' ')

/** Local-midnight bounds of a `YYYY-MM-DD` day. */
export const dayBounds = (day: string): { start: Date; end: Date } => {
  const [y, m, d] = day.split('-').map(Number)
  return { start: new Date(y, m - 1, d), end: new Date(y, m - 1, d + 1) }
}

/**
 * The API query string. Days become instants in the viewer's own time zone:
 * "before Sep 10" means before that day began here, "after" means after it
 * ended, "during" means within it. The server treats `after` as inclusive and
 * `before` as exclusive, so the bounds line up exactly.
 */
export const toSearchParams = (q: SearchQuery, sort: SearchSort, page: number): URLSearchParams => {
  const p = new URLSearchParams()
  const text = q.text.trim()
  if (text) p.set('q', text)
  const values = (k: ChipKind) => q.chips.filter(c => c.kind === k).map(c => c.value)
  for (const k of ['from', 'in', 'mentions', 'has'] as const) {
    const v = values(k)
    if (v.length) p.set(k, v.join(','))
  }
  const pinned = values('pinned')[0]
  if (pinned) p.set('pinned', pinned)

  let after: Date | null = null
  let before: Date | null = null
  for (const c of q.chips) {
    if (c.kind === 'before') before = dayBounds(c.value).start
    if (c.kind === 'after')  after  = dayBounds(c.value).end
    if (c.kind === 'during') ({ start: after, end: before } = dayBounds(c.value))
  }
  if (after)  p.set('after', after.toISOString())
  if (before) p.set('before', before.toISOString())
  p.set('sort', sort)
  if (page > 1) p.set('page', String(page))
  return p
}
