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
})
