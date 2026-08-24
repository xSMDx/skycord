import { describe, it, expect, vi } from 'vitest'
import { buildServerMenu } from '../serverMenu'
import { isAction, isSeparator, type MenuItem } from '../../useContextMenu'

const handlers = () => ({
  markRead: vi.fn(),
  invitePeople: vi.fn(),
  createChannel: vi.fn(),
  createCategory: vi.fn(),
  leaveServer: vi.fn(),
  deleteServer: vi.fn(),
  copy: vi.fn(),
})

const labels = (items: MenuItem[]) =>
  items.filter(isAction).map(i => i.label)

describe('buildServerMenu', () => {
  it('offers Invite People, Create Channel and Create Category to the owner', () => {
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers()))
    expect(l).toContain('Invite to Server')
    expect(l).toContain('Create Channel')
    expect(l).toContain('Create Category')
  })

  it('offers an owner exactly its row set', () => {
    // The owner half of the pin the non-owner case below already carries: an
    // exhaustive list, so a row added to the isOwner branch has to be
    // acknowledged here rather than slipping in unnoticed — and so a row that
    // should have been owner-gated but was appended to the shared tail shows
    // up as a diff in BOTH tests.
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers()))
    expect(l).toEqual([
      'Mark As Read', 'Invite to Server', 'Create Channel', 'Create Category',
      'Server Settings', 'Delete Server', 'Copy Server ID',
    ])
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

  it('hides Create Channel and Create Category from a non-owner', () => {
    // The server 403s a non-owner creating a channel, and createCategory is
    // requireOwner too (server/controllers/categoriesController.ts), so
    // offering either row would produce a modal that can only fail.
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'someone' }, 'me', handlers()))
    expect(l).not.toContain('Create Channel')
    expect(l).not.toContain('Create Category')
  })

  it('hands Create Category the server id', () => {
    const h = handlers()
    const items = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', h)
    items.filter(isAction).find(i => i.label === 'Create Category')!.onSelect?.()
    expect(h.createCategory).toHaveBeenCalledWith('s1')
  })

  it('offers a non-owner only Copy Server ID and Leave Server', () => {
    // Every invite endpoint (create/list/revoke) is owner-only server-side,
    // same as channel creation, so a non-owner's menu must pin down to
    // exactly this row set — not just individually lack Invite People —
    // so a future owner-only row that forgets to gate on isOwner fails here.
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'someone' }, 'me', handlers()))
    expect(l).toEqual(['Mark As Read', 'Server Settings', 'Leave Server', 'Copy Server ID'])
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
    // A separator anywhere in the list isn't what the name claims — it must
    // sit immediately before the destructive row, in both the owner (Delete
    // Server) and non-owner (Leave Server) cases.
    const owner = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers())
    const ownerDelIdx = owner.findIndex(i => isAction(i) && i.label === 'Delete Server')
    expect(ownerDelIdx).toBeGreaterThan(0)
    expect(isSeparator(owner[ownerDelIdx - 1])).toBe(true)

    const member = buildServerMenu({ id: 's1', name: 'HQ', owner: 'someone' }, 'me', handlers())
    const memberLeaveIdx = member.findIndex(i => isAction(i) && i.label === 'Leave Server')
    expect(memberLeaveIdx).toBeGreaterThan(0)
    expect(isSeparator(member[memberLeaveIdx - 1])).toBe(true)
  })
  it('disables Mark As Read when nothing is unread', () => {
    // A live row that clears nothing is a small lie about the server's state.
    const quiet = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers(), false)
    const noisy = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers(), true)
    const row = (items: MenuItem[]) => items.filter(isAction).find(i => i.label === 'Mark As Read')
    expect(row(quiet)?.disabled).toBe(true)
    expect(row(noisy)?.disabled).toBeFalsy()
  })

  it('shows Server Settings disabled rather than omitting it', () => {
    // Deliberate: the row says "not yet" where a missing row would say "this
    // app cannot do that". It gains a handler when the screen exists.
    const items = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers())
    expect(items.filter(isAction).find(i => i.label === 'Server Settings')?.disabled).toBe(true)
  })

  it('clears every unread channel of the server it was opened on', () => {
    const h = handlers()
    const items = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', h, true)
    items.filter(isAction).find(i => i.label === 'Mark As Read')!.onSelect?.()
    expect(h.markRead).toHaveBeenCalledWith('s1')
  })

})
