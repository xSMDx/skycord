import { describe, expect, it } from 'vitest'
import { HOSTED, httpWarning, displayName, iconUrl, originOfInstanceUrl } from '../view'

const profile = { software: 'skycord' as const, name: 'Crew', nameIsAddress: false, icon: '/icon.png', operator: 'Sam', version: '0.20.9' }

describe('the launcher', () => {
  it('offers the hosted instance', () => {
    expect(HOSTED).toBe('https://app.skycord.xyz')
  })

  it('warns that voice needs https, and only for http', () => {
    expect(httpWarning('http://10.0.0.5:3001')).toMatch(/calls won.t work/i)
    expect(httpWarning('https://chat.example.com')).toBeNull()
    // localhost is a secure page to Android, so calls work there.
    expect(httpWarning('http://localhost:5500')).toBeNull()
    expect(httpWarning('http://127.0.0.1:5500')).toBeNull()
  })

  it("names a server by its own name, or its address when it has none", () => {
    expect(displayName(profile, 'https://chat.example.com')).toBe('Crew')
    expect(displayName({ ...profile, nameIsAddress: true }, 'https://chat.example.com')).toBe('chat.example.com')
  })

  it('resolves the icon against the server, and refuses anything but http(s)', () => {
    expect(iconUrl(profile, 'https://chat.example.com')).toBe('https://chat.example.com/icon.png')
    expect(iconUrl({ ...profile, icon: null }, 'https://chat.example.com')).toBeNull()
    expect(iconUrl({ ...profile, icon: 'javascript:alert(1)' }, 'https://chat.example.com')).toBeNull()
  })

  it('takes back the origin from the URL lookupInstance asks for', () => {
    expect(originOfInstanceUrl('https://chat.example.com/instance')).toBe('https://chat.example.com')
    expect(originOfInstanceUrl('http://10.0.0.5:3001/instance')).toBe('http://10.0.0.5:3001')
    expect(originOfInstanceUrl('https://chat.example.com/elsewhere')).toBeNull()
  })
})
