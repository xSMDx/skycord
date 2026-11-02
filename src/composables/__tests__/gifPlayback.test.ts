/// <reference types="node" />
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

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

/**
 * Avatar's `still`: an avatar that must never be a control. Avatar cannot be
 * mounted here (vitest runs in node), so its wiring is read from the source, as
 * the phone call tests do.
 */
describe('a still Avatar', () => {
  // Read lazily, so a missing file fails these tests, not the policy ones above.
  const avatar = () => readFileSync(resolve(__dirname, '../../components/ui/Avatar.vue'), 'utf8')

  it('is opt-in, so every other avatar keeps its tap', () => {
    expect(avatar()).toMatch(/still\?: boolean/)
    expect(avatar()).toMatch(/still: false \}\)/)
  })

  it('holds its first frame where the level would have waited for a tap, and draws no play button', () => {
    expect(avatar()).toContain("return props.still && r === 'tap' ? 'never' : r")
    // The play button is drawn for 'tap' alone, which a still avatar never reaches.
    expect(avatar()).toMatch(/<button v-if="reason === 'tap'"/)
  })
})
