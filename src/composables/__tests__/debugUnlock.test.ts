import { describe, it, expect, beforeEach } from 'vitest'
import { createTapCounter, TAPS_NEEDED, TAP_WINDOW_MS } from '../debugUnlock'

describe('createTapCounter', () => {
  let t = 0
  const counter = () => createTapCounter(() => t)
  beforeEach(() => { t = 0 })

  it('does not fire before the seventh tap', () => {
    const c = counter()
    for (let i = 1; i < TAPS_NEEDED; i++) { t += 100; expect(c.tap()).toBe(false) }
  })

  it('fires on exactly the seventh', () => {
    const c = counter()
    let fired = false
    for (let i = 0; i < TAPS_NEEDED; i++) { t += 100; fired = c.tap() }
    expect(fired).toBe(true)
  })

  it('a pause resets the run, so it is not reachable by accident', () => {
    const c = counter()
    for (let i = 0; i < 5; i++) { t += 100; c.tap() }
    t += TAP_WINDOW_MS + 1
    expect(c.tap()).toBe(false)          // this one starts a new run
    for (let i = 0; i < TAPS_NEEDED - 2; i++) { t += 100; expect(c.tap()).toBe(false) }
    t += 100
    expect(c.tap()).toBe(true)
  })

  it('starts counting again after it fires, so seven more toggles back', () => {
    const c = counter()
    for (let i = 0; i < TAPS_NEEDED; i++) { t += 100; c.tap() }
    for (let i = 0; i < TAPS_NEEDED - 1; i++) { t += 100; expect(c.tap()).toBe(false) }
    t += 100
    expect(c.tap()).toBe(true)
  })

  it('a tap exactly on the window boundary still counts', () => {
    const c = counter()
    t += 100; c.tap()
    t += TAP_WINDOW_MS
    expect(c.tap()).toBe(false)          // counted, not reset — only 2 of 7
  })
})
