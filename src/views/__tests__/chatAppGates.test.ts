import { describe, it, expect } from 'vitest'
import source from '../ChatApp.vue?raw'

/**
 * Channel and category management is Manage Channels, not ownership.
 *
 * The server moved those endpoints onto the permission in v0.17 and the
 * sidebar drag followed, but the channel menu, the category menu and the
 * category `+` kept reading `isServerOwner` — so a moderator could drag a
 * channel and could not rename it.
 *
 * Read from the source because each gate is one identifier at a call site, and
 * mounting all of ChatApp to find three of them would test everything else.
 * The invariant is the useful part: ownership gates exactly one thing here,
 * the slowmode exemption the API grants the owner alone.
 */
describe('ChatApp permission gates', () => {
  it('gates nothing on ownership but the slowmode exemption', () => {
    const uses = source.split('\n')
      .filter(l => /\bisServerOwner\b/.test(l))
      .filter(l => !/const isServerOwner = computed|const slowmodeExempt = computed/.test(l))
      .map(l => l.trim())
    expect(uses).toEqual([])
  })
})

describe('ChatApp channel header', () => {
  it('shows the channel’s own topic, never a placeholder', () => {
    // A topic saved in Edit Channel round-tripped through the API and never
    // appeared: the header printed one hardcoded sentence for every channel
    // in every server.
    expect(source).not.toContain('Discuss anything on Skycord')
    expect(source).toMatch(/activeChannel\??\.topic/)
  })
})
