import { describe, it, expect, vi } from 'vitest'
import { buildCategoryMenu } from '../categoryMenu'
import { isAction, isSeparator, type MenuItem } from '../../useContextMenu'

const cat = { id: 'cat1', name: 'POSTS', serverId: 's1' }
const handlers = () => ({
  createChannel: vi.fn(),
  rename:        vi.fn(),
  remove:        vi.fn(),
  copy:          vi.fn(),
  moveUp:        vi.fn(),
  moveDown:      vi.fn(),
})
const labels = (i: MenuItem[]) => i.filter(isAction).map(x => x.label)

describe('buildCategoryMenu', () => {
  it('gives the owner exactly its four rows, in order', () => {
    // Pinned exhaustively rather than by individual presence: createCategory,
    // updateCategory and deleteCategory are all requireOwner server-side, so a
    // future row that forgets to gate on isOwner has to fail here — the same
    // strictness that caught a regression in the serverMenu tests.
    expect(labels(buildCategoryMenu(cat, true, handlers()))).toEqual([
      'Create Channel', 'Edit Category', 'Copy Category ID', 'Delete Category',
    ])
  })

  it('gives a non-owner only Copy Category ID', () => {
    expect(labels(buildCategoryMenu(cat, false, handlers()))).toEqual(['Copy Category ID'])
  })

  it('copies the category id, not the name', () => {
    const h = handlers()
    buildCategoryMenu(cat, true, h).filter(isAction)
      .find(i => i.label === 'Copy Category ID')!.onSelect?.()
    expect(h.copy).toHaveBeenCalledWith('cat1', 'Category ID')
  })

  it('marks delete destructive', () => {
    const del = buildCategoryMenu(cat, true, handlers()).filter(isAction)
      .find(i => i.label === 'Delete Category')
    expect(del?.danger).toBe(true)
  })

  it('separates the destructive row from the rest', () => {
    const items = buildCategoryMenu(cat, true, handlers())
    const delIdx = items.findIndex(i => isAction(i) && i.label === 'Delete Category')
    expect(delIdx).toBeGreaterThan(0)
    expect(isSeparator(items[delIdx - 1])).toBe(true)
  })

  it('hands each action the category it was built for', () => {
    const h = handlers()
    const menu = buildCategoryMenu(cat, true, h).filter(isAction)
    menu.find(i => i.label === 'Create Channel')!.onSelect?.()
    menu.find(i => i.label === 'Edit Category')!.onSelect?.()
    menu.find(i => i.label === 'Delete Category')!.onSelect?.()
    expect(h.createChannel).toHaveBeenCalledWith(cat)
    expect(h.rename).toHaveBeenCalledWith(cat)
    expect(h.remove).toHaveBeenCalledWith(cat)
  })

  describe('Move Up / Move Down', () => {
    // The keyboard and touch half of reordering categories. Dragging a header
    // needs a mouse; a phone has no HTML5 drag at all, and a long-press opens
    // this menu.
    const middle = { first: false, last: false }

    it('sits between Edit Category and Copy Category ID', () => {
      expect(labels(buildCategoryMenu(cat, true, handlers(), middle))).toEqual([
        'Create Channel', 'Edit Category', 'Move Up', 'Move Down', 'Copy Category ID', 'Delete Category',
      ])
    })

    it('drops Move Up from the first category and Move Down from the last', () => {
      expect(labels(buildCategoryMenu(cat, true, handlers(), { first: true, last: false })))
        .not.toContain('Move Up')
      expect(labels(buildCategoryMenu(cat, true, handlers(), { first: false, last: true })))
        .not.toContain('Move Down')
    })

    it('offers neither for a lone category', () => {
      const l = labels(buildCategoryMenu(cat, true, handlers(), { first: true, last: true }))
      expect(l).not.toContain('Move Up')
      expect(l).not.toContain('Move Down')
    })

    it('offers neither to someone who cannot manage channels', () => {
      expect(labels(buildCategoryMenu(cat, false, handlers(), middle))).toEqual(['Copy Category ID'])
    })

    it('hands each move the category it was built for', () => {
      const h = handlers()
      const menu = buildCategoryMenu(cat, true, h, middle).filter(isAction)
      menu.find(i => i.label === 'Move Up')!.onSelect?.()
      menu.find(i => i.label === 'Move Down')!.onSelect?.()
      expect(h.moveUp).toHaveBeenCalledWith(cat)
      expect(h.moveDown).toHaveBeenCalledWith(cat)
    })
  })

  it('offers a non-owner nothing that the server would refuse', () => {
    // Every category mutation is requireOwner (server/controllers/
    // categoriesController.ts), and so is channel creation — a row that can
    // only ever 403 is worse than no row.
    const l = labels(buildCategoryMenu(cat, false, handlers()))
    expect(l).not.toContain('Create Channel')
    expect(l).not.toContain('Edit Category')
    expect(l).not.toContain('Delete Category')
  })
})
