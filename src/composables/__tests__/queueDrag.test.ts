import { describe, it, expect } from 'vitest'
import {
  dropIndex, shiftFor, pitchOf, heldOffset, restOffset, autoScrollSpeed,
  keyTarget, movedSaid, stableKeys, toMs, EDGE_SPEED, type Slot,
} from '../queueDrag'

/**
 * The arithmetic behind dragging a song up or down the queue drawer.
 *
 * The drag itself cannot run here (vitest runs in node, with no layout), so
 * everything it decides is a pure function of measured rows and a pointer
 * position, and is tested as that.
 */

// Five rows, 50px tall with a 2px gap: tops 0, 52, 104, 156, 208.
const rows: Slot[] = [0, 1, 2, 3, 4].map(i => ({ top: i * 52, height: 50 }))
const centres = rows.map(r => r.top + r.height / 2) // 25, 77, 129, 181, 233

describe('which slot a held row is over', () => {
  it('stays put until its centre passes a neighbour’s centre', () => {
    expect(dropIndex(centres, 1, 77)).toBe(1)
    expect(dropIndex(centres, 1, 128)).toBe(1)
    expect(dropIndex(centres, 1, 130)).toBe(2)
    expect(dropIndex(centres, 1, 182)).toBe(3)
    expect(dropIndex(centres, 1, 26)).toBe(1)
    expect(dropIndex(centres, 1, 24)).toBe(0)
  })

  it('lands first or last however far past the ends it is taken', () => {
    expect(dropIndex(centres, 2, -1000)).toBe(0)
    expect(dropIndex(centres, 2, 1000)).toBe(4)
  })

  it('has nowhere else to go in a queue of one', () => {
    expect(dropIndex([25], 0, -500)).toBe(0)
    expect(dropIndex([25], 0, 500)).toBe(0)
  })
})

describe('how the other rows step aside', () => {
  const all = (from: number, to: number) => [0, 1, 2, 3, 4].map(i => shiftFor(i, from, to, 52))

  it('moving down, the rows it passes step up one place', () => {
    expect(all(1, 3)).toEqual([0, 0, -52, -52, 0])
  })

  it('moving up, the rows it passes step down one place', () => {
    expect(all(3, 1)).toEqual([0, 52, 52, 0, 0])
  })

  it('back where it started, nothing has moved', () => {
    expect(all(2, 2)).toEqual([0, 0, 0, 0, 0])
  })

  it('steps by the held row and the gap after it', () => {
    expect(pitchOf(rows, 2)).toBe(52)
    expect(pitchOf([{ top: 0, height: 50 }, { top: 52, height: 70 }], 1)).toBe(72)
    expect(pitchOf([{ top: 0, height: 50 }], 0)).toBe(50)
  })
})

describe('where the held row is drawn', () => {
  it('follows the finger one for one anywhere inside the list', () => {
    expect(heldOffset(0, rows, 2)).toBe(0)
    expect(heldOffset(31, rows, 2)).toBe(31)
    expect(heldOffset(-104, rows, 2)).toBe(-104) // level with the first row
    expect(heldOffset(104, rows, 2)).toBe(104) // level with the last
  })

  it('resists past either end, more the further it goes, and never stops dead', () => {
    const a = heldOffset(-150, rows, 2)
    const b = heldOffset(-200, rows, 2)
    expect(a).toBeLessThan(-104)
    expect(a).toBeGreaterThan(-150)
    expect(b).toBeLessThan(a)
    expect((-104 - b) - (-104 - a)).toBeLessThan(-104 - a)

    const c = heldOffset(150, rows, 2)
    expect(c).toBeGreaterThan(104)
    expect(c).toBeLessThan(150)
  })

  it('goes at most a row past the end, however far the finger does', () => {
    expect(heldOffset(-1e6, rows, 2)).toBeGreaterThan(-104 - 50)
    expect(heldOffset(1e6, rows, 2)).toBeLessThan(104 + 50)
  })
})

