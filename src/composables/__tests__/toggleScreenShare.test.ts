import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const setScreenShareEnabled = vi.fn(async (..._args: unknown[]) => undefined)
const room = { localParticipant: { isScreenShareEnabled: false, setScreenShareEnabled, getTrackPublication: () => undefined } }
vi.mock('../voiceRoom', () => ({ getRoom: () => room }))
vi.mock('../voicePermits', () => ({ permits: { video: true } }))
vi.mock('../useViewport', () => ({ useViewport: () => ({ isMobile: { value: false }, isCoarse: { value: false } }) }))

import { toggleScreenShare, media } from '../useVoiceMedia'

const g = globalThis as { skycordDesktop?: unknown }

beforeEach(() => {
  setScreenShareEnabled.mockClear()
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: () => {} } })
  vi.stubGlobal('document', { documentElement: { dataset: { theme: 'light' } } })
})
afterEach(() => { delete g.skycordDesktop; vi.unstubAllGlobals() })

describe('toggleScreenShare', () => {
  it('in a browser, shares with the browser’s own picker settings', async () => {
    await toggleScreenShare()
    const [on, capture, publish] = setScreenShareEnabled.mock.calls[0]
    expect(on).toBe(true)
    expect(capture).toMatchObject({ selfBrowserSurface: 'exclude', systemAudio: 'exclude' })
    expect(publish).toBeUndefined()
  })

  it('inside the Windows app, asks its picker first and shares with what was chosen', async () => {
    const pickShare = vi.fn(async () => ({ kind: 'screen', resolution: 1080, frameRate: 60, audio: true }))
    g.skycordDesktop = { platform: 'win32', changeInstance: async () => {}, pickShare }
    await toggleScreenShare()
    expect(pickShare).toHaveBeenCalledWith({ dark: false })
    const [, capture, publish] = setScreenShareEnabled.mock.calls[0] as [boolean, Record<string, unknown>, Record<string, unknown>]
    expect(capture).toMatchObject({ audio: true, resolution: { width: 1920, height: 1080, frameRate: 60 } })
    expect(publish).toMatchObject({ screenShareEncoding: { maxFramerate: 60 } })
  })

  it('remembers "Hide stream preview" for the share it started', async () => {
    g.skycordDesktop = { platform: 'win32', changeInstance: async () => {}, pickShare: async () => ({ kind: 'window', resolution: 720, frameRate: 60, audio: false, hidePreview: true }) }
    await toggleScreenShare()
    expect(media.hideOwnScreen).toBe(true)
  })

  it('shares nothing, and says nothing, when the app’s picker is closed', async () => {
    g.skycordDesktop = { platform: 'win32', changeInstance: async () => {}, pickShare: async () => null }
    expect(await toggleScreenShare()).toBeNull()
    expect(setScreenShareEnabled).not.toHaveBeenCalled()
  })
})
