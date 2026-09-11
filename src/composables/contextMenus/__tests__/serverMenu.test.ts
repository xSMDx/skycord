import { describe, it, expect, vi } from 'vitest'
import { buildServerMenu, buildSidebarMenu, type ServerMenuAccess } from '../serverMenu'
import { isAction, isSeparator, type MenuItem } from '../../useContextMenu'

const handlers = () => ({
  markRead: vi.fn(),
  invitePeople: vi.fn(),
  createChannel: vi.fn(),
  createCategory: vi.fn(),
  leaveServer: vi.fn(),
  deleteServer: vi.fn(),
  voiceServers: vi.fn(),
  serverSettings: vi.fn(),
  copy: vi.fn(),
})

const labels = (items: MenuItem[]) =>
  items.filter(isAction).map(i => i.label)

/** The owner holds every permission. */
const ALL: ServerMenuAccess = { invite: true, manageChannels: true, manageServer: true }
/** An ordinary member under the default @everyone, which may invite. */
const MEMBER: ServerMenuAccess = { invite: true, manageChannels: false, manageServer: false }
/** A member whose server has taken Create Invite away from @everyone. */
const NOTHING: ServerMenuAccess = { invite: false, manageChannels: false, manageServer: false }

const mine   = { id: 's1', name: 'HQ', owner: 'me' }
const theirs = { id: 's1', name: 'HQ', owner: 'someone' }

describe('buildServerMenu', () => {
  it('offers the owner exactly its row set', () => {
    // Exhaustive, so a row added anywhere has to be acknowledged here.
    expect(labels(buildServerMenu(mine, 'me', handlers(), ALL))).toEqual([
      'Mark As Read', 'Invite to Server', 'Create Channel', 'Create Category',
      'Server Settings', 'Voice Servers', 'Delete Server', 'Copy Server ID',
    ])
  })

  it('offers an ordinary member Invite to Server, since @everyone may invite by default', () => {
    // Create Invite has been in the default @everyone set since roles landed;
    // the menu kept the row owner-only long after the server stopped asking.
    expect(labels(buildServerMenu(theirs, 'me', handlers(), MEMBER))).toEqual([
      'Mark As Read', 'Invite to Server', 'Server Settings', 'Leave Server', 'Copy Server ID',
    ])
  })

  it('offers a member granted nothing only the rows that need nothing', () => {
    expect(labels(buildServerMenu(theirs, 'me', handlers(), NOTHING))).toEqual([
      'Mark As Read', 'Server Settings', 'Leave Server', 'Copy Server ID',
    ])
  })

  it('offers Create Channel and Create Category to a member with Manage Channels', () => {
    // A server with no categories has no header to right-click, so this row
    // is the only way to make the first one — a moderator must have it.
    const l = labels(buildServerMenu(theirs, 'me', handlers(), { ...MEMBER, manageChannels: true }))
    expect(l).toContain('Create Channel')
    expect(l).toContain('Create Category')
  })

  it('offers Voice Servers to whoever holds Manage Server', () => {
    const l = labels(buildServerMenu(theirs, 'me', handlers(), { ...MEMBER, manageServer: true }))
    expect(l).toContain('Voice Servers')
    expect(labels(buildServerMenu(theirs, 'me', handlers(), MEMBER))).not.toContain('Voice Servers')
  })

  it('offers the owner Delete Server, never Leave Server', () => {
    const l = labels(buildServerMenu(mine, 'me', handlers(), ALL))
    expect(l).toContain('Delete Server')
    expect(l).not.toContain('Leave Server')
  })

  it('never offers Delete Server to anyone else, even one holding every permission', () => {
    // An administrator holds every bit. Deleting the server stays the owner's.
    const l = labels(buildServerMenu(theirs, 'me', handlers(), ALL))
    expect(l).toContain('Leave Server')
    expect(l).not.toContain('Delete Server')
  })

  it('hands Create Category the server id', () => {
    const h = handlers()
    buildServerMenu(mine, 'me', h, ALL).filter(isAction)
      .find(i => i.label === 'Create Category')!.onSelect?.()
    expect(h.createCategory).toHaveBeenCalledWith('s1')
  })

  it('marks the destructive row danger', () => {
    const del = buildServerMenu(mine, 'me', handlers(), ALL).filter(isAction)
      .find(i => i.label === 'Delete Server')
    expect(del?.danger).toBe(true)
  })

  it('opens Server Settings, for a member as well as the owner', () => {
    // Members can read the name, description and who else is in here; the
    // fields are disabled for them server-side and in the dialog.
    const h = handlers()
    const row = buildServerMenu(theirs, 'me', h, NOTHING).filter(isAction)
      .find(i => i.label === 'Server Settings')
    expect(row?.disabled).toBeFalsy()
    row!.onSelect?.()
    expect(h.serverSettings).toHaveBeenCalledWith('s1')
  })

  it('copies the server id', () => {
    const h = handlers()
    buildServerMenu(mine, 'me', h, ALL).filter(isAction)
      .find(i => i.label === 'Copy Server ID')!.onSelect?.()
    expect(h.copy).toHaveBeenCalledWith('s1', 'Server ID')
  })

  it('separates the destructive row from the rest, for owner and member alike', () => {
    for (const [server, can, label] of [[mine, ALL, 'Delete Server'], [theirs, NOTHING, 'Leave Server']] as const) {
      const items = buildServerMenu(server, 'me', handlers(), can)
      const idx = items.findIndex(i => isAction(i) && i.label === label)
      expect(idx).toBeGreaterThan(0)
      expect(isSeparator(items[idx - 1])).toBe(true)
    }
  })

  it('never leaves two separators touching when there are no add rows', () => {
    const items = buildServerMenu(theirs, 'me', handlers(), NOTHING)
    items.forEach((it, i) => {
      if (i > 0) expect(isSeparator(it) && isSeparator(items[i - 1])).toBe(false)
    })
  })

  it('disables Mark As Read when nothing is unread', () => {
    // A live row that clears nothing is a small lie about the server's state.
    const row = (items: MenuItem[]) => items.filter(isAction).find(i => i.label === 'Mark As Read')
    expect(row(buildServerMenu(mine, 'me', handlers(), ALL, false))?.disabled).toBe(true)
    expect(row(buildServerMenu(mine, 'me', handlers(), ALL, true))?.disabled).toBeFalsy()
  })

  it('clears every unread channel of the server it was opened on', () => {
    const h = handlers()
    buildServerMenu(mine, 'me', h, ALL, true).filter(isAction)
      .find(i => i.label === 'Mark As Read')!.onSelect?.()
    expect(h.markRead).toHaveBeenCalledWith('s1')
  })

  it('calls Voice Servers through with the server id', () => {
    const h = handlers()
    buildServerMenu(mine, 'me', h, ALL).filter(isAction)
      .find(i => i.label === 'Voice Servers')!.onSelect?.()
    expect(h.voiceServers).toHaveBeenCalledWith('s1')
  })
})

describe('buildSidebarMenu', () => {
  it('offers exactly the add rows the viewer may use', () => {
    expect(labels(buildSidebarMenu(theirs, handlers(), { ...MEMBER, manageChannels: true })))
      .toEqual(['Invite to Server', 'Create Channel', 'Create Category'])
    expect(labels(buildSidebarMenu(theirs, handlers(), MEMBER))).toEqual(['Invite to Server'])
  })

  it('is empty for someone who may add nothing, so no menu opens at all', () => {
    expect(buildSidebarMenu(theirs, handlers(), NOTHING)).toEqual([])
  })
})
