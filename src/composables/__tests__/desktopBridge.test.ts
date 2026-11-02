import { describe, it, expect, afterEach } from 'vitest'
import { appBridge } from '../desktopBridge'

const g = globalThis as { skycordDesktop?: unknown }
afterEach(() => {
  delete g.skycordDesktop
  // A failing Android test must not leave its bridge behind for the next one.
  delete (globalThis as { skycordAndroid?: unknown }).skycordAndroid
})

describe('appBridge', () => {
  it('is null in a browser, so nothing desktop-only appears there', () => {
    expect(appBridge()).toBeNull()
  })

  it('returns the bridge inside the Windows app', () => {
    const bridge = { platform: 'win32', changeInstance: async () => {} }
    g.skycordDesktop = bridge
    expect(appBridge()).toBe(bridge)
  })

  it('still returns an older app’s bridge that has no share picker', () => {
    const bridge = { platform: 'win32', changeInstance: async () => {} }
    g.skycordDesktop = bridge
    expect(appBridge()?.pickShare).toBeUndefined()
  })

  it('ignores something that is not the bridge', () => {
    for (const fake of ['yes', 1, null, { platform: 'win32' }, { changeInstance: 'nope' }]) {
      g.skycordDesktop = fake
      expect(appBridge(), JSON.stringify(fake)).toBeNull()
    }
  })
})

describe('appBridge on Android', () => {
  it('is the Android bridge when the app put one there', async () => {
    const { appBridge } = await import('../desktopBridge')
    const android = { platform: 'android', changeInstance: async () => {} }
    ;(globalThis as { skycordAndroid?: unknown }).skycordAndroid = android
    expect(appBridge()).toBe(android)
    delete (globalThis as { skycordAndroid?: unknown }).skycordAndroid
    expect(appBridge()).toBeNull()
  })
})
