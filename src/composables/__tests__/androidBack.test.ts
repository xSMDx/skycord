import { describe, expect, it, vi } from 'vitest'
import { backAction, overlayOpen, pressEscape, OVERLAY_SELECTOR } from '../androidBack'

describe('the back button, in the page', () => {
  it('closes the search screen first — it does not close on Escape', () => {
    expect(backAction({ searchOpen: true, overlayOpen: true, onConversation: true })).toBe('close-search')
  })
  it('then whatever is open on top', () => {
    expect(backAction({ searchOpen: false, overlayOpen: true, onConversation: true })).toBe('escape')
  })
  it('then from a conversation to the list', () => {
    expect(backAction({ searchOpen: false, overlayOpen: false, onConversation: true })).toBe('to-list')
  })
  it('and otherwise hands it back to Android', () => {
    expect(backAction({ searchOpen: false, overlayOpen: false, onConversation: false })).toBe('none')
  })
  it('knows an overlay by its role, or as an anchored panel', () => {
    expect(OVERLAY_SELECTOR).toContain('[role="dialog"]')
    expect(OVERLAY_SELECTOR).toContain('[role="menu"]')
    // Not `.ap`: every message's hover buttons have that class too.
    expect(OVERLAY_SELECTOR).toContain('[data-anchored-panel]')
    expect(OVERLAY_SELECTOR).not.toContain('.ap')
  })

  const el = (shown: boolean) => ({ dispatchEvent: vi.fn(), getClientRects: () => (shown ? [{}] : []) })
  const docOf = (...els: ReturnType<typeof el>[]) =>
    ({ querySelectorAll: () => els, body: { dispatchEvent: vi.fn() } }) as unknown as Document

  it('counts only an overlay that is showing, not one mounted and hidden', () => {
    expect(overlayOpen(docOf(el(true)))).toBe(true)
    expect(overlayOpen(docOf(el(false)))).toBe(false)
    expect(overlayOpen(docOf())).toBe(false)
  })

  it('sends Escape to the topmost showing overlay, which is where modals listen', () => {
    ;(globalThis as { KeyboardEvent?: unknown }).KeyboardEvent ??= class { constructor(public type: string, public init: object) {} }
    const first = el(true), top = el(true), hidden = el(false)
    pressEscape(docOf(first, top, hidden))
    expect(top.dispatchEvent).toHaveBeenCalledOnce()
    expect(first.dispatchEvent).not.toHaveBeenCalled()
    expect(hidden.dispatchEvent).not.toHaveBeenCalled()
  })
})
