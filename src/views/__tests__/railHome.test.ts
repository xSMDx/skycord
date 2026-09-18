/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ChatApp cannot be mounted in the node environment; this reads the rail's
// markup. The server icons below Home already carry this exact contract.
const src = readFileSync(resolve(__dirname, '../ChatApp.vue'), 'utf8')
const home = /<div[^>]*class="ri home"[^>]*>/.exec(src)?.[0] ?? ''

describe('the Home rail item', () => {
  it('is found, so the checks below cannot pass vacuously', () => {
    expect(home).not.toBe('')
  })
  it('is a focusable button with a name', () => {
    expect(home).toContain('role="button"')
    expect(home).toContain('tabindex="0"')
    expect(home).toContain('aria-label="Home"')
  })
  it('says when it is the current place', () => {
    expect(home).toMatch(/:aria-current="[^"]*'page'[^"]*"/)
  })
  it('opens on Enter and on Space, like a server icon', () => {
    expect(home).toMatch(/@keydown\.self\.enter\.prevent="openFriends"/)
    expect(home).toMatch(/@keydown\.self\.space\.prevent="openFriends"/)
  })
})
