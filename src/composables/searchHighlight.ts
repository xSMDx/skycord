/**
 * Mark the searched words inside a message's rendered HTML.
 *
 * Marks what the search matched: whole words, split and folded the way the
 * server reads them (searchWords.ts), so "10" is marked in "#10" but not in
 * "#110", and "cafe" marks "Café". A phrase is marked as one span.
 *
 * Works on renderMessage's output and only between tags, so a word inside a
 * link's href or an emoji's alt is never touched and no markup can be
 * injected. Each run of text is read with every entity counted as the one
 * character it stands for, and an entity is never split by a mark. A word
 * split by inline markup ("re**lease**") is not marked — the message is still
 * found, only the highlight is missing.
 */
import { WORD_RE, foldWord } from './searchWords'

const OPEN  = '<mark class="sr-hit">'
const CLOSE = '</mark>'
const ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u{A0}' }

/** What an entity stands for. One the renderer never emits reads as a space: it ends a word. */
const decode = (entity: string): string => {
  const body = entity.slice(1, -1).toLowerCase()
  if (body[0] !== '#') return NAMED[body] ?? ' '
  const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
}

interface Unit { src: string; text: string }

/** A run of text as pieces that cannot be split: characters, and whole entities. */
const unitsOf = (run: string): Unit[] => {
  const units: Unit[] = []
  const chars = (s: string) => { for (const ch of s) units.push({ src: ch, text: ch }) }
  let last = 0
  for (const m of run.matchAll(ENTITY)) {
    chars(run.slice(last, m.index))
    units.push({ src: m[0], text: decode(m[0]) })
    last = m.index! + m[0].length
  }
  chars(run.slice(last))
  return units
}

/** The stretches of `text` to mark: every run of words spelling one of the terms, overlaps merged. */
const hitsIn = (text: string, terms: string[][]): [number, number][] => {
  const spans = [...text.matchAll(WORD_RE)].map(m => ({ start: m.index!, end: m.index! + m[0].length, word: foldWord(m[0]) }))
  const hits: [number, number][] = []
  spans.forEach((span, i) => {
    for (const t of terms) {
      if (t.every((w, k) => spans[i + k]?.word === w)) hits.push([span.start, spans[i + t.length - 1].end])
    }
  })
  // A phrase and its own first word start together; the longer one wins the merge.
  hits.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const merged: [number, number][] = []
  for (const [s, e] of hits) {
    const last = merged[merged.length - 1]
    if (last && s < last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  return merged
}

const markRun = (run: string, terms: string[][]): string => {
  const units = unitsOf(run)
  const hits  = hitsIn(units.map(u => u.text).join(''), terms)
  if (!hits.length) return run
  let out = '', at = 0, h = 0, open = false
  for (const u of units) {
    const end = at + u.text.length
    if (!open && h < hits.length && hits[h][0] < end) { out += OPEN; open = true }
    out += u.src
    at = end
    if (open && hits[h][1] <= end) { out += CLOSE; open = false; h++ }
  }
  return open ? out + CLOSE : out
}

/** The words and phrases a query asks for — never the ones it leaves out. */
export const highlightTerms = (q: string): string[] => {
  const out: string[] = []
  for (const m of q.matchAll(/(-?)"([^"]*)"|(-?)(\S+)/g)) {
    if (m[1] || m[3]) continue
    const t = (m[2] ?? m[4] ?? '').replace(/"/g, '').trim()
    if (t) out.push(t)
  }
  return out
}

export const highlightHtml = (html: string, terms: string[]): string => {
  // Each term as its words in order. Not searchWords: that drops the repeats a phrase needs.
  const wanted = terms
    .map(t => [...t.matchAll(WORD_RE)].map(m => foldWord(m[0])).filter(Boolean))
    .filter(t => t.length)
  if (!wanted.length) return html
  // split() with a capture group puts the tags at the odd indexes.
  return html.split(/(<[^>]*>)/).map((part, i) => (i % 2 ? part : markRun(part, wanted))).join('')
}
