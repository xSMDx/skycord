import { describe, it, expect } from 'vitest'
import { durationMs } from '../utils/duration'

const DAY = 24 * 60 * 60 * 1000

describe('durationMs', () => {
  it('reads the forms a .env uses', () => {
    expect(durationMs('90d', 0)).toBe(90 * DAY)
    expect(durationMs('12h', 0)).toBe(12 * 60 * 60 * 1000)
    expect(durationMs('30m', 0)).toBe(30 * 60 * 1000)
    expect(durationMs('45s', 0)).toBe(45 * 1000)
    expect(durationMs('2w', 0)).toBe(14 * DAY)
  })

  it('reads a bare number as milliseconds, as jsonwebtoken did with the same string', () => {
    expect(durationMs('1500', 0)).toBe(1500)
  })

  it('tolerates spaces and capitals', () => {
    expect(durationMs(' 7 D ', 0)).toBe(7 * DAY)
  })

  it('falls back rather than signing everyone out on a typo', () => {
    for (const bad of ['', 'forever', '-3d', '0d', 'd90']) expect(durationMs(bad, 42), bad).toBe(42)
  })
})
