import { describe, it, expect, vi } from 'vitest'
import { buildChannelMenu } from '../channelMenu'
import { isAction, type MenuItem } from '../../useContextMenu'

const ch = { id: 'c1', name: 'general', type: 'text' as const, serverId: 's1' }
const handlers = () => ({ rename: vi.fn(), remove: vi.fn(), copy: vi.fn() })
const labels = (i: MenuItem[]) => i.filter(isAction).map(x => x.label)

describe('buildChannelMenu', () => {
  it('gives the owner rename and delete', () => {
    const l = labels(buildChannelMenu(ch, true, handlers()))
    expect(l).toEqual(expect.arrayContaining(['Edit Channel', 'Delete Channel']))
  })

  it('gives a non-owner only Copy Channel ID', () => {
    expect(labels(buildChannelMenu(ch, false, handlers()))).toEqual(['Copy Channel ID'])
  })

  it('copies the channel id, not the name', () => {
    const h = handlers()
    buildChannelMenu(ch, true, h).filter(isAction)
      .find(i => i.label === 'Copy Channel ID')!.onSelect?.()
    expect(h.copy).toHaveBeenCalledWith('c1', 'Channel ID')
  })

  it('marks delete destructive', () => {
    const del = buildChannelMenu(ch, true, handlers()).filter(isAction)
      .find(i => i.label === 'Delete Channel')
    expect(del?.danger).toBe(true)
  })
})
