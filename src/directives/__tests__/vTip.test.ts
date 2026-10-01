import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DirectiveBinding } from 'vue'
import { vTip } from '../vTip'
import { tip as tipState, hideTip, OPEN_DELAY } from '@/composables/useTooltip'

/**
 * Just the surface the directive touches. The suite runs under
 * `environment: 'node'`, and four attribute methods are a smaller thing to
 * trust than a DOM library pulled in for one file.
 */
const fakeEl = (attrs: Record<string, string> = {}, text = '') => {
  const a = new Map(Object.entries(attrs))
  return {
    textContent: text,
    getAttribute: (k: string) => a.get(k) ?? null,
    setAttribute: (k: string, v: string) => { a.set(k, v) },
    hasAttribute: (k: string) => a.has(k),
    removeAttribute: (k: string) => { a.delete(k) },
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  } as unknown as HTMLElement
}
const tip = (value: string) => ({ value, arg: undefined }) as unknown as DirectiveBinding

const mount  = (el: HTMLElement, v: string) => (vTip as any).mounted(el, tip(v))
const update = (el: HTMLElement, v: string) => (vTip as any).updated(el, tip(v))

describe('v-tip and the accessible name', () => {
  it('names an icon-only control after its tooltip', () => {
    const el = fakeEl()
    mount(el, 'Mute')
    expect(el.getAttribute('aria-label')).toBe('Mute')
  })

  it('keeps an explicit aria-label through a re-render', () => {
    // Every channel row's ⋯ carries `aria-label="More options for <name>"`
    // and `v-tip="'More'"`. The update hook overwrote the specific label
    // with the generic one on the first re-render, so a screen reader heard
    // "More" twenty times down the sidebar.
    const el = fakeEl({ 'aria-label': 'More options for general' })
    mount(el, 'More')
    update(el, 'More')
    expect(el.getAttribute('aria-label')).toBe('More options for general')
  })

  it('still follows a label it set itself when the tooltip changes', () => {
    // The mute button relabels itself on click; the name it was given by the
    // directive has to move with it.
    const el = fakeEl()
    mount(el, 'Mute')
    update(el, 'Unmute')
    expect(el.getAttribute('aria-label')).toBe('Unmute')
  })

  it('leaves a control that has visible text alone', () => {
    const el = fakeEl({}, 'Save')
    mount(el, 'Save your changes')
    update(el, 'Save your changes')
    expect(el.getAttribute('aria-label')).toBeNull()
  })
})

/**
 * A click fires `pointerdown` and then `focus` on the same element. The
 * directive hides the tip on the first and used to show it again on the
 * second, so every mouse click re-raised the tooltip it had just dismissed —
 * on top of whatever the click had opened. The file's own comment said that
 * must not happen while the code made it happen, on roughly every button in
 * the app.
 *
 * `data-input` on <html> is maintained by main.ts for the focus ring and
 * answers the only question that matters here: pointer, or key?
 */
describe('v-tip and the click that opened something', () => {
  // showTip waits OPEN_DELAY before painting (first tooltip waits, later ones
  // are instant), so the assertions below run the clock forward rather than
  // guessing. Without this, "did not open" and "has not opened yet" look the
  // same and the test would pass for the wrong reason.
  beforeEach(() => { vi.useFakeTimers(); hideTip() })
  afterEach(() => { vi.useRealTimers() })
  const settle = () => vi.advanceTimersByTime(OPEN_DELAY + 50)

  const listening = () => {
    const on: Record<string, () => void> = {}
    const a = new Map<string, string>()
    const el = {
      textContent: '',
      getAttribute: (k: string) => a.get(k) ?? null,
      setAttribute: (k: string, v: string) => { a.set(k, v) },
      hasAttribute: (k: string) => a.has(k),
      removeAttribute: (k: string) => { a.delete(k) },
      addEventListener: (k: string, fn: () => void) => { on[k] = fn },
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    } as unknown as HTMLElement
    return { el, on }
  }

  /** main.ts sets this attribute; the directive only reads it. */
  const inputWas = (how: 'pointer' | 'key') => {
    const root = { dataset: how === 'pointer' ? { input: 'pointer' } : {} }
    globalThis.document = { documentElement: root } as unknown as Document
  }

  it('does not re-raise the tip when the focus came from a click', () => {
    const { el, on } = listening()
    ;(vTip as any).mounted(el, tip('Input device'))
    inputWas('pointer')
    on.pointerdown()          // the click hides it
    on.focus()                // ...and must not bring it straight back
    settle()
    expect(tipState.open).toBe(false)
  })

  it('still shows the tip when focus came from the keyboard', () => {
    const { el, on } = listening()
    ;(vTip as any).mounted(el, tip('Input device'))
    inputWas('key')
    on.focus()
    settle()
    expect(tipState.open).toBe(true)
    on.blur()
    expect(tipState.open).toBe(false)
  })

  it('a hover still shows it, pointer or not — mouseenter is not focus', () => {
    const { el, on } = listening()
    ;(vTip as any).mounted(el, tip('Mute'))
    inputWas('pointer')
    on.mouseenter()
    settle()
    expect(tipState.open).toBe(true)
    on.mouseleave()
    expect(tipState.open).toBe(false)
  })
})
