/**
 * App-wide context menu state.
 *
 * One menu exists at a time, mounted once at the app root (see ContextMenu.vue).
 * A target opens it with `openMenu(event, items)` where items are plain data —
 * no per-surface component, no duplicated backdrop/positioning/keyboard code.
 * Adding a menu to a new surface is one line in the template.
 */
import { reactive, computed, shallowRef, markRaw, type Component } from 'vue'

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
  /** Leave the menu open after selecting. For toggles: closing on every click
   *  means you never see the checkbox you just ticked, and flipping two of them
   *  takes two round trips through the right-click. */
  keepOpen?: boolean
  onSelect?: () => void | Promise<void>
}
export interface MenuSeparator { sep: true }

/** A live control rather than an action — User Volume is the recurring case.
 *  It gets its own item type rather than the header slot because it recurs; the
 *  slot is for genuinely one-off content. Selecting it must NOT close the menu,
 *  or you couldn't drag the handle. */
export interface MenuSlider {
  slider:  true
  label:   string
  value:   number
  min?:    number
  max?:    number
  /** Formats the readout; defaults to the raw number. */
  format?: (v: number) => string
  onInput: (v: number) => void
}

export type MenuItem = MenuAction | MenuSeparator | MenuSlider

export const isSeparator = (i: MenuItem): i is MenuSeparator => 'sep' in i
export const isSlider    = (i: MenuItem): i is MenuSlider    => 'slider' in i
/** Rows that behave like buttons — everything that isn't a separator or slider. */
export const isAction    = (i: MenuItem): i is MenuAction    => !isSeparator(i) && !isSlider(i)
export const hasSubmenu  = (i: MenuItem): i is MenuAction & { submenu: MenuItem[] } =>
  isAction(i) && !!i.submenu?.length

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
  items.map(i => (isSeparator(i) || isSlider(i)) ? i : {
    ...i,
    icon:    i.icon ? markRaw(i.icon) : undefined,
    submenu: i.submenu ? prepare(i.submenu) : undefined,
  })

// A menu may be given either a fixed array or a BUILDER. With a builder the
// items are recomputed whenever anything they read changes, which is what makes
// a checkbox tick and a slider's readout move while the menu is still open —
// a snapshot array can never do that, because the items were built once at
// open time and nothing rewrites them.
const builder = shallowRef<(() => MenuItem[]) | null>(null)

export const menuItems = computed<MenuItem[]>(() =>
  builder.value ? prepare(builder.value()) : menu.items)

/**
 * Anything openMenu actually touches on the event: a screen position plus the
 * two calls every trigger already makes (preventDefault/stopPropagation). A
 * plain MouseEvent satisfies this structurally, so every existing call site
 * is unaffected — this only widens what ELSE can be passed, for triggers
 * (like a keyboard activation) that have no pointer position of their own and
 * build one from an element's bounding rect instead.
 */
export interface MenuAnchor {
  clientX: number
  clientY: number
  preventDefault(): void
  stopPropagation(): void
}

export const openMenu = (e: MenuAnchor, items: MenuItem[] | (() => MenuItem[])) => {
  const initial = typeof items === 'function' ? items() : items
  if (!initial.length) return
  e.preventDefault()
  // Right-clicking a second target while a menu is open should move the menu,
  // not stack a second one — so this is a reopen, not a toggle.
  e.stopPropagation()
  lastFocused = document.activeElement as HTMLElement | null
  // markRaw: icons are component definitions, and making them reactive is both
  // pointless and noisy in devtools. Applied through submenus too, or a nested
  // icon would slip back into the reactive graph.
  if (typeof items === 'function') { builder.value = items; menu.items = [] }
  else { builder.value = null; menu.items = prepare(items) }
  menu.x = e.clientX
  menu.y = e.clientY
  menu.open = true
}

export const closeMenu = () => {
  if (!menu.open) return
  menu.open = false
  menu.items = []
  builder.value = null
  lastFocused?.focus?.()
  lastFocused = null
}

export const useContextMenu = () => ({ menu, openMenu, closeMenu })
