import { onMounted, onBeforeUnmount } from 'vue'

/**
 * Keyboard shortcuts.
 *
 * The app had none — zero ctrlKey or metaKey handlers anywhere — which meant
 * the QuickSwitcher was fully built and completely unreachable, and reaching
 * the composer from a cold start took 28 tab stops.
 *
 * The bindings are Discord's, not new ones. PRODUCT.md makes muscle memory a
 * binding constraint: everyone arriving here already knows Discord, and a
 * self-hosted alternative that rebinds the shortcuts is asking people to
 * relearn something they never chose to change. Inventing a "better" set would
 * be the one design decision guaranteed to be noticed and resented.
 *
 * Registered once, at the app root. A shortcut layer scattered across
 * components is how you end up with two components handling the same chord
 * differently — the same failure the two context menus were.
 */

export interface ShortcutHandlers {
  quickSwitcher: () => void
  toggleMute:    () => void
  toggleDeafen:  () => void
  /** +1 next, -1 previous. */
  cycleChannel:  (dir: 1 | -1) => void
  /** True while any modal or dialog owns the screen. */
  isBlocked:     () => boolean
}

/**
 * Whether the event came from somewhere that owns its own keys.
 *
 * Only the plain-typing case: Ctrl and Alt chords are safe inside a text field
 * because no text field does anything with them, and Discord deliberately
 * leaves Ctrl+K working mid-message. Blanket-suppressing on focus would make
 * the shortcuts useless exactly when you are in the composer, which is where
 * you spend the entire session.
 */
const inTextEntry = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el?.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

export const useShortcuts = (h: ShortcutHandlers) => {
  const onKeydown = (e: KeyboardEvent) => {
    // A modal owns the keyboard while it is up: its own Escape, its own focus
    // trap, and Ctrl+K inside a dialog must not open a switcher behind it.
    if (h.isBlocked()) return

    const mod = e.ctrlKey || e.metaKey

    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      h.quickSwitcher()
      return
    }

    if (mod && e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'm') { e.preventDefault(); h.toggleMute();   return }
      if (k === 'd') { e.preventDefault(); h.toggleDeafen(); return }
    }

    // Alt+arrows walk the channel list. Skipped inside a text field only for
    // these two, because a textarea DOES use bare arrows and the Alt variant
    // is close enough to a caret move that hijacking it mid-sentence is rude.
    if (e.altKey && !mod && !inTextEntry(e.target)) {
      if (e.key === 'ArrowDown') { e.preventDefault(); h.cycleChannel(1);  return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); h.cycleChannel(-1); return }
    }
  }

  // Capture phase: a component that stops propagation on its own keydown
  // should not be able to swallow an app-level chord.
  onMounted(()      => window.addEventListener('keydown', onKeydown, true))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
}
