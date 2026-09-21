import { describe, it, expect } from 'vitest'
import { shareOptions, pickerHints } from '../shareOptions'

describe('shareOptions', () => {
  it('Gaming: 720p at 60 fps, told to keep the motion', () => {
    const { capture, publish } = shareOptions({ kind: 'window', resolution: 720, frameRate: 60, audio: false })
    expect(capture.resolution).toEqual({ width: 1280, height: 720, frameRate: 60 })
    expect(capture.contentHint).toBe('motion')
    expect(publish.screenShareEncoding).toEqual({ maxBitrate: 4_000_000, maxFramerate: 60 })
  })

  it('Screenshare: no size cap at 15 fps, told to keep the detail', () => {
    const { capture, publish } = shareOptions({ kind: 'screen', resolution: 'source', frameRate: 15, audio: false })
    expect(capture.resolution).toBeUndefined()
    expect(capture.video).toEqual({ frameRate: 15 })
    expect(capture.contentHint).toBe('detail')
    expect(publish.screenShareEncoding).toEqual({ maxBitrate: 4_800_000, maxFramerate: 15 })
  })

  it('sends the frame rate chosen, not LiveKit’s 15 fps default for 1080p', () => {
    expect(shareOptions({ kind: 'screen', resolution: 1080, frameRate: 60, audio: false }).publish.screenShareEncoding?.maxFramerate).toBe(60)
  })

  it('asks for audio only when it was chosen', () => {
    expect(shareOptions({ kind: 'screen', resolution: 1080, frameRate: 30, audio: true }).capture.audio).toBe(true)
    expect(shareOptions({ kind: 'screen', resolution: 1080, frameRate: 30, audio: false }).capture.audio).toBe(false)
  })

  it('treats values it does not know as 30 fps with no size cap, rather than failing the share', () => {
    const { capture, publish } = shareOptions({ kind: 'screen', resolution: 'huge' as never, frameRate: 144, audio: false })
    expect(capture.video).toEqual({ frameRate: 30 })
    expect(publish.screenShareEncoding).toEqual({ maxBitrate: 8_000_000, maxFramerate: 30 })
  })
})

describe('pickerHints', () => {
  const root = (theme?: string) => ({ dataset: theme ? { theme } : {} }) as HTMLElement

  it('opens the picker light only in a light theme', () => {
    expect(pickerHints(root('light')).dark).toBe(false)
    expect(pickerHints(root('light-dim')).dark).toBe(false)
  })

  it('opens it dark in the default, the dark variants and the studio themes', () => {
    for (const t of [undefined, 'midnight', 'amoled', 'discord']) expect(pickerHints(root(t)).dark, String(t)).toBe(true)
  })
})
