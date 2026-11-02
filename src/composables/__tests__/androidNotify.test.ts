import { describe, expect, it } from 'vitest'
import { alertsBelongToPage, declinedText, firstDecline } from '../androidNotify'

describe('who sounds the alert', () => {
  it('is the page on the Windows app and in a browser, in front or not', () => {
    expect(alertsBelongToPage('win32', false)).toBe(true)
    expect(alertsBelongToPage('win32', true)).toBe(true)
    expect(alertsBelongToPage(undefined, false)).toBe(true)
    expect(alertsBelongToPage(undefined, true)).toBe(true)
  })

  it('is the page on Android while it is in front', () => {
    expect(alertsBelongToPage('android', false)).toBe(true)
  })

  it('is the app, not the page, on Android once it is in the background', () => {
    expect(alertsBelongToPage('android', true)).toBe(false)
  })
})

describe('the declined toast', () => {
  it('says who declined, in plain words', () => {
    expect(declinedText('Sam')).toBe('Sam declined')
  })

  it('is shown once per person per call, however often the server says it', () => {
    const seen = new Set<string>()
    expect(firstDecline(seen, 'dm:a_b', 'u2')).toBe(true)
    expect(firstDecline(seen, 'dm:a_b', 'u2')).toBe(false)
    expect(firstDecline(seen, 'dm:a_b', 'u2')).toBe(false)
  })

  it('still shows for someone else, or for another call', () => {
    const seen = new Set<string>()
    expect(firstDecline(seen, 'group:g1', 'u2')).toBe(true)
    expect(firstDecline(seen, 'group:g1', 'u3')).toBe(true)
    expect(firstDecline(seen, 'group:g2', 'u2')).toBe(true)
  })

  it('shows again once the set is cleared for the next call', () => {
    const seen = new Set<string>()
    expect(firstDecline(seen, 'dm:a_b', 'u2')).toBe(true)
    seen.clear()
    expect(firstDecline(seen, 'dm:a_b', 'u2')).toBe(true)
  })
})
