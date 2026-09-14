import { describe, it, expect } from 'vitest'
import { filterMembers } from '../memberFilter'

const m = (username: string, displayName?: string) => ({ id: username, username, displayName })
const groups = {
  online:  [m('owner', 'Sky Owner'), m('renée', 'Renée'), m('bob')],
  offline: [m('alice', 'Alice W'), m('zed')],
}
const ids = (g: typeof groups) => [g.online.map(x => x.id), g.offline.map(x => x.id)]

describe('filterMembers', () => {
  it('returns the groups untouched for an empty or blank query', () => {
    expect(filterMembers(groups, '')).toEqual(groups)
    expect(filterMembers(groups, '   ')).toEqual(groups)
  })
  it('matches display name or username, anywhere, ignoring case', () => {
    expect(ids(filterMembers(groups, 'OWN'))).toEqual([['owner'], []])
    expect(ids(filterMembers(groups, 'w'))).toEqual([['owner'], ['alice']])
  })
  it('ignores accents, so "renee" finds Renée', () => {
    expect(ids(filterMembers(groups, 'renee'))).toEqual([['renée'], []])
  })
  it('keeps each group\'s order', () => {
    expect(ids(filterMembers(groups, 'e'))).toEqual([['owner', 'renée'], ['alice', 'zed']])
  })
  it('finds a capital I in a Turkish-locale browser too', () => {
    // A locale-following lowercase turns "I" into dotless "ı" there, so "Ivan"
    // silently stopped matching "ivan". Emulates that browser for this test.
    const original = String.prototype.toLocaleLowerCase
    String.prototype.toLocaleLowerCase = function (this: string) { return original.call(this, 'tr') }
    try {
      const people = { online: [m('Ivan')], offline: [m('İlkay')] }
      expect(ids(filterMembers(people, 'ivan'))).toEqual([['Ivan'], []])
      expect(ids(filterMembers(people, 'ilkay'))).toEqual([[], ['İlkay']])
    } finally {
      String.prototype.toLocaleLowerCase = original
    }
  })
  it('treats ß and ss as the same, either way round', () => {
    const people = { online: [m('k1', 'Weiß'), m('k2', 'Strasser')], offline: [] }
    expect(ids(filterMembers(people, 'weiss'))).toEqual([['k1'], []])
    expect(ids(filterMembers(people, 'straß'))).toEqual([['k2'], []])
  })
})
