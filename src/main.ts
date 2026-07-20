import { createApp } from 'vue'
import './styles/tokens.css'
import './style.css'
import App from './App.vue'
import { applyAppearance } from './composables/useAppearance'

applyAppearance()   // restore saved theme/accent/density before first paint

/**
 * Suppress the browser's own right-click menu app-wide.
 *
 * Skycord provides its own menus, and having the browser's appear alongside
 * them (or on the empty space between them) reads as unfinished.
 *
 * Two deliberate exceptions, because suppressing these costs more than it buys:
 *
 *   · Text fields and contenteditable — that menu carries Copy, Paste, Undo,
 *     Select All and spellcheck suggestions. Replacing all of that would be a
 *     project in itself, and losing it would make the composer worse than a
 *     plain <textarea>.
 *   · A live text selection anywhere — right-click is how people copy.
 *
 * Our own menus call preventDefault themselves, so they are unaffected either
 * way. Inspect Element is still reachable via F12 / Ctrl+Shift+I.
 */
window.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement | null
  if (t?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return
  if (!window.getSelection()?.isCollapsed) return
  e.preventDefault()
})

createApp(App).mount('#app')
