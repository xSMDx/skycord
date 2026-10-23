import { describe, it, expect } from 'vitest'
import { ownEcho } from '../ownEcho'

const ME = 'u-me'
const held = (...dbIds: (string | undefined)[]) => dbIds.map(dbId => ({ dbId }))

describe('ownEcho', () => {
  it('is null for someone else\'s message, held or not', () => {
    expect(ownEcho({ authorId: 'u-them', _id: 'm1' }, ME, held())).toBeNull()
    expect(ownEcho({ authorId: 'u-them', _id: 'm1' }, ME, held('m1'))).toBeNull()
  })

  it('is "seen" for my own message the thread already holds', () => {
    expect(ownEcho({ authorId: ME, _id: 'm1' }, ME, held('m0', 'm1'))).toBe('seen')
  })

  it('is "fresh" for my own message the thread does not hold yet', () => {
    expect(ownEcho({ authorId: ME, _id: 'm2' }, ME, held('m1'))).toBe('fresh')
    expect(ownEcho({ authorId: ME, _id: 'm2' }, ME, held())).toBe('fresh')
  })

  it('does not mistake an unstamped optimistic message for a match', () => {
    // An optimistic copy has no dbId yet; undefined must never equal anything.
    expect(ownEcho({ authorId: ME, _id: 'm1' }, ME, held(undefined))).toBe('fresh')
    expect(ownEcho({ authorId: ME }, ME, held(undefined))).toBe('fresh')
  })

  it('reads the wire id from `id` when there is no `_id`', () => {
    expect(ownEcho({ authorId: ME, id: 'm1' }, ME, held('m1'))).toBe('seen')
  })

  it('is null when it does not know who I am', () => {
    expect(ownEcho({ authorId: ME, _id: 'm1' }, undefined, held())).toBeNull()
    expect(ownEcho({ authorId: undefined, _id: 'm1' }, undefined, held())).toBeNull()
  })
})
