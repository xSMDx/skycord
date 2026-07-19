/**
 * App-wide context menu state.
 *
 * One menu exists at a time, mounted once at the app root (see ContextMenu.vue).
 * A target opens it with `openMenu(event, items)` where items are plain data —
 * no per-surface component, no duplicated backdrop/positioning/keyboard code.
 * Adding a menu to a new surface is one line in the template.
 */
import { reactive, markRaw, type Component } from 'vue'

export interface MenuAction {
  label:     string
  icon?:     Component
  /** Red styling for destructive actions (Remove Friend, Delete…). */
  danger?:   boolean
  disabled?: boolean
  /** Renders a checkmark — for toggles like "Show Own Camera". */
  check?:    boolean
  /** Nested items (Mute ▸ durations). A submenu item has no onSelect of its
   *  own — opening the flyout IS its action. */
  submenu?:  MenuItem[]
  onSelect?: () => void | Promise<void>
}
export interface MenuSeparator { sep: true }
export type MenuItem = MenuAction | MenuSeparator

export const isSeparator = (i: MenuItem): i is MenuSeparator => 'sep' in i
export const hasSubmenu  = (i: MenuItem): i is MenuAction & { submenu: MenuItem[] } =>
  !isSeparator(i) && !!i.submenu?.length

interface MenuState {
  open:  boolean
  x:     number
  y:     number
  items: MenuItem[]
}

/** Live menu state. Exported so the single root-mounted ContextMenu can render
 *  it; every other consumer should go through openMenu/closeMenu. */
export const menu = reactive<MenuState>({ open: false, x: 0, y: 0, items: [] })

// Restored when the menu closes, so keyboard users land back where they were.
let lastFocused: HTMLElement | null = null

const prepare = (items: MenuItem[]): MenuItem[] =>
  items.map(i => isSeparator(i) ? i : {
    ...i,
    icon:    i.icon ? markRaw(i.icon) : undefined,
    submenu: i.submenu ? prepare(i.submenu) : undefined,
  })

export const openMenu = (e: MouseEvent, items: MenuItem[]) => {
  if (!items.length) return
  e.preventDefault()
  // Right-clicking a second target while a menu is open should move the menu,
  // not stack a second one — so this is a reopen, not a toggle.
  e.stopPropagation()
  lastFocused = document.activeElement as HTMLElement | null
  // markRaw: icons are component definitions, and making them reactive is both
  // pointless and noisy in devtools. Applied through submenus too, or a nested
  // icon would slip back into the reactive graph.
  menu.items = prepare(items)
  menu.x = e.clientX
  menu.y = e.clientY
  menu.open = true
}

export const closeMenu = () => {
  if (!menu.open) return
  menu.open = false
  menu.items = []
  lastFocused?.focus?.()
  lastFocused = null
}

export const useContextMenu = () => ({ menu, openMenu, closeMenu })
