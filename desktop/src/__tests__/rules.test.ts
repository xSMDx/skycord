import { describe, it, expect } from 'vitest'
import { sameOrigin, externalSafe, permissionAllowed } from '../rules'

const ORIGIN = 'https://chat.example.com'

describe('sameOrigin', () => {
  it('is true only for the chosen origin, exactly', () => {
    expect(sameOrigin('https://chat.example.com/channels/1', ORIGIN)).toBe(true)
    expect(sameOrigin('https://chat.example.com:443/x', ORIGIN)).toBe(true)
  })
  it('is false for a look-alike, another port, another scheme, or nonsense', () => {
    for (const url of ['https://chat.example.com.evil.io/', 'https://evil.io/?chat.example.com',
      'http://chat.example.com/', 'https://chat.example.com:8443/', 'javascript:alert(1)', 'not a url', ''])
      expect(sameOrigin(url, ORIGIN), url).toBe(false)
  })
  it('is false when nothing is chosen', () => {
    expect(sameOrigin('https://chat.example.com/', null)).toBe(false)
  })
})

describe('externalSafe', () => {
  it('lets only http and https out to the system browser', () => {
    expect(externalSafe('https://example.com/page')).toBe(true)
    expect(externalSafe('http://example.com/')).toBe(true)
    for (const url of ['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'ms-settings:', 'smb://host/share', 'data:text/html,x', ''])
      expect(externalSafe(url), url).toBe(false)
  })
})

describe('permissionAllowed', () => {
  it('grants what a chat app needs, to the chosen origin only', () => {
    for (const p of ['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection'])
      expect(permissionAllowed(p, 'https://chat.example.com/x', ORIGIN), p).toBe(true)
  })
  it('refuses the same permissions to any other origin, including the picker page', () => {
    for (const url of ['https://evil.io/', 'file:///C:/app/static/picker.html', ''])
      expect(permissionAllowed('media', url, ORIGIN), url).toBe(false)
  })
  it('refuses everything else, even to the chosen origin', () => {
    for (const p of ['geolocation', 'midi', 'midiSysex', 'pointerLock', 'openExternal', 'serial', 'hid', 'usb', 'idle-detection', 'unknown'])
      expect(permissionAllowed(p, 'https://chat.example.com/', ORIGIN), p).toBe(false)
  })
})
