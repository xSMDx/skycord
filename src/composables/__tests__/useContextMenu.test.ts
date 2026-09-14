import { describe, it, expect } from 'vitest'
import {
  isAction, isSection, menuGroups, navigableIndices, actionOrdinal,
  type MenuAction, type MenuItem,
} from '../useContextMenu'

const row = (label: string, extra: Partial<MenuAction> = {}): MenuItem => ({ label, ...extra })
const slider: MenuItem = { slider: true, label: 'User Volume', value: 100, onInput: () => {} }

describe('isSection', () => {
  it('recognises a section and never mistakes it for an action', () => {
    const s: MenuItem = { section: 'Manage' }
    expect(isSection(s)).toBe(true)
    expect(isAction(s)).toBe(false)
    expect(isSection(row('Server Settings'))).toBe(false)
  })
})

describe('menuGroups', () => {
  it('puts rows before the first section in an unlabelled group', () => {
    const items: MenuItem[] = [row('Mark As Read'), { sep: true }, { section: 'Manage' }, row('Server Settings')]
    expect(menuGroups(items)).toEqual([
      { rows: [{ item: items[0], index: 0 }, { item: items[1], index: 1 }] },
      { label: 'Manage', rows: [{ item: items[3], index: 3 }] },
    ])
  })

  it('keeps each row\'s index in the flat list, because keyboard state is keyed on it', () => {
    const items: MenuItem[] = [{ section: 'One' }, row('A'), { section: 'Two' }, row('B')]
    const indices = menuGroups(items).flatMap(g => g.rows.map(r => r.index))
    expect(indices).toEqual([1, 3])
  })

  it('drops a section with nothing under it, so a label never heads empty space', () => {
    const items: MenuItem[] = [{ section: 'Empty' }, { section: 'Manage' }, row('Server Settings')]
    expect(menuGroups(items).map(g => g.label)).toEqual(['Manage'])
  })

  it('ends a labelled group at the next separator, so the rows past it are under no label', () => {
    // The server dropdown's shape: without this, Delete Server and Copy Server
    // ID were announced as part of "Manage".
    const items: MenuItem[] = [
      { section: 'Manage' }, row('Server Settings'), row('Voice Servers'),
      { sep: true }, row('Delete Server'), { sep: true }, row('Copy Server ID'),
    ]
    expect(menuGroups(items)).toEqual([
      { label: 'Manage', rows: [{ item: items[1], index: 1 }, { item: items[2], index: 2 }] },
      { rows: [3, 4, 5, 6].map(index => ({ item: items[index], index })) },
    ])
  })

  it('drops a label whose rows were all filtered away, and keeps the line between what remains', () => {
    const items: MenuItem[] = [row('A'), { section: 'Lines' }, { sep: true }, { section: 'B' }, row('B1')]
    expect(menuGroups(items)).toEqual([
      { rows: [{ item: items[0], index: 0 }] },
      { rows: [{ item: items[2], index: 2 }] },
      { label: 'B', rows: [{ item: items[4], index: 4 }] },
    ])
  })

  it('never loses or reorders a row, whatever the sections around it', () => {
    const items: MenuItem[] = [
      { section: 'X' }, row('A'), { sep: true }, { section: 'Empty' }, { sep: true }, row('B'), slider,
      { section: 'T' }, row('C'), { sep: true }, row('D'),
    ]
    expect(menuGroups(items).flatMap(g => g.rows.map(r => r.index)))
      .toEqual(items.flatMap((it, i) => (isSection(it) ? [] : [i])))
  })

  it('keeps a group whose only row is a slider — it is a real row', () => {
    expect(menuGroups([{ section: 'Volume' }, slider]).map(g => g.label)).toEqual(['Volume'])
  })

  it('returns no groups for an empty menu', () => {
    expect(menuGroups([])).toEqual([])
  })
})

describe('navigableIndices', () => {
  it('stops on enabled actions only — never a section, separator, slider or disabled row', () => {
    const items: MenuItem[] = [
      { section: 'S' }, row('One'), { sep: true }, slider, row('Off', { disabled: true }), row('Two'),
    ]
    expect(navigableIndices(items)).toEqual([1, 5])
  })
})

describe('actionOrdinal', () => {
  it('counts only rows that render a button, so sections and sliders do not shift the lookup', () => {
    // ContextMenu finds a submenu row's element as the Nth `.cm-row`. Only
    // actions render one; counting sliders or sections here would open the
    // flyout beside the wrong row.
    const items: MenuItem[] = [{ section: 'S' }, slider, row('One'), { sep: true }, row('Two')]
    expect(actionOrdinal(items, 2)).toBe(0)
    expect(actionOrdinal(items, 4)).toBe(1)
  })
})
