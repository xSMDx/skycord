/**
 * The menu behind a category header in the sidebar (right-click or the header's
 * own affordance).
 *
 * Rows are gated on ownership rather than shown-and-disabled, same reasoning as
 * channelMenu and serverMenu: createCategory/updateCategory/deleteCategory are
 * all `requireOwner` in server/controllers/categoriesController.ts, and channel
 * creation is owner-only too, so a non-owner's menu offers nothing that can
 * only ever 403 — just the harmless Copy Category ID.
 *
 * Row order mirrors channelMenu exactly: the constructive rows, then Copy, then
 * a separator, then the destructive one on its own.
 */
import { Plus, Pencil, Copy, Trash2 } from 'lucide-vue-next'
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
}

export const buildCategoryMenu = (
  category: MenuCategory,
  isOwner: boolean,
  h: CategoryMenuHandlers,
): MenuItem[] => {
  if (!isOwner) {
    return [
      { label: 'Copy Category ID', icon: Copy, onSelect: () => h.copy(category.id, 'Category ID') },
    ]
  }
  return [
    { label: 'Create Channel',   icon: Plus,   onSelect: () => h.createChannel(category) },
    { label: 'Edit Category',    icon: Pencil, onSelect: () => h.rename(category) },
    { label: 'Copy Category ID', icon: Copy,   onSelect: () => h.copy(category.id, 'Category ID') },
    { sep: true },
    { label: 'Delete Category',  icon: Trash2, danger: true, onSelect: () => h.remove(category) },
  ]
}
