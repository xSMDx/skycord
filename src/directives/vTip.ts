/**
 * v-tip — attaches a styled tooltip to any element.
 *
 *   <button v-tip="'Start Voice Call'">          top (default)
 *   <button v-tip:bottom="'User Settings'">      explicit placement
 *   <button v-tip="cond ? 'Unmute' : 'Mute'">    reactive, updates live
 *
 * Also mirrors the text into `aria-label` when the element has no accessible
 * name of its own. Removing `title` would otherwise strip the only label an
 * icon-only button had, which trades a cosmetic win for a screen-reader
 * regression.
 */
import type { Directive, DirectiveBinding } from 'vue'
import { showTip, hideTip, tip, type TipPlacement } from '@/composables/useTooltip'

interface TipEl extends HTMLElement {
  __tip?: { text: string; placement: TipPlacement; cleanup: () => void }
}

const textOf = (b: DirectiveBinding) => (b.value == null ? '' : String(b.value))
const placeOf = (b: DirectiveBinding) => ((b.arg as TipPlacement) || 'top')

const bind = (el: TipEl, binding: DirectiveBinding) => {
  const state = { text: textOf(binding), placement: placeOf(binding), cleanup: () => {} }

  const enter = () => showTip(el, state.text, state.placement)
  const leave = () => hideTip()
  // A tooltip that survives the click it described just sits there covering
  // whatever the click revealed.
  const press = () => hideTip()

  el.addEventListener('mouseenter', enter)
  el.addEventListener('mouseleave', leave)
  el.addEventListener('focus', enter)
  el.addEventListener('blur', leave)
  el.addEventListener('pointerdown', press)

  state.cleanup = () => {
    el.removeEventListener('mouseenter', enter)
    el.removeEventListener('mouseleave', leave)
    el.removeEventListener('focus', enter)
    el.removeEventListener('blur', leave)
    el.removeEventListener('pointerdown', press)
  }
  el.__tip = state

  // Native title must go, or both appear.
  if (el.hasAttribute('title')) el.removeAttribute('title')
  if (!el.getAttribute('aria-label') && !el.textContent?.trim() && state.text) {
    el.setAttribute('aria-label', state.text)
  }
}

export const vTip: Directive = {
  mounted: bind,
  updated(el: TipEl, binding) {
    const s = el.__tip
    if (!s) return bind(el, binding)
    s.text = textOf(binding)
    s.placement = placeOf(binding)
    // Keep a visible tooltip in step with a label that just changed — the
    // mute button relabels itself on click while the pointer is still on it.
    if (tip.open && tip.text && s.text && tip.x === el.getBoundingClientRect().left) tip.text = s.text
    if (!el.textContent?.trim() && s.text) el.setAttribute('aria-label', s.text)
  },
  unmounted(el: TipEl) {
    el.__tip?.cleanup()
    delete el.__tip
    hideTip()
  },
}
