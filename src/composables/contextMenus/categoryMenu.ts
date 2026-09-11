/**
 * The menu behind a category header in the sidebar (right-click or the header's
 * own affordance).
 *
 * Rows are gated on Manage Channels rather than shown-and-disabled, same
 * reasoning as channelMenu and serverMenu: createCategory/updateCategory/
 * deleteCategory and channel creation all need it
 * (server/controllers/categoriesController.ts), so anyone without it is
 * offered nothing that can only ever 403 — just the harmless Copy Category ID.
 *
 * Row order mirrors channelMenu exactly: the constructive rows, then Copy, then
 * a separator, then the destructive one on its own.
 */
import { Plus, Pencil, ArrowUp, ArrowDown, Copy, Trash2 } from 'lucide-vue-next'
import type { MenuItem } from '../useContextMenu'

export interface MenuCategory {
  id:       string
  name:     string
  serverId: string
}

export interface CategoryMenuHandlers {
  /** Opens Create Channel pre-targeted at this category. */
  createChannel: (category: MenuCategory) => void
  rename:        (category: MenuCategory) => void
  remove:        (category: MenuCategory) => void
  copy:          (text: string, what: string) => void
  /** One place up or down among the server's categories. */
  moveUp:        (category: MenuCategory) => void
  moveDown:      (category: MenuCategory) => void
}

/** Where the category sits, which decides whether it can move up or down. */
export interface CategoryPlace { first: boolean; last: boolean }

export const buildCategoryMenu = (
  category: MenuCategory,
  /** The viewer holds Manage Channels here (the owner always does). */
  canManage: boolean,
  h: CategoryMenuHandlers,
  /**
   * Omitted, there are no move rows. Move Up / Move Down are the keyboard and
   * touch way to reorder — a header drag needs a mouse, and a phone has no
   * HTML5 drag at all — and a row that can only fail at the end of the list
   * is left out rather than disabled, the same as Move to Category is.
   */
  place?: CategoryPlace,
): MenuItem[] => {
  if (!canManage) {
    return [
      { label: 'Copy Category ID', icon: Copy, onSelect: () => h.copy(category.id, 'Category ID') },
    ]
  }
  return [
    { label: 'Create Channel',   icon: Plus,   onSelect: () => h.createChannel(category) },
    { label: 'Edit Category',    icon: Pencil, onSelect: () => h.rename(category) },
    ...(place && !place.first
      ? [{ label: 'Move Up', icon: ArrowUp, onSelect: () => h.moveUp(category) } as MenuItem]
      : []),
    ...(place && !place.last
      ? [{ label: 'Move Down', icon: ArrowDown, onSelect: () => h.moveDown(category) } as MenuItem]
      : []),
    { label: 'Copy Category ID', icon: Copy,   onSelect: () => h.copy(category.id, 'Category ID') },
    { sep: true },
    { label: 'Delete Category',  icon: Trash2, danger: true, onSelect: () => h.remove(category) },
  ]
}
