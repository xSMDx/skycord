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

// Both call sites invoke setMicrophoneEnabled(!voice.localMuted, …), so the
// `muted` argument says which direction just resolved. An ENABLE resolving
// (muted === false) is real evidence the browser is publishing again, so it
// always wins, even over a previous failure. A DISABLE resolving (muted ===
// true) — including the no-op undeafen-while-still-muted case — proves
// nothing about the device either way, so a previous failure must survive
// it instead of being papered over with a generic 'muted'.
describe('micAfterToggle', () => {
  it('reports live once an enable resolves, regardless of the prior state', () => {
    for (const s of ['live', 'muted', 'denied', 'missing', 'busy', 'insecure', 'forbidden'] as const) {
      expect(micAfterToggle(s, false)).toBe('live')
    }
  })

  it('a granted permission clears the microphone notice', () => {
    // Join with the mic denied, grant the browser prompt mid-call, then
    // unmute: setMicrophoneEnabled(true, …) genuinely resolves, and that
    // resolved enable is proof the device works now — not just a toggle
    // settling. The stale 'denied' must not survive it.
    expect(micAfterToggle('denied', false)).toBe('live')
  })

  it('lets a real failure survive a disable, since resolving one proves nothing about the device', () => {
    for (const s of ['denied', 'missing', 'busy', 'insecure', 'forbidden'] as const) {
      expect(micAfterToggle(s, true)).toBe(s)
    }
  })

  it('maps a disable to muted when there was no failure to protect', () => {
    expect(micAfterToggle('live', true)).toBe('muted')
    expect(micAfterToggle('muted', true)).toBe('muted')
  })
})
