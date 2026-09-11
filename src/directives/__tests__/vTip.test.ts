import { describe, it, expect } from 'vitest'
import type { DirectiveBinding } from 'vue'
import { vTip } from '../vTip'

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
