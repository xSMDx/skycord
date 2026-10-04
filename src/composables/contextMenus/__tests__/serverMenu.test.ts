import { describe, it, expect, vi } from 'vitest'
import { buildServerMenu, buildSidebarMenu, type ServerMenuAccess } from '../serverMenu'
import { isAction, isSeparator, isSection, menuGroups, type MenuItem } from '../../useContextMenu'

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
  setMute: vi.fn(),
  setLevel: vi.fn(),
  setHideMuted: vi.fn(),
})

const labels = (items: MenuItem[]) =>
  items.filter(isAction).map(i => i.label)

/** The whole sequence: rows by label, separators as —, sections as § Name. */
const shape = (items: MenuItem[]) =>
  items.map(i => (isSeparator(i) ? '—' : isSection(i) ? `§ ${i.section}` : isAction(i) ? i.label : '(slider)'))

/** The owner holds every permission. */
const ALL: ServerMenuAccess = { invite: true, manageChannels: true, manageServer: true }
/** An ordinary member under the default @everyone, which may invite. */
const MEMBER: ServerMenuAccess = { invite: true, manageChannels: false, manageServer: false }
/** A member whose server has taken Create Invite away from @everyone. */
const NOTHING: ServerMenuAccess = { invite: false, manageChannels: false, manageServer: false }

/** Every combination of the three permissions. */
const EVERY_ACCESS: ServerMenuAccess[] = [false, true].flatMap(invite =>
  [false, true].flatMap(manageChannels =>
    [false, true].map(manageServer => ({ invite, manageChannels, manageServer }))))

const mine   = { id: 's1', name: 'HQ', owner: 'me' }
const theirs = { id: 's1', name: 'HQ', owner: 'someone' }

