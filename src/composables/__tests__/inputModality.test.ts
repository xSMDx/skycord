import { describe, it, expect } from 'vitest'
import { isNavigationKey } from '../inputModality'

describe('isNavigationKey', () => {
  it('re-arms focus rings for Tab and the arrow keys', () => {
    for (const k of ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(isNavigationKey(k)).toBe(true)
    }
  })

  it('ignores typing', () => {
    expect(isNavigationKey('a')).toBe(false)
    expect(isNavigationKey('Enter')).toBe(false)
  })

  it('survives a keydown with no key at all, which autofill sends', () => {
    // Chrome fires a keydown whose `key` is undefined when it autofills a
    // field. `e.key.startsWith` threw on it — from a capture-phase listener on
    // window, so on every autofilled sign-in.
    expect(isNavigationKey(undefined)).toBe(false)
  })
})
