import { createApp } from 'vue'
import './styles/tokens.css'
import './style.css'
import App from './App.vue'
import { applyAppearance } from './composables/useAppearance'
import { installLongPress } from './composables/useLongPress'
import { vTip } from './directives/vTip'
// Registered globally rather than imported thirteen times: an avatar is drawn
// in nearly every list in the app, and a GIF one is only framed correctly if
// it goes through this component.
import Avatar from './components/ui/Avatar.vue'

applyAppearance()   // restore saved theme/accent/density before first paint

// Touch has no right-click, so every context menu in the app would be
// unreachable on a phone. This synthesises one at the touch point after a hold.
installLongPress()

/**
 * Track whether the last interaction was a pointer or the keyboard.
 *
 * Chromium's `:focus-visible` heuristic gets native controls right — clicking a
 * <button> with a mouse does not match, tabbing to it does. It does NOT get
 * author-focusable elements right: a `<div role="button" tabindex="0">` matches
 * on a plain mouse click. Most of this app's clickable rows are exactly that —
 * the server rail, channel rows, the sidebar header, category labels — so
 * clicking a server lit it with the 2px white focus ring and left it lit.
 *
 * Marking the modality on <html> lets the ring stay for keyboard users, which
 * is the whole reason it exists, while a mouse click behaves the way a native
 * button does. Capture phase so a stopPropagation() somewhere in the app cannot
 * desynchronise the flag from reality.
 */
const _root = document.documentElement
addEventListener('pointerdown', () => _root.setAttribute('data-input', 'pointer'), true)
addEventListener('keydown', e => {
  // Only navigation keys re-arm it. Typing into a field is not a request to
  // see focus rings everywhere.
  if (e.key === 'Tab' || e.key.startsWith('Arrow')) _root.removeAttribute('data-input')
}, true)

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

createApp(App)
  .component('Avatar', Avatar)
  .directive('tip', vTip)
  .mount('#app')
