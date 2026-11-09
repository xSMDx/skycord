import { describe, it, expect, vi } from 'vitest'
import { Upload, ImagePlay, Sticker, Clock } from 'lucide-vue-next'
import { buildComposerMenu } from '../composerMenu'
import { isAction, type MenuAction, type MenuItem } from '../../useContextMenu'

const handlers = () => ({
  uploadFile:   vi.fn(),
  openGif:      vi.fn(),
  openStickers: vi.fn(),
  insertTime:   vi.fn(),
})
const actions = (i: MenuItem[]) => i.filter(isAction) as MenuAction[]

describe('buildComposerMenu', () => {
  it('lists exactly what Skycord can do, in order, each with an icon', () => {
    // Pinned exhaustively: the menu in the reference also had Create Poll, Use
    // Apps, Schedule Message and Record Voice Message. Skycord has none of
    // them, and a row that does nothing is worse than no row.
    const rows = actions(buildComposerMenu({ canAttach: true }, handlers()))
    expect(rows.map(r => r.label)).toEqual(['Upload a File', 'GIF', 'Sticker', 'Insert a time'])
    expect(rows.map(r => r.icon)).toEqual([Upload, ImagePlay, Sticker, Clock])
  })

  it('every row does something', () => {
    const h = handlers()
    for (const row of actions(buildComposerMenu({ canAttach: true }, h))) row.onSelect!()
    expect(h.uploadFile).toHaveBeenCalledOnce()
    expect(h.openGif).toHaveBeenCalledOnce()
    expect(h.openStickers).toHaveBeenCalledOnce()
    expect(h.insertTime).toHaveBeenCalledOnce()
  })

  it('greys out Upload a File where the role cannot attach, and only that row', () => {
    const rows = actions(buildComposerMenu({ canAttach: false }, handlers()))
    expect(rows.map(r => !!r.disabled)).toEqual([true, false, false, false])
    expect(actions(buildComposerMenu({ canAttach: true }, handlers()))[0].disabled).toBeFalsy()
  })
})
