import { describe, it, expect, vi } from 'vitest'
import { buildChannelMenu, UNCATEGORISED_LABEL, type MenuChannel } from '../channelMenu'
import { isAction, isSeparator, hasSubmenu, type MenuItem } from '../../useContextMenu'

const ch = { id: 'c1', name: 'general', type: 'text' as const, serverId: 's1' }
const inCat = (category: string | null): MenuChannel => ({ ...ch, category })
const cats = [{ id: 'cat1', name: 'Chat' }, { id: 'cat2', name: 'Info' }]
const handlers = () => ({ rename: vi.fn(), remove: vi.fn(), move: vi.fn(), copy: vi.fn() })
const labels = (i: MenuItem[]) => i.filter(isAction).map(x => x.label)

/**
 * Every row in order, separators included — not just the action labels. The
 * strictness is deliberate and has already earned its keep here: an
 * `arrayContaining` assertion cannot see a row that should not be there, and
 * a non-owner silently gaining an owner-only row is exactly the regression
 * this file exists to catch. Separators are pinned too, since a destructive
 * row drifting above its separator is a misclick waiting to happen.
 */
const rows = (i: MenuItem[]) => i.map(x => (isSeparator(x) ? '—' : isAction(x) ? x.label : '(slider)'))

const submenuOf = (i: MenuItem[], label: string) => {
  const parent = i.find(x => isAction(x) && x.label === label)
  if (!parent || !hasSubmenu(parent)) throw new Error(`no submenu on "${label}"`)
  return parent.submenu
}

describe('buildChannelMenu', () => {
  it('gives the owner the complete row set, in order, when the server has categories', () => {
    expect(rows(buildChannelMenu(ch, true, handlers(), cats))).toEqual([
      'Edit Channel',
      'Move to Category',
      'Copy Channel ID',
      '—',
      'Delete Channel',
    ])
  })

  it('drops Move to Category when the server has none — the submenu would offer only where the channel already is', () => {
    expect(rows(buildChannelMenu(ch, true, handlers()))).toEqual([
      'Edit Channel',
      'Copy Channel ID',
      '—',
      'Delete Channel',
    ])
  })

  it('gives a non-owner only Copy Channel ID', () => {
    expect(rows(buildChannelMenu(ch, false, handlers()))).toEqual(['Copy Channel ID'])
  })

  it('gives a non-owner only Copy Channel ID even when the server has categories', () => {
    // updateChannel is requireOwner server-side, so a Move row here could only
    // ever 403. Pinned separately from the row set above because the
    // categories argument is exactly what would smuggle one in.
    expect(rows(buildChannelMenu(ch, false, handlers(), cats))).toEqual(['Copy Channel ID'])
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

  describe('Move to Category', () => {
    it('lists Uncategorised first, then the categories in the order given', () => {
      const sub = submenuOf(buildChannelMenu(inCat('cat1'), true, handlers(), cats), 'Move to Category')
      expect(labels(sub)).toEqual([UNCATEGORISED_LABEL, 'Chat', 'Info'])
    })

    it('checks the category the channel is currently in, and only that one', () => {
      const sub = submenuOf(buildChannelMenu(inCat('cat2'), true, handlers(), cats), 'Move to Category')
      expect(sub.filter(isAction).map(i => [i.label, !!i.check])).toEqual([
        [UNCATEGORISED_LABEL, false],
        ['Chat', false],
        ['Info', true],
      ])
    })

    it('checks Uncategorised for a channel with no category', () => {
      const sub = submenuOf(buildChannelMenu(inCat(null), true, handlers(), cats), 'Move to Category')
      expect(sub.filter(isAction).map(i => [i.label, !!i.check])).toEqual([
        [UNCATEGORISED_LABEL, true],
        ['Chat', false],
        ['Info', false],
      ])
    })

    it('treats a channel with no category key at all as uncategorised', () => {
      // A channel that predates categories carries no `category` key —
      // undefined, not null (see shapeChannel's guard in serversController).
      const sub = submenuOf(buildChannelMenu(ch, true, handlers(), cats), 'Move to Category')
      expect(sub.filter(isAction).find(i => i.label === UNCATEGORISED_LABEL)!.check).toBe(true)
    })

    it('makes the current category inert — it has no onSelect to fire', () => {
      const h = handlers()
      const sub = submenuOf(buildChannelMenu(inCat('cat1'), true, h, cats), 'Move to Category')
      const current = sub.filter(isAction).find(i => i.label === 'Chat')!
      expect(current.onSelect).toBeUndefined()
      current.onSelect?.()
      expect(h.move).not.toHaveBeenCalled()
    })

    it('makes Uncategorised inert for a channel already uncategorised', () => {
      const h = handlers()
      const sub = submenuOf(buildChannelMenu(inCat(null), true, h, cats), 'Move to Category')
      const current = sub.filter(isAction).find(i => i.label === UNCATEGORISED_LABEL)!
      expect(current.onSelect).toBeUndefined()
      current.onSelect?.()
      expect(h.move).not.toHaveBeenCalled()
    })

    it('moves the channel into another category by id', () => {
      const h = handlers()
      const sub = submenuOf(buildChannelMenu(inCat('cat1'), true, h, cats), 'Move to Category')
      sub.filter(isAction).find(i => i.label === 'Info')!.onSelect?.()
      expect(h.move).toHaveBeenCalledWith(inCat('cat1'), 'cat2')
    })

    it('moves the channel out of every category with a null, never an empty string', () => {
      // resolveCategory (channelsController) 400s `''` on purpose, reading it
      // as a forgotten selection rather than "explicitly none". null is the
      // one spelling of uncategorised.
      const h = handlers()
      const sub = submenuOf(buildChannelMenu(inCat('cat1'), true, h, cats), 'Move to Category')
      sub.filter(isAction).find(i => i.label === UNCATEGORISED_LABEL)!.onSelect?.()
      expect(h.move).toHaveBeenCalledWith(inCat('cat1'), null)
    })
  })
})
