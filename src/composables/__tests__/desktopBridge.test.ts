import { describe, it, expect, afterEach } from 'vitest'
import { desktopBridge } from '../desktopBridge'

const g = globalThis as { skycordDesktop?: unknown }
afterEach(() => { delete g.skycordDesktop })

describe('desktopBridge', () => {
  it('is null in a browser, so nothing desktop-only appears there', () => {
    expect(desktopBridge()).toBeNull()
  })

  it('returns the bridge inside the Windows app', () => {
    const bridge = { platform: 'win32', changeInstance: async () => {} }
    g.skycordDesktop = bridge
    expect(desktopBridge()).toBe(bridge)
  })

  it('ignores something that is not the bridge', () => {
    for (const fake of ['yes', 1, null, { platform: 'win32' }, { changeInstance: 'nope' }]) {
      g.skycordDesktop = fake
      expect(desktopBridge(), JSON.stringify(fake)).toBeNull()
    }
  })
})
