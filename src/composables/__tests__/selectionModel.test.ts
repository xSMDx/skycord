import { describe, it, expect } from 'vitest'
import { createSelection, toggle, range, retainVisible, clear, select } from '../selectionModel'

const ids = (s: { ids: Set<string> }): string[] => [...s.ids].sort()

describe('selectionModel', () => {
  it('starts empty, with no anchor', () => {
    const s = createSelection()
    expect(s.ids.size).toBe(0)
    expect(s.anchor).toBeNull()
  })

  it('toggle adds and removes', () => {
    const a = toggle(createSelection(), 'x')
    expect(ids(a)).toEqual(['x'])
    expect(a.anchor).toBe('x')
    const b = toggle(a, 'y')
    expect(ids(b)).toEqual(['x', 'y'])
    const c = toggle(b, 'x')
    expect(ids(c)).toEqual(['y'])
    // The row last touched is where the next Shift-click starts, on or off.
    expect(c.anchor).toBe('x')
  })

  it('never changes the selection it was given', () => {
    const a = toggle(createSelection(), 'x')
    toggle(a, 'y')
    range(a, ['x', 'y', 'z'], 'z')
    retainVisible(a, [])
    clear(a)
    expect(ids(a)).toEqual(['x'])
    expect(a.anchor).toBe('x')
  })

  it('select adds without ever removing', () => {
    const a = select(toggle(createSelection(), 'x'), 'x')
    expect(ids(a)).toEqual(['x'])
    expect(ids(select(a, 'y'))).toEqual(['x', 'y'])
    expect(select(a, 'y').anchor).toBe('y')
  })

  it('range selects between anchor and id in list order', () => {
    const order = ['a', 'b', 'c', 'd', 'e']
    const down = range(toggle(createSelection(), 'b'), order, 'd')
    expect(ids(down)).toEqual(['b', 'c', 'd'])
    // Upwards is the same span: the order is the list's, not the clicks'.
    const up = range(toggle(createSelection(), 'd'), order, 'b')
    expect(ids(up)).toEqual(['b', 'c', 'd'])
    // The anchor stays put, so a second Shift-click re-spans from it.
    expect(down.anchor).toBe('b')
  })

  it('range adds to what was already picked', () => {
    const order = ['a', 'b', 'c', 'd', 'e']
    const s = range(toggle(toggle(createSelection(), 'e'), 'a'), order, 'b')
    expect(ids(s)).toEqual(['a', 'b', 'e'])
  })

  it('range with no anchor, or one no longer listed, picks just that row', () => {
    const order = ['a', 'b', 'c']
    const none = range(createSelection(), order, 'b')
    expect(ids(none)).toEqual(['b'])
    expect(none.anchor).toBe('b')
    const gone = range({ ids: new Set(['z']), anchor: 'z' }, order, 'c')
    expect(ids(gone)).toEqual(['c', 'z'])
    expect(gone.anchor).toBe('c')
  })

  it('retainVisible drops hidden rows', () => {
    const s = toggle(toggle(toggle(createSelection(), 'a'), 'b'), 'c')
    const kept = retainVisible(s, ['b', 'q'])
    expect(ids(kept)).toEqual(['b'])
    // The anchor was c, which is hidden now: a Shift-click must not span to it.
    expect(kept.anchor).toBeNull()
    expect(retainVisible(toggle(createSelection(), 'b'), ['b']).anchor).toBe('b')
  })

  it('retainVisible returns the same selection when nothing was hidden', () => {
    const s = toggle(createSelection(), 'a')
    expect(retainVisible(s, ['a', 'b'])).toBe(s)
  })

  it('clear empties it and forgets the anchor', () => {
    const s = clear(toggle(createSelection(), 'a'))
    expect(s.ids.size).toBe(0)
    expect(s.anchor).toBeNull()
  })
})
