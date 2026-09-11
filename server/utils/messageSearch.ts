import { Types } from 'mongoose'
import { Message } from '../models/Message'
import { SEARCH_HAS, type SearchHas } from './searchFields'
import { searchWords } from './searchWords'

export const SEARCH_PAGE      = 25
export const SEARCH_TOTAL_CAP = 1000
const MAX_PAGE = 40

export interface SearchParams {
  /** The `$text` string, '' when the search has no words. */
  terms:    string
  /** Words a match must contain whole, folded as `searchWords` folds them. */
  words:    string[]
  /** Words a match must not contain. */
  notWords: string[]
  from:     Types.ObjectId[]
  mentions: Types.ObjectId[]
  /** Channel ids; the controller intersects them with what the searcher may read. */
  in:       string[]
  has:      SearchHas[]
  pinned:   boolean | null
  after:    Date | null
  before:   Date | null
  sort:     'newest' | 'relevant'
  page:     number
}

const isId = (s: string) => /^[a-f0-9]{24}$/i.test(s)
const list = (raw: unknown): string[] =>
  String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean)

/**
 * `q` read as words to find, phrases, and words to leave out.
 *
 * `$text` finds candidates and ranks them, but it cannot require a word
 * whole: it ORs bare words, and it matches a quoted phrase as a substring —
 * with every word quoted, "seed 10" found "#110". So `$text` gets the words
 * bare, letting any of them find a candidate, and each phrase of two or more
 * words quoted, keeping its words in order. What makes it a whole-word search
 * is applied to each message's stored `words` instead (see searchFilter):
 * every word present, every excluded word absent. An excluded phrase excludes
 * each of its words. `$text` cannot answer an exclusion on its own, so the
 * caller refuses a search with no word to find and no filter.
 */
export const toTextSearch = (q: string): { terms: string; words: string[]; notWords: string[] } => {
  const terms: string[] = []
  const words = new Set<string>(), notWords = new Set<string>()
  for (const m of q.matchAll(/(-?)"([^"]*)"|(-?)(\S+)/g)) {
    const negative = !!(m[1] || m[3])
    const body = (m[2] ?? m[4] ?? '').replace(/"/g, '').trim()
    const found = searchWords(body)
    if (!found.length) continue
    if (negative) { for (const w of found) notWords.add(w); continue }
    for (const w of found) words.add(w)
    terms.push(m[2] !== undefined && found.length > 1 ? `"${body}"` : body)
  }
  return { terms: terms.join(' '), words: [...words], notWords: [...notWords] }
}

const date = (raw: unknown): Date | null | 'bad' => {
  if (raw == null || raw === '') return null
  const d = new Date(String(raw))
  return Number.isNaN(d.getTime()) ? 'bad' : d
}

export type ParsedSearch = { ok: true; params: SearchParams } | { ok: false; message: string }

export const parseSearch = (q: Record<string, unknown>): ParsedSearch => {
  const text = String(q.q ?? '').slice(0, 500)
  const { terms, words, notWords } = toTextSearch(text)
  const after = date(q.after), before = date(q.before)
  if (after === 'bad' || before === 'bad') return { ok: false, message: 'Dates must be ISO instants' }
  const params: SearchParams = {
    terms, words, notWords,
    from:     list(q.from).filter(isId).map(id => new Types.ObjectId(id)),
    mentions: list(q.mentions).filter(isId).map(id => new Types.ObjectId(id)),
    in:       list(q.in).filter(isId),
    has:      list(q.has).filter((h): h is SearchHas => (SEARCH_HAS as readonly string[]).includes(h)),
    pinned:   q.pinned === 'true' ? true : q.pinned === 'false' ? false : null,
    after, before,
    sort:     q.sort === 'relevant' ? 'relevant' : 'newest',
    page:     Math.min(Math.max(Math.floor(Number(q.page)) || 1, 1), MAX_PAGE),
  }
  const filtered = params.from.length || params.mentions.length || params.in.length || params.has.length
    || params.pinned !== null || params.after || params.before
  if (!words.length && !filtered) {
    return { ok: false, message: notWords.length
      ? 'Add a word to look for, not only ones to leave out'
      : 'Type something to search for, or pick a filter' }
  }
  return { ok: true, params }
}

/** The Mongo filter for a search over these conversations. */
export const searchFilter = (conversationIds: string[], p: SearchParams): Record<string, unknown> => {
  const f: Record<string, unknown> = { conversationId: { $in: conversationIds }, kind: { $ne: 'system' } }
  if (p.terms) f.$text = { $search: p.terms, $caseSensitive: false, $diacriticSensitive: false }
  // `$text` offers the candidates; the stored words decide them, whole.
  if (p.words.length || p.notWords.length) {
    f.words = {
      ...(p.words.length    ? { $all: p.words }    : {}),
      ...(p.notWords.length ? { $nin: p.notWords } : {}),
    }
  }
  if (p.from.length)     f.authorId = { $in: p.from }
  if (p.mentions.length) f.mentions = { $in: p.mentions }
  if (p.has.length)      f.has = { $in: p.has }
  if (p.pinned !== null) f.pinned = p.pinned
  if (p.after || p.before) {
    f.createdAt = { ...(p.after ? { $gte: p.after } : {}), ...(p.before ? { $lt: p.before } : {}) }
  }
  return f
}

/** One page of matches, the capped total, and whether another page exists. */
export const runSearch = async (filter: Record<string, unknown>, p: SearchParams) => {
  const relevant = p.sort === 'relevant' && !!p.terms
  const sort = relevant
    ? { score: { $meta: 'textScore' }, createdAt: -1, _id: -1 }
    : { createdAt: -1, _id: -1 }
  const [rows, total] = await Promise.all([
    Message.find(filter, relevant ? { score: { $meta: 'textScore' } } : {})
      .sort(sort as never)
      .skip((p.page - 1) * SEARCH_PAGE)
      .limit(SEARCH_PAGE + 1)
      .lean(),
    Message.countDocuments(filter, { limit: SEARCH_TOTAL_CAP }),
  ])
  return { rows: rows.slice(0, SEARCH_PAGE) as any[], hasMore: rows.length > SEARCH_PAGE, total }
}
