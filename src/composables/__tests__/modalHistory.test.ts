import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import {
  useModalHistory, modalNav, navigateModals, installBrowserModalHistory,
  type ModalHistoryOptions,
} from '../modalHistory'

/** A stand-in for an element: showing or not, and Escape recorded. */
const fakeEl = (shown = true) => {
  const el = {
    shown,
    dispatchEvent: vi.fn(),
    getClientRects: () => (el.shown ? [{}] : []),
    contains: (other: unknown) => other === el,
  }
  return el
}
type FakeEl = ReturnType<typeof fakeEl>

/** What `querySelectorAll(OVERLAY_SELECTOR)` finds, in document order. */
let overlays: FakeEl[] = []
const doc = () => ({ querySelectorAll: () => overlays, body: { dispatchEvent: vi.fn() } }) as unknown as Document

const scopes: EffectScope[] = []
beforeEach(() => {
  overlays = []
  ;(globalThis as { KeyboardEvent?: unknown }).KeyboardEvent ??= class { constructor(public type: string, public init: object) {} }
})
afterEach(() => { while (scopes.length) scopes.pop()!.stop() })

/**
 * A tabbed modal as the components hold one: a page ref, a close that lowers
 * a shown flag, and its frame in the overlay list.
 */
const openModal = <S>(first: S | undefined, extra: Partial<ModalHistoryOptions<S>> = {}) => {
  const page = ref(first) as { value: S | undefined }
  const shown = ref(true)
  const el = fakeEl()
  overlays.push(el)
  const scope = effectScope()
  scopes.push(scope)
  const nav = scope.run(() => useModalHistory<S>({
    el: () => el as unknown as Element,
    active: () => shown.value,
    close: () => { shown.value = false; el.shown = false },
    read: () => page.value,
    go: s => { page.value = s },
    ...extra,
  }))!
  return { page, shown, el, nav, scope, unmount: () => { scope.stop(); overlays = overlays.filter(o => o !== el) } }
}

describe('a modal with pages', () => {
  it('back returns to the page you were on before, and forward comes back', async () => {
    const m = openModal('account')
    m.page.value = 'voice'
    await nextTick()
    m.nav.back()
    expect(m.page.value).toBe('account')
    await nextTick()
    expect(m.nav.forward()).toBe(true)
    expect(m.page.value).toBe('voice')
  })

  it('back on the first page you opened closes the modal', async () => {
    const m = openModal('account')
    m.nav.back()
    expect(m.shown.value).toBe(false)
  })

  it('forward with nothing ahead stays where it is', async () => {
    const m = openModal('account')
    m.page.value = 'voice'
    await nextTick()
    expect(m.nav.forward()).toBe(false)
    expect(m.page.value).toBe('voice')
  })

  it('a new page after going back drops the way forward', async () => {
    const m = openModal('account')
    m.page.value = 'voice'
    await nextTick()
    m.nav.back()
    await nextTick()
    m.page.value = 'appearance'
    await nextTick()
    expect(m.nav.forward()).toBe(false)
    m.nav.back()
    expect(m.page.value).toBe('account')
  })

  it('a page that was not known yet becoming known is not a step', async () => {
    const m = openModal<string>(undefined)
    m.page.value = 'profile'
    await nextTick()
    m.nav.back()
    expect(m.shown.value).toBe(false)
  })

  it('a change made quietly swaps the page it is on instead of adding one', async () => {
    const m = openModal('account')
    m.page.value = 'voice'
    await nextTick()
    m.nav.quietly(() => { m.page.value = 'appearance' })
    await nextTick()
    m.nav.back()
    expect(m.page.value).toBe('account')
  })

  it('a button that goes back steps back when back would land on what it shows', async () => {
    const m = openModal({ page: '', detail: false })
    m.page.value = { page: 'voice', detail: true }
    await nextTick()
    m.nav.backOr(prev => !prev.detail, () => { m.page.value = { page: 'voice', detail: false } })
    expect(m.page.value).toEqual({ page: '', detail: false })
    await nextTick()
    // …and forward still returns, as it would after any back.
    expect(m.nav.forward()).toBe(true)
    expect(m.page.value).toEqual({ page: 'voice', detail: true })
  })

  it('otherwise it shows its own target in place of the page, so back then closes', async () => {
    // Opened straight onto a page (a deep link): there is no list behind it yet.
    const m = openModal({ page: 'voice', detail: true })
    m.nav.backOr(prev => !prev.detail, () => { m.page.value = { page: 'voice', detail: false } })
    expect(m.page.value).toEqual({ page: 'voice', detail: false })
    await nextTick()
    m.nav.back()
    expect(m.shown.value).toBe(false)
  })

  it('a modal with no pages closes on back', () => {
    const shown = ref(true)
    const scope = effectScope()
    scopes.push(scope)
    const nav = scope.run(() => useModalHistory({ el: () => null, active: () => shown.value, close: () => { shown.value = false } }))!
    nav.back()
    expect(shown.value).toBe(false)
  })
})