describe('where it comes to rest', () => {
  it('in the slot it was let go over', () => {
    expect(restOffset(rows, 1, 3)).toBe(104)
    expect(restOffset(rows, 3, 0)).toBe(-156)
    expect(restOffset(rows, 2, 2)).toBe(0)
  })

  it('in the right place when the rows are not all one height', () => {
    // A 50px row dropped below a 70px one and a 50px one: once the queue is
    // reordered they sit at 0 and 72, so it lands at 124.
    const uneven: Slot[] = [{ top: 0, height: 50 }, { top: 52, height: 70 }, { top: 124, height: 50 }]
    expect(restOffset(uneven, 0, 2)).toBe(124)
    expect(restOffset(uneven, 2, 0)).toBe(-124)
  })
})

describe('the list scrolling itself while a song is held', () => {
  const view = { top: 100, bottom: 500 }
  const longer = { top: 0, bottom: 900 } // runs past both edges of the drawer

  it('stays still while the finger is away from the edges', () => {
    expect(autoScrollSpeed(300, view, longer)).toBe(0)
  })

  it('scrolls up near the top and down near the bottom, faster the closer it gets', () => {
    const near = autoScrollSpeed(140, view, longer)
    const nearer = autoScrollSpeed(110, view, longer)
    expect(near).toBeLessThan(0)
    expect(nearer).toBeLessThan(near)
    expect(autoScrollSpeed(470, view, longer)).toBeGreaterThan(0)
  })

  it('goes at full speed at the edge and past it', () => {
    expect(autoScrollSpeed(100, view, longer)).toBe(-EDGE_SPEED)
    expect(autoScrollSpeed(-50, view, longer)).toBe(-EDGE_SPEED)
    expect(autoScrollSpeed(500, view, longer)).toBe(EDGE_SPEED)
    expect(autoScrollSpeed(800, view, longer)).toBe(EDGE_SPEED)
  })

  it('does not scroll toward an end of the list that is already in view', () => {
    const shown = { top: 150, bottom: 400 }
    expect(autoScrollSpeed(105, view, shown)).toBe(0)
    expect(autoScrollSpeed(495, view, shown)).toBe(0)
  })

  it('leaves the middle of a short drawer still', () => {
    expect(autoScrollSpeed(45, { top: 0, bottom: 90 }, longer)).toBe(0)
  })
})

describe('the arrow keys on a handle', () => {
  it('move the song one place up or down', () => {
    expect(keyTarget('ArrowUp', 2, 5)).toBe(1)
    expect(keyTarget('ArrowDown', 2, 5)).toBe(3)
  })

  it('stay put at either end rather than wrapping round', () => {
    expect(keyTarget('ArrowUp', 0, 5)).toBe(0)
    expect(keyTarget('ArrowDown', 4, 5)).toBe(4)
  })

  it('leave every other key alone', () => {
    expect(keyTarget('Enter', 2, 5)).toBeNull()
    expect(keyTarget(' ', 2, 5)).toBeNull()
    expect(keyTarget('ArrowLeft', 2, 5)).toBeNull()
  })
})

describe('what a screen reader hears', () => {
  it('names the new place, counted from one', () => {
    expect(movedSaid(2, 8)).toBe('Moved to position 3 of 8')
  })
})

describe('row keys for a queue that can hold one song twice', () => {
  it('are unique, and name the song and which copy it is', () => {
    expect(stableKeys(['a', 'b', 'a', 'a'])).toEqual(['a#0', 'b#0', 'a#1', 'a#2'])
  })

  it('travel with the song when it moves, so its row is moved rather than refilled', () => {
    expect(stableKeys(['a', 'b', 'c'])).toEqual(['a#0', 'b#0', 'c#0'])
    expect(stableKeys(['c', 'a', 'b'])).toEqual(['c#0', 'a#0', 'b#0'])
  })
})

describe('reading a motion token', () => {
  it('turns milliseconds and seconds into milliseconds', () => {
    expect(toMs('180ms')).toBe(180)
    expect(toMs(' .2s ')).toBe(200)
    expect(toMs('1ms')).toBe(1)
  })

  it('reads nothing it cannot parse as no wait at all', () => {
    expect(toMs('')).toBe(0)
    expect(toMs('soon')).toBe(0)
  })
})
