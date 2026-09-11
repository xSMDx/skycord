import { describe, it, expect } from 'vitest'
import {
  tokenAtEnd, withoutTokenAtEnd, dayBounds, addChip, isEmpty, describeQuery, toSearchParams, HAS_TYPES,
  type SearchQuery,
} from '../searchQuery'

const q = (over: Partial<SearchQuery> = {}): SearchQuery => ({ chips: [], text: '', ...over })

describe('the token being typed', () => {
  it('finds a filter key at the end of the text', () => {
    expect(tokenAtEnd('plan from:ad')).toEqual({ key: 'from', partial: 'ad' })
    expect(tokenAtEnd('in:')).toEqual({ key: 'in', partial: '' })
    expect(tokenAtEnd('has:li')).toEqual({ key: 'has', partial: 'li' })
    expect(tokenAtEnd('MENTIONS:bo')).toEqual({ key: 'mentions', partial: 'bo' })
  })
  it('finds nothing mid-word or after a space', () => {
    expect(tokenAtEnd('plan')).toBeNull()
    expect(tokenAtEnd('from:ada ')).toBeNull()
    expect(tokenAtEnd('xfrom:a')).toBeNull()
  })
  it('drops the token once it has become a chip', () => {
    expect(withoutTokenAtEnd('plan from:ad')).toBe('plan')
    expect(withoutTokenAtEnd('in:gen')).toBe('')
  })
})

describe('chips', () => {
  it('does not add the same chip twice', () => {
    const one = addChip(q(), { kind: 'from', value: 'u1', label: 'Ada' })
    expect(addChip(one, { kind: 'from', value: 'u1', label: 'Ada' }).chips).toHaveLength(1)
    expect(addChip(one, { kind: 'from', value: 'u2', label: 'Bob' }).chips).toHaveLength(2)
  })
  it('keeps one of each single-valued kind, the newest', () => {
    const a = addChip(q(), { kind: 'during', value: '2026-09-01', label: 'Sep 1' })
    const b = addChip(a, { kind: 'during', value: '2026-09-02', label: 'Sep 2' })
    expect(b.chips).toEqual([{ kind: 'during', value: '2026-09-02', label: 'Sep 2' }])
  })
  it('knows an empty search', () => {
    expect(isEmpty(q({ text: '  ' }))).toBe(true)
    expect(isEmpty(q({ text: 'x' }))).toBe(false)
  })
  it('describes a search for the history list', () => {
    expect(describeQuery(q({ text: 'plan', chips: [{ kind: 'from', value: 'u1', label: 'Ada' }] }))).toBe('from: Ada plan')
  })
})

describe('dates', () => {
  it('bounds a day at local midnights', () => {
    const { start, end } = dayBounds('2026-09-10')
    expect(start.getFullYear()).toBe(2026)
    expect([start.getMonth(), start.getDate(), start.getHours()]).toEqual([8, 10, 0])
    expect([end.getMonth(), end.getDate(), end.getHours()]).toEqual([8, 11, 0])
  })
})

describe('toSearchParams', () => {
  it('sends words, lists and sort', () => {
    const p = toSearchParams(q({
      text: ' plan ',
      chips: [
        { kind: 'from', value: 'u1', label: 'Ada' }, { kind: 'from', value: 'u2', label: 'Bob' },
        { kind: 'in', value: 'c1', label: 'general' }, { kind: 'has', value: 'image', label: 'image' },
        { kind: 'mentions', value: 'u3', label: 'Cy' }, { kind: 'pinned', value: 'true', label: 'Pinned' },
      ],
    }), 'relevant', 1)
    expect(p.get('q')).toBe('plan')
    expect(p.get('from')).toBe('u1,u2')
    expect(p.get('in')).toBe('c1')
    expect(p.get('has')).toBe('image')
    expect(p.get('mentions')).toBe('u3')
    expect(p.get('pinned')).toBe('true')
    expect(p.get('sort')).toBe('relevant')
    expect(p.has('page')).toBe(false)
  })
  it('turns days into local instants: before its start, after its end, during both', () => {
    const d = dayBounds('2026-09-10')
    expect(toSearchParams(q({ chips: [{ kind: 'before', value: '2026-09-10', label: '' }] }), 'newest', 1).get('before'))
      .toBe(d.start.toISOString())
    expect(toSearchParams(q({ chips: [{ kind: 'after', value: '2026-09-10', label: '' }] }), 'newest', 1).get('after'))
      .toBe(d.end.toISOString())
    const during = toSearchParams(q({ chips: [{ kind: 'during', value: '2026-09-10', label: '' }] }), 'newest', 2)
    expect([during.get('after'), during.get('before'), during.get('page')]).toEqual([d.start.toISOString(), d.end.toISOString(), '2'])
  })
})

describe('has types', () => {
  it('lists the nine, with the ones Skycord lacks marked soon', () => {
    expect(HAS_TYPES.map(h => h.value)).toEqual(['image', 'video', 'link', 'file', 'embed', 'sound', 'poll', 'sticker', 'forward'])
    expect(HAS_TYPES.filter(h => h.soon).map(h => h.value)).toEqual(['file', 'sound', 'poll', 'sticker', 'forward'])
  })
})