describe('a page inside a modal page (a part)', () => {
  it('its own steps are steps of the modal: back restores them', async () => {
    const m = openModal('roles')
    const tab = ref('display')
    m.nav.part('roles', { read: () => tab.value, go: t => { tab.value = t } })
    await nextTick()
    tab.value = 'perms'
    await nextTick()
    m.nav.back()
    expect(tab.value).toBe('display')
    expect(m.page.value).toBe('roles')
  })

  it('mounting and unmounting it is not a step', async () => {
    const m = openModal('account')
    m.page.value = 'legal'
    await nextTick()
    const legal = m.nav.part('legal', { read: () => 'list', go: () => {} })
    await nextTick()
    legal.stop()
    await nextTick()
    m.nav.back()
    expect(m.page.value).toBe('account')
  })

  it('not ready yet, then ready, is not a step', async () => {
    const m = openModal('roles')
    const loaded = ref(false)
    m.nav.part('roles', { read: () => (loaded.value ? 'display' : undefined), go: () => {} })
    await nextTick()
    loaded.value = true
    await nextTick()
    m.nav.back()
    expect(m.shown.value).toBe(false)
  })

  it('going back to a page whose part is gone hands the part its page when it comes back', async () => {
    const m = openModal('legal')
    const view = ref('list')
    let legal = m.nav.part('legal', { read: () => view.value, go: v => { view.value = v } })
    await nextTick()
    view.value = 'agpl'
    await nextTick()
    m.page.value = 'voice'
    legal.stop()
    await nextTick()

    m.nav.back()
    expect(m.page.value).toBe('legal')
    // The legal page mounts again, fresh, on its list…
    const fresh = ref('list')
    legal = m.nav.part('legal', { read: () => fresh.value, go: v => { fresh.value = v } })
    // …and is put back on the document you were reading.
    expect(fresh.value).toBe('agpl')
    await nextTick()
    m.nav.back()
    expect(fresh.value).toBe('list')
  })

  it('a part button that goes back steps back when the part was on its target', async () => {
    const m = openModal('legal')
    const view = ref('list')
    const part = m.nav.part('legal', { read: () => view.value, go: v => { view.value = v } })
    await nextTick()
    view.value = 'oss'
    await nextTick()
    part.backOr(prev => prev === 'list', () => { view.value = 'list' })
    expect(view.value).toBe('list')
    await nextTick()
    expect(m.nav.forward()).toBe(true)
    expect(view.value).toBe('oss')
  })
})

describe('back and forward from outside (title bar, mouse, keys, Android)', () => {
  it('with nothing open, they are the app’s', () => {
    expect(navigateModals('back', doc())).toBe(false)
    expect(navigateModals('forward', doc())).toBe(false)
  })

  it('a modal on top moves through its own pages and nothing else', async () => {
    const m = openModal('account')
    m.page.value = 'voice'
    await nextTick()
    expect(navigateModals('back', doc())).toBe(true)
    expect(m.page.value).toBe('account')
    await nextTick()
    expect(navigateModals('forward', doc())).toBe(true)
    expect(m.page.value).toBe('voice')
  })

  it('forward with nothing ahead is still used up, so the app behind stays put', () => {
    openModal('account')
    expect(navigateModals('forward', doc())).toBe(true)
  })

  it('a menu or popup on top gets Escape on back; forward is used up', () => {
    const menu = fakeEl()
    overlays.push(menu)
    expect(navigateModals('back', doc())).toBe(true)
    expect(menu.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'keydown' }))
    expect(navigateModals('forward', doc())).toBe(true)
    expect(menu.dispatchEvent).toHaveBeenCalledTimes(1)
  })

  it('only the modal on top moves when one is open over another', async () => {
    const under = openModal('account')
    under.page.value = 'voice'
    await nextTick()
    const over = openModal('one')
    over.page.value = 'two'
    await nextTick()
    navigateModals('back', doc())
    expect(over.page.value).toBe('one')
    expect(under.page.value).toBe('voice')
  })

  it('a modal on its way out is passed over: the next press goes to the one under it', async () => {
    const under = openModal('account')
    under.page.value = 'voice'
    await nextTick()
    const over = openModal('only')
    navigateModals('back', doc())        // closes `over`; its frame is still leaving
    over.el.shown = true                  // still on screen for its leave transition
    navigateModals('back', doc())
    expect(under.page.value).toBe('account')
  })
})

describe('the title bar’s view of it', () => {
  it('is nothing with no modal open', () => {
    expect(modalNav.value).toBeNull()
  })

  it('offers back always (it closes on the first page) and forward when there is a page ahead', async () => {
    const m = openModal('account')
    expect(modalNav.value).toEqual({ canBack: true, canForward: false })
    m.page.value = 'voice'
    await nextTick()
    m.nav.back()
    await nextTick()
    expect(modalNav.value).toEqual({ canBack: true, canForward: true })
    m.unmount()
    expect(modalNav.value).toBeNull()
  })
})

