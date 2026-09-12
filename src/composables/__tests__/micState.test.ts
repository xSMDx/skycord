import { describe, it, expect } from 'vitest'
import { micFailureReason } from '../micState'

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
