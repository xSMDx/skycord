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
