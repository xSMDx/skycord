import { describe, expect, it } from 'vitest'
import { adminUrl, adminUrlFor } from '../utils/voiceModeration'

const instance = { id: null, name: 'Default', url: 'wss://chat.example.com', apiKey: 'k', apiSecret: 's' }
const registered = { id: 'abc123', name: 'Frankfurt', url: 'wss://fra.example.com', apiKey: 'k', apiSecret: 's' }

describe('adminUrlFor', () => {
  it('calls the instance server over the internal address when there is one', () => {
    expect(adminUrlFor(instance, 'http://livekit:7880')).toBe('http://livekit:7880')
  })

  it('falls back to the public address for the instance server', () => {
    expect(adminUrlFor(instance, '')).toBe('https://chat.example.com')
  })

  it('never sends a registered server to the internal address', () => {
    expect(adminUrlFor(registered, 'http://livekit:7880')).toBe('https://fra.example.com')
  })

  it('leaves an address that is already HTTP alone', () => {
    expect(adminUrl('http://127.0.0.1:7880')).toBe('http://127.0.0.1:7880')
  })
})