describe('in a browser tab', () => {
  /** A browser's history: entries, a position, and popstate on traversal. */
  const fakeBrowser = (opts: { active?: boolean } = {}) => {
    const entries: unknown[] = [null]
    let at = 0
    let onPop: ((e: { state: unknown }) => void) | null = null
    const history = {
      get state() { return entries[at] },
      get length() { return entries.length },
      pushState: vi.fn((state: unknown) => { entries.splice(at + 1); entries.push(state); at = entries.length - 1 }),
      go: vi.fn((n: number) => { traverse(n) }),
    }
    const traverse = (n: number) => {
      const to = Math.max(0, Math.min(entries.length - 1, at + n))
      if (to === at) return
      at = to
      onPop?.({ state: entries[at] })
    }
    const win = {
      history,
      navigator: { userActivation: { hasBeenActive: opts.active ?? true } },
      addEventListener: (_t: string, f: (e: { state: unknown }) => void) => { onPop = f },
      removeEventListener: () => { onPop = null },
    }
    return {
      win: win as unknown as Window, history,
      get at() { return at }, get length() { return entries.length },
      /** The browser's own back or forward button. */
      press: (dir: 'back' | 'forward') => traverse(dir === 'back' ? -1 : 1),
    }
  }

  const install = (b: ReturnType<typeof fakeBrowser>) => {
    const stop = installBrowserModalHistory(b.win)
    scopes.push({ stop } as unknown as EffectScope)
  }

  it('opening a modal and each page in it is an entry', async () => {
    const b = fakeBrowser()
    install(b)
    const m = openModal('account')
    expect(b.length).toBe(2)
    m.page.value = 'voice'
    await nextTick()
    expect(b.length).toBe(3)
  })

  it('the browser’s back moves inside the modal, then closes it on its first page', async () => {
    const b = fakeBrowser()
    install(b)
    const m = openModal('account')
    m.page.value = 'voice'
    await nextTick()
    b.press('back')
    expect(m.page.value).toBe('account')
    await nextTick()
    b.press('back')
    expect(m.shown.value).toBe(false)
    expect(b.at).toBe(0)
  })

  it('the browser’s forward comes back; with nothing ahead in the modal it is turned back', async () => {
    const b = fakeBrowser()
    install(b)
    const m = openModal('account')
    m.page.value = 'voice'
    await nextTick()
    b.press('back')
    await nextTick()
    b.press('forward')
    expect(m.page.value).toBe('voice')
    expect(b.at).toBe(2)
  })

  it('closing a modal some other way takes its entries back off, quietly', async () => {
    const b = fakeBrowser()
    install(b)
    const before = openModal('account')
    before.unmount()          // a modal before this one, already gone
    await Promise.resolve()
    const m = openModal('account')
    m.page.value = 'voice'
    await nextTick()
    expect(b.at).toBe(2)
    m.unmount()               // its X: the modal leaves without the browser
    await Promise.resolve()
    expect(b.at).toBe(0)
    // Nothing was stepped on the way: the history went back by itself.
    expect(m.page.value).toBe('voice')
  })

  it('a modal that opens as another closes (Edit Profile from a profile) takes over its entry', async () => {
    const b = fakeBrowser()
    install(b)
    const profile = openModal('me')
    profile.unmount()
    const settings = openModal('profile')
    await Promise.resolve()
    expect(b.at).toBe(1)
    b.press('back')
    expect(settings.shown.value).toBe(false)
    expect(b.at).toBe(0)
  })

  it('the same when the new one mounts first and the old one leaves after', async () => {
    const b = fakeBrowser()
    install(b)
    const profile = openModal('me')
    const settings = openModal('profile')
    profile.unmount()
    await Promise.resolve()
    b.press('back')
    expect(settings.shown.value).toBe(false)
    settings.unmount()
    await Promise.resolve()
    // Nothing of either is left behind for a later back to fall into.
    expect(b.at).toBe(0)
  })

  it('adds nothing before you have touched the page (a browser would skip such entries)', () => {
    const b = fakeBrowser({ active: false })
    install(b)
    openModal('account')
    expect(b.length).toBe(1)
  })

  it('is not used inside the Windows, Linux or Android app, which bring their own back and forward', () => {
    const g = globalThis as { skycordAndroid?: unknown }
    g.skycordAndroid = { platform: 'android', changeInstance: async () => {} }
    try {
      const b = fakeBrowser()
      install(b)
      openModal('account')
      expect(b.length).toBe(1)
    } finally { delete g.skycordAndroid }
  })

  it('stays out of the way with no modal open', () => {
    const b = fakeBrowser()
    install(b)
    b.history.pushState({ other: true })
    b.press('back')
    expect(b.at).toBe(0)
    expect(b.history.go).not.toHaveBeenCalled()
  })
})
