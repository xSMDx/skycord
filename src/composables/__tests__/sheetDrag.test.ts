import { describe, it, expect } from 'vitest'
import { project, sheetOffset, velocityOf, settlesOpen } from '../sheetDrag'

describe('where a released sheet would coast to', () => {
  it('is nowhere further at rest, and as far either way', () => {
    expect(project(0)).toBe(0)
    expect(project(-800)).toBeCloseTo(-project(800))
  })

  it('carries a quick flick a long way: about half a second of its speed', () => {
    expect(project(1000)).toBeCloseTo(499, 0)
  })
})

describe('where the sheet is drawn under the finger', () => {
  it('follows the finger one for one between open and closed', () => {
    expect(sheetOffset(0, 200)).toBe(0)
    expect(sheetOffset(120, 200)).toBe(120)
    expect(sheetOffset(200, 200)).toBe(200)
  })

  it('resists past the top, without ever stopping dead', () => {
    const a = sheetOffset(-40, 200)
    const b = sheetOffset(-80, 200)
    expect(a).toBeLessThan(0)
    expect(a).toBeGreaterThan(-40)
    expect(b).toBeLessThan(a)
  })

  it('resists past the bottom the same way', () => {
    const a = sheetOffset(240, 200)
    expect(a).toBeGreaterThan(200)
    expect(a).toBeLessThan(240)
  })

  it('does not blow up before the sheet has been measured', () => {
    expect(Number.isFinite(sheetOffset(-30, 0))).toBe(true)
    expect(Number.isFinite(sheetOffset(30, 0))).toBe(true)
  })
})

describe('how fast the finger was going', () => {
  it('is the distance over the time between the first and last samples, per second', () => {
    expect(velocityOf([{ y: 300, t: 0 }, { y: 280, t: 10 }, { y: 250, t: 50 }])).toBe(-1000)
  })

  it('is zero with one sample, and finite with no time between samples', () => {
    expect(velocityOf([{ y: 10, t: 5 }])).toBe(0)
    expect(velocityOf([])).toBe(0)
    expect(Number.isFinite(velocityOf([{ y: 0, t: 5 }, { y: 20, t: 5 }]))).toBe(true)
  })
})

describe('which way a released sheet settles', () => {
  const travel = 240

  it('opens after a slow drag past halfway, and stays shut short of it', () => {
    expect(settlesOpen(100, 0, travel)).toBe(true)
    expect(settlesOpen(150, 0, travel)).toBe(false)
  })

  it('opens on a short, quick flick up from shut', () => {
    // Moved only 30px, but fast enough to have gone the rest of the way.
    expect(settlesOpen(travel - 30, -700, travel)).toBe(true)
  })

  it('shuts on a short, quick flick down from open', () => {
    expect(settlesOpen(30, 700, travel)).toBe(false)
  })

  it('stays where it was on a drag that stalled', () => {
    expect(settlesOpen(20, 0, travel)).toBe(true)
    expect(settlesOpen(travel - 20, 0, travel)).toBe(false)
  })
})
