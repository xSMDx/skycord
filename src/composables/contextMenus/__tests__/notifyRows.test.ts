import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyRows } from '../notifyRows'
import { setAllConvPrefs, setConvPrefLocal } from '../../useConvPrefs'
import { isAction, type MenuAction, type MenuItem } from '../../useContextMenu'

const h = () => ({ setMute: vi.fn(), setLevel: vi.fn() })
const row = (items: MenuItem[], label: string) => items.filter(isAction).find(i => i.label === label) as MenuAction
const sub = (items: MenuItem[], label: string) => (row(items, label).submenu ?? []).filter(isAction)
const checked = (items: MenuItem[]) => sub(items, 'Notification Settings').filter(i => i.check).map(i => i.label)
const base = { pinned: false, muted: false, mutedUntil: null }

beforeEach(() => setAllConvPrefs({}))

describe('Mute', () => {
  it('offers the durations, three hours among them, named for what is muted', () => {
    const items = notifyRows('s1', 'server', h())
    expect(sub(items, 'Mute Server').map(i => i.label)).toEqual([
      'For 15 Minutes', 'For 1 Hour', 'For 3 Hours', 'For 8 Hours', 'For 24 Hours', 'Until I turn it back on',
    ])
    expect(row(notifyRows('k1', 'category', h()), 'Mute Category')).toBeTruthy()
    expect(row(notifyRows('c1', 'channel', h()), 'Mute Channel')).toBeTruthy()
  })
  it('a duration mutes until then; the last mutes for good', () => {
    const hs = h()
    const items = notifyRows('c1', 'channel', hs)
    sub(items, 'Mute Channel')[1].onSelect!()
    const until = new Date(hs.setMute.mock.calls[0][1]).getTime()
    expect(until).toBeGreaterThan(Date.now() + 59 * 60_000)
    expect(until).toBeLessThan(Date.now() + 61 * 60_000)
    sub(items, 'Mute Channel').at(-1)!.onSelect!()
    expect(hs.setMute).toHaveBeenLastCalledWith('c1', 'forever')
  })
  it('while muted, one Unmute row instead', () => {
    setConvPrefLocal('s1', { ...base, muted: true })
    const hs = h()
    const items = notifyRows('s1', 'server', hs)
    expect(row(items, 'Mute Server')).toBeUndefined()
    row(items, 'Unmute Server').onSelect!()
    expect(hs.setMute).toHaveBeenCalledWith('s1', null)
  })
})

describe('Notification Settings', () => {
  it('a server: three levels, Only @mentions by default', () => {
    const items = notifyRows('s1', 'server', h())
    expect(sub(items, 'Notification Settings').map(i => i.label)).toEqual(['All Messages', 'Only @mentions', 'Nothing'])
    expect(checked(items)).toEqual(['Only @mentions'])
  })
  it('a category or channel adds Use Server Default, checked by default', () => {
    for (const scope of ['category', 'channel'] as const) {
      const items = notifyRows('x', scope, h())
      expect(sub(items, 'Notification Settings').map(i => i.label)).toEqual([
        'Use Server Default', 'All Messages', 'Only @mentions', 'Nothing',
      ])
      expect(checked(items)).toEqual(['Use Server Default'])
    }
  })
  it('checks the stored level', () => {
    setConvPrefLocal('c1', { ...base, level: 'nothing' })
    expect(checked(notifyRows('c1', 'channel', h()))).toEqual(['Nothing'])
    setConvPrefLocal('s1', { ...base, level: 'mentions' })
    expect(checked(notifyRows('s1', 'server', h()))).toEqual(['Only @mentions'])
  })
  it('choosing one sets it; on a server Only @mentions is the default', () => {
    const hs = h()
    setConvPrefLocal('s1', { ...base, level: 'all' })
    sub(notifyRows('s1', 'server', hs), 'Notification Settings').find(i => i.label === 'Only @mentions')!.onSelect!()
    expect(hs.setLevel).toHaveBeenCalledWith('s1', 'default')
    sub(notifyRows('c1', 'channel', hs), 'Notification Settings').find(i => i.label === 'Only @mentions')!.onSelect!()
    expect(hs.setLevel).toHaveBeenLastCalledWith('c1', 'mentions')
  })
  it('the checked row does nothing', () => {
    const items = notifyRows('c1', 'channel', h())
    expect(sub(items, 'Notification Settings')[0].onSelect).toBeUndefined()
  })
})
