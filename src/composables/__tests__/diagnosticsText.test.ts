import { describe, it, expect } from 'vitest'
import { diagnosticsText } from '../diagnosticsText'

const facts = {
  app: '0.20.1', electron: '44.4.3', chromium: '130.0.1', node: '22.9.0',
  platform: 'win32', osVersion: '10.0.28000', addonLoaded: true, perAppAudio: true,
}
const extra = { origin: 'https://app.skycord.xyz', bundle: 'index-ABC123.js', workletLoaded: true, update: 'Skycord is up to date' }

describe('diagnosticsText', () => {
  it('is plain text a person can paste into a chat', () => {
    const t = diagnosticsText(facts, extra)
    expect(t).toContain('Skycord 0.20.1')
    expect(t).toContain('Electron 44.4.3')
    expect(t).toContain('win32 10.0.28000')
    expect(t).toContain('https://app.skycord.xyz')
    expect(t).toContain('index-ABC123.js')
  })

  it('states the two share-audio facts separately', () => {
    const t = diagnosticsText(facts, extra)
    expect(t).toMatch(/addon loaded:\s*yes/i)
    expect(t).toMatch(/per-app audio:\s*yes/i)
    const off = diagnosticsText({ ...facts, addonLoaded: true, perAppAudio: false }, extra)
    expect(off).toMatch(/addon loaded:\s*yes/i)
    expect(off).toMatch(/per-app audio:\s*no/i)
  })

  it('reports the worklet, which is the file that 404d', () => {
    expect(diagnosticsText(facts, { ...extra, workletLoaded: false })).toMatch(/worklet:\s*not loaded/i)
  })

  it('carries no secrets — no tokens, no cookies, no email', () => {
    const t = diagnosticsText(facts, extra).toLowerCase()
    for (const bad of ['token', 'cookie', 'password', '@']) expect(t).not.toContain(bad)
  })
})
