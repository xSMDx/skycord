import { describe, it, expect } from 'vitest'
import { placeBefore, nudge } from '../sidebarOrder'

describe('placeBefore', () => {
  it('moves an item up to sit before the one named', () => {
    expect(placeBefore(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves an item down to sit before the one named', () => {
    expect(placeBefore(['a', 'b', 'c', 'd'], 'a', 'd')).toEqual(['b', 'c', 'a', 'd'])
  })

  it('puts it last when nothing is named', () => {
    expect(placeBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a'])
  })

  it('puts it last when the item named has since gone', () => {
    // The marker is an id, and the list can change between the dragover that
    // set it and the drop that reads it. Last is where a drop with no target
    // lands anyway.
    expect(placeBefore(['a', 'b', 'c'], 'a', 'gone')).toEqual(['b', 'c', 'a'])
  })

  it('leaves the order alone when dropped just before itself', () => {
    expect(placeBefore(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c'])
  })

  it('takes in an item that was not in the list yet', () => {
    // A channel dragged into another category arrives in that bucket.
    expect(placeBefore(['a', 'b'], 'x', 'b')).toEqual(['a', 'x', 'b'])
  })
})

describe('nudge', () => {
  it('moves one step up', () => {
    expect(nudge(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
  })

  it('moves one step down', () => {
    expect(nudge(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  it('stays put at either end', () => {
    expect(nudge(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
    expect(nudge(['a', 'b'], 'b', 1)).toEqual(['a', 'b'])
  })

  it('stays put for an id it does not hold', () => {
    expect(nudge(['a', 'b'], 'zz', 1)).toEqual(['a', 'b'])
  })
})
