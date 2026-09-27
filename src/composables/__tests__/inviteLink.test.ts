import { describe, it, expect } from 'vitest'
import { inviteBase } from '../inviteLink'

const here = 'https://app.skycord.xyz'

describe('inviteBase', () => {
  it('carries the address the server says is its own', () => {
    expect(inviteBase('https://chat.mara-lab.net', here)).toBe('https://chat.mara-lab.net')
  })

  it('keeps a port, and drops a path or a trailing slash', () => {
    expect(inviteBase('https://chat.example.net:8443/', here)).toBe('https://chat.example.net:8443')
    expect(inviteBase('https://chat.example.net/app', here)).toBe('https://chat.example.net')
  })

  it('falls back to the page when the server says nothing', () => {
    expect(inviteBase(null, here)).toBe(here)
    expect(inviteBase(undefined, here)).toBe(here)
    expect(inviteBase('', here)).toBe(here)
  })

  it('falls back when the address is not a web address at all', () => {
    expect(inviteBase('not an address', here)).toBe(here)
    expect(inviteBase('ftp://files.example.net', here)).toBe(here)
  })

  it('never hands out a localhost invite to someone who is not on localhost', () => {
    // A host who left CLIENT_ORIGIN at its development value would otherwise
    // send links nobody else can open.
    expect(inviteBase('http://localhost:5173', here)).toBe(here)
    expect(inviteBase('http://127.0.0.1:3001', here)).toBe(here)
  })

  it('leaves localhost alone while developing, where both are local', () => {
    expect(inviteBase('http://localhost:3050', 'http://localhost:4175')).toBe('http://localhost:3050')
  })
})
