import { describe, it, expect } from 'vitest'
import { suggestMembers, suggestChannels, suggestHas, filterRows, SUGGEST_LIMIT } from '../searchSuggest'

const people = [
  { id: 'u1', name: 'Arta', username: 'arta_' },
  { id: 'u2', name: 'Bob', username: 'robert' },
  { id: 'u3', name: 'Gh', username: 'dr.gh' },
]

describe('suggestMembers', () => {
  it('matches a display name or a username, starts-with first, otherwise in order', () => {
    expect(suggestMembers(people, 'r').map(p => p.id)).toEqual(['u2', 'u1', 'u3'])
    expect(suggestMembers(people, 'GH').map(p => p.id)).toEqual(['u3'])
  })
  it('lists everyone for an empty partial, capped', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, username: `m${i}` }))
    expect(suggestMembers(many, '')).toHaveLength(SUGGEST_LIMIT)
  })
  it('leaves out anyone already chosen', () => {
    expect(suggestMembers(people, '', new Set(['u1'])).map(p => p.id)).toEqual(['u2', 'u3'])
  })
})

describe('suggestChannels', () => {
  it('matches by name, starts-with first', () => {
    const ch = [{ id: 'c1', name: 'general-chat' }, { id: 'c2', name: 'music-commands' }, { id: 'c3', name: 'mudae' }]
    expect(suggestChannels(ch, 'mu').map(c => c.id)).toEqual(['c2', 'c3'])
    expect(suggestChannels(ch, 'chat').map(c => c.id)).toEqual(['c1'])
  })
})

describe('suggestHas', () => {
  it('lists the nine types, filtered by what is typed, without the chosen ones', () => {
    expect(suggestHas('')).toHaveLength(9)
    expect(suggestHas('s').map(h => h.value)).toEqual(['sound', 'sticker'])
    expect(suggestHas('', new Set(['image'])).map(h => h.value)).not.toContain('image')
  })
})

describe('filterRows', () => {
  it('offers in: only in a server', () => {
    expect(filterRows('server').map(r => r.key)).toEqual(['from', 'in', 'has', 'mentions', 'more'])
    expect(filterRows('dm').map(r => r.key)).toEqual(['from', 'has', 'mentions', 'more'])
    expect(filterRows('group').map(r => r.key)).toEqual(['from', 'has', 'mentions', 'more'])
  })
  it('uses the reference wording', () => {
    expect(filterRows('server')[1]).toEqual({ key: 'in', title: 'Sent in a specific channel', hint: 'channel' })
    expect(filterRows('dm').slice(-1)[0]).toEqual({ key: 'more', title: 'More filters', hint: 'dates, author type, and more' })
  })
})
