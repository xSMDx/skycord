import { describe, it, expect } from 'vitest'
import { capturesThroughPortal, toTiles, type RawSource, type DisplayInfo } from '../shareSources'

const displays: DisplayInfo[] = [
  { id: '100', width: 2560, height: 1440, primary: true },
  { id: '200', width: 1920, height: 1080, primary: false },
]

describe('toTiles', () => {
  it('leaves out the app’s own windows, so a share never mirrors itself', () => {
    const sources: RawSource[] = [
      { id: 'window:1:0', name: 'Skycord', displayId: '' },
      { id: 'window:2:0', name: 'Notepad', displayId: '' },
    ]
    expect(toTiles(sources, new Set(['window:1:0']), displays).map(t => t.id)).toEqual(['window:2:0'])
  })

  it('drops untitled windows: there is nothing to recognise them by', () => {
    expect(toTiles([{ id: 'window:3:0', name: '   ', displayId: '' }], new Set(), displays)).toEqual([])
  })

  it('names a lone screen "Entire screen" and gives its size', () => {
    const [t] = toTiles([{ id: 'screen:0:0', name: 'Entire Screen', displayId: '100' }], new Set(), displays)
    expect(t).toEqual({ id: 'screen:0:0', kind: 'screen', name: 'Entire screen', detail: '2560 × 1440 · Primary' })
  })

  it('keeps "Screen 1", "Screen 2" when there are several', () => {
    const tiles = toTiles([
      { id: 'screen:0:0', name: 'Screen 1', displayId: '100' },
      { id: 'screen:1:0', name: 'Screen 2', displayId: '200' },
    ], new Set(), displays)
    expect(tiles.map(t => [t.name, t.detail])).toEqual([
      ['Screen 1', '2560 × 1440 · Primary'],
      ['Screen 2', '1920 × 1080'],
    ])
  })

  it('shows no size for a screen it cannot match to a display', () => {
    expect(toTiles([{ id: 'screen:9:0', name: 'Entire Screen', displayId: '999' }], new Set(), displays)[0].detail).toBeNull()
  })

  it('ignores ids that are neither a screen nor a window', () => {
    expect(toTiles([{ id: 'tab:1', name: 'x', displayId: '' }], new Set(), displays)).toEqual([])
  })
})

describe('capturesThroughPortal', () => {
  it('is a Linux Wayland session, tested as WebRTC tests it', () => {
    expect(capturesThroughPortal('linux', { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' })).toBe(true)
  })

  it('is not X11, nor a Wayland session with no display to talk to', () => {
    expect(capturesThroughPortal('linux', { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' })).toBe(false)
    expect(capturesThroughPortal('linux', { XDG_SESSION_TYPE: 'wayland' })).toBe(false)
    expect(capturesThroughPortal('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe(false)
  })

  it('is never Windows', () => {
    expect(capturesThroughPortal('win32', { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' })).toBe(false)
  })
})
