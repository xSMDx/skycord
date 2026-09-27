import { describe, it, expect, vi } from 'vitest'

// useGifPlayback pulls in usePerformance for `tapOnly`, which pulls in
// useAppearance → materialScheme → @material/material-color-utilities, whose
// published ESM uses extensionless relative imports Vite resolves and bare
// Node does not (same issue usePerformance.test.ts works around). Nothing
// here exercises the level itself — `playbackPolicy` takes `tapOnly` as a
// plain argument — so the module is stubbed rather than made loadable for
// the sake of this one file.
vi.mock('../usePerformance', () => ({ perf: { animatedMedia: 'play' } }))

import { playbackPolicy } from '../useGifPlayback'

const base = { animated: true, alwaysAnimate: false, reduced: false, tapOnly: false, hasHover: true }

describe('playbackPolicy', () => {
  it('plays a still image always — there is nothing to hold back', () => {
    expect(playbackPolicy({ ...base, animated: false })).toBe('always')
  })

  it('plays when the caller insists, as the crop editor does', () => {
    expect(playbackPolicy({ ...base, alwaysAnimate: true })).toBe('always')
  })

  it('never plays under reduced motion, whatever the level says', () => {
    expect(playbackPolicy({ ...base, reduced: true })).toBe('never')
    expect(playbackPolicy({ ...base, reduced: true, tapOnly: true })).toBe('never')
  })

  it('waits for a tap when the level says so, even where hover exists', () => {
    expect(playbackPolicy({ ...base, tapOnly: true })).toBe('tap')
    expect(playbackPolicy({ ...base, tapOnly: true, hasHover: false })).toBe('tap')
  })

  it('keeps today\'s behaviour when the level is not asking: hover, or the shared burst', () => {
    expect(playbackPolicy(base)).toBe('hover')
    expect(playbackPolicy({ ...base, hasHover: false })).toBe('burst')
  })
})
