import { describe, it, expect } from 'vitest'
import { audioLine, audioCopy } from '../shareQuality'

describe('audioLine', () => {
  it('admits a window share sends the whole application', () => {
    expect(audioLine('window', true, true))
      .toBe('Sends the app’s own sound — but all of it, every window and tab it has')
  })

  it('says nothing goes out when it is off', () => {
    expect(audioLine('window', false, true)).toBe('No sound goes with this share')
    expect(audioLine('screen', false, true)).toBe('No sound goes with this share')
  })

  it('promises the call is left out of a whole-screen share', () => {
    expect(audioLine('screen', true, true)).toBe('Sends everything your PC plays, except this call')
  })

  it('explains an old Windows instead of offering the option', () => {
    expect(audioLine('window', false, false)).toBe('Your version of Windows cannot share one app’s sound')
    expect(audioLine('window', true, false)).toBe('Your version of Windows cannot share one app’s sound')
  })

  it('still offers whole-screen sound on an old Windows', () => {
    expect(audioLine('screen', true, false)).toBe('Sends everything your PC plays, except this call')
  })
})

describe('audioCopy', () => {
  it('warns that a window share is the whole application', () => {
    expect(audioCopy(true).windowOn).toContain('every window and tab')
  })

  it('replaces both window lines with the reason when Windows is too old', () => {
    const c = audioCopy(false)
    expect(c.windowOn).toBe(c.windowOff)
    expect(c.windowOn).toContain('cannot share one app')
    expect(c.screenOn).toBe('Sends everything your PC plays, except this call')
  })
})
