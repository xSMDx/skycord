import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// effectiveInputMode() is what the mic path reads (micChain, useVoice). A phone
// has no key to hold, so a Push to Talk saved on a desktop must not carry over
// and leave the phone's mic closed with nothing to open it. A channel that
// itself forces push-to-talk is a different case — that one is the hold-to-talk
// button — and still wins.

type Media = { width: boolean; coarse: boolean }

async function load(media: Media, saved: 'voice' | 'ptt') {
  vi.resetModules()
  vi.stubGlobal('window', {
    matchMedia: (q: string) => ({
      matches: q.includes('max-width') ? media.width : q.includes('pointer: coarse') ? media.coarse : false,
      addEventListener() {},
    }),
    addEventListener() {},
  })
  const settings = await import('../useVoiceSettings')
  const { permits } = await import('../voicePermits')
  settings.voiceSettings.inputMode = saved
  permits.voiceActivity = true
  return { ...settings, permits }
}

describe('effectiveInputMode', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('keeps a saved Push to Talk on a desktop', async () => {
    const { effectiveInputMode } = await load({ width: false, coarse: false }, 'ptt')
    expect(effectiveInputMode()).toBe('ptt')
  })

  it('reads a saved Push to Talk as voice activity on a phone', async () => {
    const { effectiveInputMode } = await load({ width: true, coarse: true }, 'ptt')
    expect(effectiveInputMode()).toBe('voice')
  })

  it('leaves a narrow desktop window alone — it still has a keyboard', async () => {
    const { effectiveInputMode } = await load({ width: true, coarse: false }, 'ptt')
    expect(effectiveInputMode()).toBe('ptt')
  })

  it('keeps voice activity as voice activity on a phone', async () => {
    const { effectiveInputMode } = await load({ width: true, coarse: true }, 'voice')
    expect(effectiveInputMode()).toBe('voice')
  })

  it('does not rewrite the saved preference', async () => {
    const { effectiveInputMode, voiceSettings } = await load({ width: true, coarse: true }, 'ptt')
    effectiveInputMode()
    expect(voiceSettings.inputMode).toBe('ptt')
  })

  it('still forces push-to-talk where the channel requires it, phone or not', async () => {
    const phone = await load({ width: true, coarse: true }, 'voice')
    phone.permits.voiceActivity = false
    expect(phone.effectiveInputMode()).toBe('ptt')
  })
})
