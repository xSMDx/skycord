import { describe, it, expect } from 'vitest'
import { trayMenu, badgeAsset, trayAsset, closeAction } from '../trayModel'

describe('trayMenu', () => {
  it('outside a call: open, updates, quit', () => {
    expect(trayMenu({ inCall: false, muted: false, deafened: false, unread: 0 }).map(i => i.id))
      .toEqual(['open', 'sep', 'updates', 'sep', 'quit'])
  })
  it('in a call: mute and deafen, ticked by state', () => {
    const m = trayMenu({ inCall: true, muted: true, deafened: false, unread: 0 })
    expect(m.map(i => i.id)).toEqual(['open', 'sep', 'mute', 'deafen', 'sep', 'updates', 'sep', 'quit'])
    expect(m.find(i => i.id === 'mute')).toMatchObject({ checked: true })
    expect(m.find(i => i.id === 'deafen')).toMatchObject({ checked: false })
  })
})

describe('badges', () => {
  it('nothing at zero, a number to nine, then 9+', () => {
    expect(badgeAsset(0)).toBeNull()
    expect(badgeAsset(1)).toBe('1')
    expect(badgeAsset(9)).toBe('9')
    expect(badgeAsset(10)).toBe('9plus')
    expect(badgeAsset(-3)).toBeNull()
  })
  it('the tray dot', () => {
    expect(trayAsset(0)).toBe('tray')
    expect(trayAsset(4)).toBe('tray-unread')
  })
})

describe('closing the window', () => {
  it('hides to the tray unless quitting or switched off', () => {
    expect(closeAction({ quitting: false, keepInTray: true })).toBe('hide')
    expect(closeAction({ quitting: true, keepInTray: true })).toBe('close')
    expect(closeAction({ quitting: false, keepInTray: false })).toBe('close')
  })
})
