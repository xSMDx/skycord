import { describe, it, expect, vi } from 'vitest'
import { buildServerMenu } from '../serverMenu'
import { isAction, isSeparator, type MenuItem } from '../../useContextMenu'

const handlers = () => ({
  invitePeople: vi.fn(),
  createChannel: vi.fn(),
  leaveServer: vi.fn(),
  deleteServer: vi.fn(),
  copy: vi.fn(),
})

const labels = (items: MenuItem[]) =>
  items.filter(isAction).map(i => i.label)

describe('buildServerMenu', () => {
  it('offers Invite People and Create Channel to the owner', () => {
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers()))
    expect(l).toContain('Invite People')
    expect(l).toContain('Create Channel')
  })

  it('offers the owner Delete Server, never Leave Server', () => {
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers()))
    expect(l).toContain('Delete Server')
    expect(l).not.toContain('Leave Server')
  })

  it('offers a non-owner Leave Server, never Delete Server', () => {
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'someone' }, 'me', handlers()))
    expect(l).toContain('Leave Server')
    expect(l).not.toContain('Delete Server')
  })

  it('hides Create Channel from a non-owner', () => {
    // The server 403s a non-owner creating a channel, so offering the row
    // would produce a modal that can only fail.
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'someone' }, 'me', handlers()))
    expect(l).not.toContain('Create Channel')
  })

  it('still offers a non-owner Invite People', () => {
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'someone' }, 'me', handlers()))
    expect(l).toContain('Invite People')
  })

  it('marks the destructive row danger', () => {
    const items = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers())
    const del = items.filter(isAction).find(i => i.label === 'Delete Server')
    expect(del?.danger).toBe(true)
  })

  it('copies the server id', () => {
    const h = handlers()
    const items = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', h)
    items.filter(isAction).find(i => i.label === 'Copy Server ID')!.onSelect?.()
    expect(h.copy).toHaveBeenCalledWith('s1', 'Server ID')
  })

  it('separates the destructive row from the rest', () => {
    const items = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers())
    expect(items.some(isSeparator)).toBe(true)
  })
})