describe('buildServerMenu', () => {
  it('offers the owner exactly its row set', () => {
    // Exhaustive, so a row added anywhere has to be acknowledged here.
    expect(labels(buildServerMenu(mine, 'me', handlers(), ALL))).toEqual([
      'Mark As Read', 'Mute Server', 'Notification Settings', 'Hide Muted Channels',
      'Invite to Server', 'Create Channel', 'Create Category',
      'Server Settings', 'Voice Servers', 'Delete Server', 'Copy Server ID',
    ])
  })

  it('offers an ordinary member Invite to Server, since @everyone may invite by default', () => {
    // Create Invite has been in the default @everyone set since roles landed;
    // the menu kept the row owner-only long after the server stopped asking.
    expect(labels(buildServerMenu(theirs, 'me', handlers(), MEMBER))).toEqual([
      'Mark As Read', 'Mute Server', 'Notification Settings', 'Hide Muted Channels',
      'Invite to Server', 'Server Settings', 'Leave Server', 'Copy Server ID',
    ])
  })

  it('offers a member granted nothing only the rows that need nothing', () => {
    expect(labels(buildServerMenu(theirs, 'me', handlers(), NOTHING))).toEqual([
      'Mark As Read', 'Mute Server', 'Notification Settings', 'Hide Muted Channels',
      'Server Settings', 'Leave Server', 'Copy Server ID',
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

  it('sections the owner\'s menu without moving a row', () => {
    expect(shape(buildServerMenu(mine, 'me', handlers(), ALL))).toEqual([
      'Mark As Read', '—',
      'Mute Server', 'Notification Settings', 'Hide Muted Channels', '—',
      '§ Invite & Create', 'Invite to Server', 'Create Channel', 'Create Category', '—',
      '§ Manage', 'Server Settings', 'Voice Servers', '—',
      'Delete Server', '—',
      'Copy Server ID',
    ])
  })

  it('names only the groups holding more than one row, for every combination of access', () => {
    // Written out rather than derived, so the test cannot agree with the code
    // by repeating its logic. An ordinary member (invite only) sees no label.
    const cases: Array<[ServerMenuAccess, string[]]> = [
      [{ invite: false, manageChannels: false, manageServer: false }, []],
      [{ invite: true,  manageChannels: false, manageServer: false }, []],
      [{ invite: false, manageChannels: true,  manageServer: false }, ['Create']],
      [{ invite: true,  manageChannels: true,  manageServer: false }, ['Invite & Create']],
      [{ invite: false, manageChannels: false, manageServer: true  }, ['Manage']],
      [{ invite: true,  manageChannels: false, manageServer: true  }, ['Manage']],
      [{ invite: false, manageChannels: true,  manageServer: true  }, ['Create', 'Manage']],
      [{ invite: true,  manageChannels: true,  manageServer: true  }, ['Invite & Create', 'Manage']],
    ]
    for (const [can, expected] of cases) for (const server of [mine, theirs]) {
      const sections = buildServerMenu(server, 'me', handlers(), can).filter(isSection).map(s => s.section)
      expect(sections, JSON.stringify({ can, owner: server === mine })).toEqual(expected)
    }
  })

  it('puts under a label only the rows it names — never Delete, Leave, Copy or Mark As Read', () => {
    // Read through menuGroups, which is how ContextMenu turns this list into
    // the labelled groups a screen reader announces. The flat list alone hid
    // that the last label also claimed every row after it.
    const NAMED: Record<string, string[]> = {
      'Invite & Create': ['Invite to Server', 'Create Channel', 'Create Category'],
      'Create':          ['Create Channel', 'Create Category'],
      'Manage':          ['Server Settings', 'Voice Servers'],
    }
    let labelled = 0
    for (const can of EVERY_ACCESS) for (const server of [mine, theirs]) {
      for (const g of menuGroups(buildServerMenu(server, 'me', handlers(), can))) {
        if (g.label === undefined) continue
        labelled++
        expect(g.rows.map(r => (isAction(r.item) ? r.item.label : '—')), `${g.label} ${JSON.stringify(can)}`)
          .toEqual(NAMED[g.label])
      }
    }
    expect(labelled).toBeGreaterThan(0)
  })

  it('only ever places a section straight after a separator, over at least two rows', () => {
    let seen = 0
    for (const can of EVERY_ACCESS) for (const server of [mine, theirs]) {
      const items = buildServerMenu(server, 'me', handlers(), can)
      items.forEach((it, i) => {
        if (!isSection(it)) return
        seen++
        expect(isSeparator(items[i - 1])).toBe(true)
        expect(items.slice(i + 1).findIndex(isSeparator)).toBeGreaterThanOrEqual(2)
      })
    }
    // Most combinations show no label at all; without this the loop could
    // pass having checked nothing.
    expect(seen).toBeGreaterThan(0)
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

describe('notifications on the server menu', () => {
  const hide = (items: MenuItem[]) => items.filter(isAction).find(i => i.label === 'Hide Muted Channels')!

  it('Hide Muted Channels is a toggle that stays open, checked while on', async () => {
    const { setConvPrefLocal, setAllConvPrefs } = await import('../../useConvPrefs')
    setAllConvPrefs({})
    const h = handlers()
    const off = hide(buildServerMenu(theirs, 'me', h, NOTHING))
    expect(off.check).toBe(false)
    expect(off.keepOpen).toBe(true)
    off.onSelect!()
    expect(h.setHideMuted).toHaveBeenCalledWith('s1', true)
    setConvPrefLocal('s1', { pinned: false, muted: false, mutedUntil: null, hideMuted: true })
    const on = hide(buildServerMenu(theirs, 'me', h, NOTHING))
    expect(on.check).toBe(true)
    on.onSelect!()
    expect(h.setHideMuted).toHaveBeenLastCalledWith('s1', false)
    setAllConvPrefs({})
  })

  it('mutes and sets the level of the server itself', () => {
    const h = handlers()
    const items = buildServerMenu(theirs, 'me', h, NOTHING).filter(isAction)
    items.find(i => i.label === 'Mute Server')!.submenu!.filter(isAction).at(-1)!.onSelect!()
    expect(h.setMute).toHaveBeenCalledWith('s1', 'forever')
    items.find(i => i.label === 'Notification Settings')!.submenu!.filter(isAction)
      .find(i => i.label === 'All Messages')!.onSelect!()
    expect(h.setLevel).toHaveBeenCalledWith('s1', 'all')
  })
})

describe('buildRailMenu', () => {
  it('right-clicking a server icon: read state, notifications, the id', async () => {
    const { buildRailMenu } = await import('../serverMenu')
    expect(shape(buildRailMenu(theirs, handlers(), true))).toEqual([
      'Mark As Read', '—',
      'Mute Server', 'Notification Settings', 'Hide Muted Channels', '—',
      'Copy Server ID',
    ])
  })
  it('acts on the server that was right-clicked, which need not be the open one', async () => {
    const { buildRailMenu } = await import('../serverMenu')
    const h = handlers()
    const other = { id: 's9', name: 'Elsewhere' }
    const items = buildRailMenu(other, h, true).filter(isAction)
    items.find(i => i.label === 'Mark As Read')!.onSelect!()
    items.find(i => i.label === 'Copy Server ID')!.onSelect!()
    expect(h.markRead).toHaveBeenCalledWith('s9')
    expect(h.copy).toHaveBeenCalledWith('s9', 'Server ID')
    expect(buildRailMenu(other, h, false).filter(isAction)[0].disabled).toBe(true)
  })
})
