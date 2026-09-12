import { describe, it, expect } from 'vitest'
import { micFailureReason, micIsLive, micNotice, micAfterToggle } from '../micState'

// getUserMedia reports why it failed through DOMException.name, and the four
// causes need four different sentences: the recovery is different for each and
// only one of them is the host's problem. Classified here rather than at the
// call site so it can be tested without a browser.
describe('micFailureReason', () => {
  it('reads a refused permission', () => {
    expect(micFailureReason(new DOMException('x', 'NotAllowedError'))).toBe('denied')
    // Older Firefox spelling for the same refusal.
    expect(micFailureReason(new DOMException('x', 'SecurityError'))).toBe('denied')
  })

  it('reads a missing device', () => {
    expect(micFailureReason(new DOMException('x', 'NotFoundError'))).toBe('missing')
    expect(micFailureReason(new DOMException('x', 'OverconstrainedError'))).toBe('missing')
  })

  it('reads a device another application is holding', () => {
    expect(micFailureReason(new DOMException('x', 'NotReadableError'))).toBe('busy')
    expect(micFailureReason(new DOMException('x', 'AbortError'))).toBe('busy')
  })

  it('falls back to denied for anything it does not recognise', () => {
    // Not 'live'. An unrecognised failure is still a failure, and the safe
    // reading is that the microphone is not publishing.
    expect(micFailureReason(new Error('who knows'))).toBe('denied')
    expect(micFailureReason(undefined)).toBe('denied')
  })
})

describe('micIsLive', () => {
  it('is true only when publishing', () => {
    expect(micIsLive('live')).toBe(true)
    for (const s of ['muted', 'denied', 'missing', 'busy', 'insecure', 'forbidden'] as const) {
      expect(micIsLive(s)).toBe(false)
    }
  })
})

describe('micNotice', () => {
  it('says nothing when the microphone is working or deliberately off', () => {
    expect(micNotice('live')).toBeNull()
    expect(micNotice('muted')).toBeNull()
  })

  it('never tells a member to configure the server', () => {
    // The member did not choose this product and does not own the machine.
    // "insecure" is the one case that IS the host's problem, and even then the
    // member is told what it means for them, not what to go and install.
    for (const s of ['denied', 'missing', 'busy', 'insecure', 'forbidden'] as const) {
      const text = micNotice(s)!
      expect(text).toBeTruthy()
      expect(text.toLowerCase()).not.toContain('https')
      expect(text.toLowerCase()).not.toContain('certificate')
      expect(text.toLowerCase()).not.toContain('.cmd')
    }
  })

  it('distinguishes the four failures', () => {
    const all = (['denied', 'missing', 'busy', 'insecure', 'forbidden'] as const).map(s => micNotice(s))
    expect(new Set(all).size).toBe(all.length)
  })
})

// A resolved setMicrophoneEnabled() call is a network round-trip completing,
// not proof that a refused device started working again. toggleMute and the
// undeafen branch of toggleDeafen both resolve unconditionally after a
// deafen (it's a disable-direction call, or a no-op) regardless of whether
// the mic the person joined with actually works — so the state from before
// the toggle must win over a generic live/muted guess.
describe('micAfterToggle', () => {
  it('lets a real failure survive an unmute attempt', () => {
    for (const s of ['denied', 'missing', 'busy', 'insecure', 'forbidden'] as const) {
      expect(micAfterToggle(s, false)).toBe(s)
    }
  })

  it('lets a real failure survive a mute (or re-mute) too', () => {
    for (const s of ['denied', 'missing', 'busy', 'insecure', 'forbidden'] as const) {
      expect(micAfterToggle(s, true)).toBe(s)
    }
  })

  it('maps to muted/live normally when there was no failure to protect', () => {
    expect(micAfterToggle('live', false)).toBe('live')
    expect(micAfterToggle('live', true)).toBe('muted')
    expect(micAfterToggle('muted', false)).toBe('live')
    expect(micAfterToggle('muted', true)).toBe('muted')
  })
})
