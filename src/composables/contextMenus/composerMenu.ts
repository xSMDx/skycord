/**
 * The composer's "+" menu: what can go into a message besides text.
 *
 * Every row is something Skycord already does, reachable elsewhere too —
 * the "+" just puts them in one obvious place, and on a phone it is how GIFs
 * come back to the composer at all (the GIF button does not fit there).
 *
 * Deliberately absent, because a row that does nothing is worse than no row
 * (the rule callMenu.ts spells out):
 *   Create Poll, Schedule Message, Record Voice Message — no such features yet;
 *     ideas for the roadmap, the owner's to decide on
 *   Use Apps — no app or bot system
 *
 * Upload a File greys out where the member's role withholds Attach files. The
 * "+" itself never does: the other rows need no permission.
 */
import { Upload, ImagePlay, Sticker, Clock } from 'lucide-vue-next'
import type { MenuItem } from '../useContextMenu'

export interface ComposerMenuHandlers {
  uploadFile:   () => void
  openGif:      () => void
  openStickers: () => void
  insertTime:   () => void
}

export const buildComposerMenu = (o: { canAttach: boolean }, h: ComposerMenuHandlers): MenuItem[] => [
  { label: 'Upload a File', icon: Upload,    disabled: !o.canAttach, onSelect: h.uploadFile },
  { label: 'GIF',           icon: ImagePlay, onSelect: h.openGif },
  { label: 'Sticker',       icon: Sticker,   onSelect: h.openStickers },
  { label: 'Insert a time', icon: Clock,     onSelect: h.insertTime },
]
