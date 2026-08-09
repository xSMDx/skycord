/**
 * Tooltips — one floating element, driven by a directive.
 *
 * Replaces the browser's native `title`, which we don't control: it appears
 * after a ~1s delay we can't change, in the OS's font and colours, at the
 * cursor rather than anchored to the control, and it can't be styled or
 * animated. On a dark app it reads as something that leaked in from outside.
 *
 * One shared element rather than one per trigger — there is only ever a single
 * tooltip on screen, so mounting hundreds of hidden ones would be waste.
 */
import { reactive } from 'vue'

export type TipPlacement = 'top' | 'bottom' | 'left' | 'right'

export const tip = reactive({
  open: false,
  text: '',
  /** Anchor rect, in viewport coordinates. The component positions from this. */
  x: 0, y: 0, w: 0, h: 0,
  placement: 'top' as TipPlacement,
})

/*
 * First tooltip waits; subsequent ones are instant.
 *
 * A delay on every tooltip makes a toolbar feel unresponsive when you sweep
 * across it. No delay at all means tooltips flash at you while the pointer is
 * just passing through. So: wait once, then stay "warm" briefly, which is how
 * native toolbars behave.
 */
const OPEN_DELAY = 400
const WARM_FOR   = 900

let openTimer: ReturnType<typeof setTimeout> | null = null
let warmUntil = 0

const clearTimer = () => { if (openTimer) { clearTimeout(openTimer); openTimer = null } }

export const showTip = (el: HTMLElement, text: string, placement: TipPlacement) => {
  if (!text) return
  clearTimer()
  const paint = () => {
    const r = el.getBoundingClientRect()
    // A trigger that has scrolled out of view shouldn't leave a tooltip
    // floating over unrelated content.
    if (r.width === 0 && r.height === 0) return
    tip.text = text
    tip.x = r.left; tip.y = r.top; tip.w = r.width; tip.h = r.height
    tip.placement = placement
    tip.open = true
  }
  if (Date.now() < warmUntil) paint()
  else openTimer = setTimeout(paint, OPEN_DELAY)
}

export const hideTip = () => {
  clearTimer()
  if (tip.open) warmUntil = Date.now() + WARM_FOR
  tip.open = false
}
