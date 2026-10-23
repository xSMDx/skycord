import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  backAction, overlayOpen, pressEscape, closeOverlays, OVERLAY_SELECTOR, CLOSE_PASSES, CLOSE_WAIT_MS,
} from '../androidBack'

describe('the back button, in the page', () => {
  const state = (over: Partial<Parameters<typeof backAction>[0]> = {}) =>
    ({ searchOpen: false, overlayOpen: false, onConversation: false, inCall: false, ...over })

  it('closes what is open on top first — a box over the search screen included', () => {
    expect(backAction(state({ searchOpen: true, overlayOpen: true, onConversation: true }))).toBe('escape')
    expect(backAction(state({ overlayOpen: true, onConversation: true }))).toBe('escape')
  })
  it('then the search screen — it does not close on Escape', () => {
    expect(backAction(state({ searchOpen: true, onConversation: true }))).toBe('close-search')
  })
  it('then from a conversation to the list', () => {
    expect(backAction(state({ onConversation: true }))).toBe('to-list')
  })
  it('and otherwise hands it back to Android', () => {
    expect(backAction(state())).toBe('none')
  })

  describe('in a call', () => {
    it('stays in the app at the list: Android silences the microphone of an app in the background', () => {
      expect(backAction(state({ inCall: true }))).toBe('stay-in-call')
    })
    it('still steps back from a conversation first', () => {
      expect(backAction(state({ inCall: true, onConversation: true }))).toBe('to-list')
    })
    it('still closes an overlay first, with or without the search screen', () => {
      expect(backAction(state({ inCall: true, overlayOpen: true }))).toBe('escape')
      expect(backAction(state({ inCall: true, overlayOpen: true, searchOpen: true, onConversation: true }))).toBe('escape')
    })
    it('still closes the search screen first', () => {
      expect(backAction(state({ inCall: true, searchOpen: true }))).toBe('close-search')
    })
    it('is not a thing when there is no call', () => {
      expect(backAction(state({ inCall: false }))).toBe('none')
    })
  })
  it('knows an overlay by its role, as an anchored panel, or by its own marker', () => {
    // The search screen is a dialog too, but it is closed by its own step.
    expect(OVERLAY_SELECTOR).toContain('[role="dialog"]:not([data-search-screen])')
    expect(OVERLAY_SELECTOR).toContain('[role="menu"]')
    // Not `.ap`: every message's hover buttons have that class too.
    expect(OVERLAY_SELECTOR).toContain('[data-anchored-panel]')
    expect(OVERLAY_SELECTOR).not.toContain('.ap')
    // Any other popup that closes on Escape marks itself.
    expect(OVERLAY_SELECTOR).toContain('[data-overlay]')
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

    // What was sent: a bubbling Escape keydown (the stub stores (type, init); a real event has the fields).
    const sent = top.dispatchEvent.mock.calls[0][0] as {
      type: string; key?: string; bubbles?: boolean; init?: { key?: string; bubbles?: boolean }
    }
    expect(sent.type).toBe('keydown')
    expect(sent.key ?? sent.init?.key).toBe('Escape')
    expect(sent.bubbles ?? sent.init?.bubbles).toBe(true)
  })
})

describe('closing every open overlay', () => {
  afterEach(() => { vi.useRealTimers() })

  /**
   * A dialog as ModalBase leaves one: Escape starts a ~150 ms leave transition
   * during which it is still attached and still showing, and only then does it
   * go. `stubborn` ignores Escape altogether.
   */
  const dialog = (leaveMs = 150, stubborn = false) => {
    const d = {
      isConnected: true, leaving: false, escapes: 0,
      getClientRects: () => (d.isConnected ? [{}] : []),
      dispatchEvent: vi.fn(() => {
        d.escapes++
        if (!stubborn && !d.leaving) { d.leaving = true; setTimeout(() => { d.isConnected = false }, leaveMs) }
        return true
      }),
    }
    return d
  }
  const pageOf = (...stack: ReturnType<typeof dialog>[]) => ({
    // What is in the page now, in document order — a gone dialog is no longer there.
    querySelectorAll: () => stack.filter(d => d.isConnected),
    body: { dispatchEvent: vi.fn() },
  }) as unknown as Document

  /** Runs the clock until `p` settles, and says how long that took. */
  const settle = async (p: Promise<void>) => {
    let done = false
    void p.then(() => { done = true })
    const t0 = Date.now()
    for (let i = 0; i < 400 && !done; i++) await vi.advanceTimersByTimeAsync(10)
    return { done, took: Date.now() - t0 }
  }

  it('hands back the overlay it sent Escape to, or none', () => {
    ;(globalThis as { KeyboardEvent?: unknown }).KeyboardEvent ??= class { constructor(public type: string, public init: object) {} }
    const under = dialog(), top = dialog()
    expect(pressEscape(pageOf(under, top))).toBe(top)
    expect(pressEscape(pageOf())).toBeNull()
  })

  it('lets a leaving dialog go before it looks again, so the box under it gets its own Escape', async () => {
    ;(globalThis as { KeyboardEvent?: unknown }).KeyboardEvent ??= class { constructor(public type: string, public init: object) {} }
    vi.useFakeTimers()
    const under = dialog(), top = dialog()
    const page = pageOf(under, top)

    const { done } = await settle(closeOverlays(page))
    expect(done).toBe(true)
    // Escape once each. Looking again at once would find `top` still showing
    // and send it a second one, again and again, and `under` never would.
    expect(top.escapes).toBe(1)
    expect(under.escapes).toBe(1)
    expect(overlayOpen(page)).toBe(false)
  })

  it('waits only as long as the dialog takes, not the whole bound', async () => {
    ;(globalThis as { KeyboardEvent?: unknown }).KeyboardEvent ??= class { constructor(public type: string, public init: object) {} }
    vi.useFakeTimers()
    const { done, took } = await settle(closeOverlays(pageOf(dialog(), dialog())))
    expect(done).toBe(true)
    expect(took).toBeLessThan(2 * CLOSE_WAIT_MS)   // two dialogs of ~150 ms, one after the other
  })

  it('does not wait on an overlay that ignores Escape for longer than the bound, nor pass more than six times', async () => {
    ;(globalThis as { KeyboardEvent?: unknown }).KeyboardEvent ??= class { constructor(public type: string, public init: object) {} }
    vi.useFakeTimers()
    const stuck = dialog(150, true)
    const { done, took } = await settle(closeOverlays(pageOf(stuck)))
    expect(done).toBe(true)
    expect(stuck.escapes).toBe(CLOSE_PASSES)
    expect(CLOSE_PASSES).toBe(6)
    expect(took).toBeLessThanOrEqual(CLOSE_PASSES * (CLOSE_WAIT_MS + 20))
  })

  it('sends nothing when nothing is open', async () => {
    vi.useFakeTimers()
    const page = pageOf()
    const { done } = await settle(closeOverlays(page))
    expect(done).toBe(true)
    expect(page.body.dispatchEvent).not.toHaveBeenCalled()
  })
})
