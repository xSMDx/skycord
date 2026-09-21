import { describe, it, expect } from 'vitest'
import { parseChoice, readRemembered, PRESETS, DEFAULT_QUALITY } from '../shareQuality'

const shown = new Map([
  ['screen:1:0', 'Entire screen'],
  ['window:42:0', 'Notepad'],
])

describe('parseChoice', () => {
  it('accepts a shown screen with its quality and audio', () => {
    expect(parseChoice({ sourceId: 'screen:1:0', resolution: 1080, frameRate: 30, audio: true, hidePreview: true }, shown)).toEqual({
      sourceId: 'screen:1:0', name: 'Entire screen', kind: 'screen', resolution: 1080, frameRate: 30, audio: true, hidePreview: true,
    })
  })

  it('refuses a source the picker never showed', () => {
    expect(parseChoice({ sourceId: 'window:99:0', resolution: 720, frameRate: 30 }, shown)).toBeNull()
  })

  it('refuses anything that is not an object with a string id', () => {
    for (const bad of [null, undefined, 'screen:1:0', 7, { sourceId: 5 }]) expect(parseChoice(bad, shown)).toBeNull()
  })

  it('never carries audio with a window: Windows can only loop back the whole system', () => {
    expect(parseChoice({ sourceId: 'window:42:0', resolution: 720, frameRate: 30, audio: true }, shown)?.audio).toBe(false)
  })

  it('falls back to the default quality for values it does not offer', () => {
    const c = parseChoice({ sourceId: 'screen:1:0', resolution: 4320, frameRate: 5 }, shown)
    expect([c?.resolution, c?.frameRate]).toEqual([DEFAULT_QUALITY.resolution, DEFAULT_QUALITY.frameRate])
  })

  it('keeps "source" as a resolution', () => {
    expect(parseChoice({ sourceId: 'screen:1:0', resolution: 'source', frameRate: 15 }, shown)?.resolution).toBe('source')
  })
})

describe('readRemembered', () => {
  it('reads back a saved choice', () => {
    expect(readRemembered({ resolution: 1440, frameRate: 60, audio: true, hidePreview: true })).toEqual({ resolution: 1440, frameRate: 60, audio: true, hidePreview: true })
  })

  it('gives the defaults, audio off, for nothing or nonsense', () => {
    const fallback = { ...DEFAULT_QUALITY, audio: false, hidePreview: false }
    expect(readRemembered(undefined)).toEqual(fallback)
    expect(readRemembered({ resolution: 'huge', frameRate: -1, audio: 'yes' })).toEqual(fallback)
  })
})

describe('PRESETS', () => {
  it('uses only values the picker offers', () => {
    for (const p of Object.values(PRESETS)) {
      expect(parseChoice({ sourceId: 'screen:1:0', ...p }, shown)).toMatchObject(p)
    }
  })
})
