/**
 * Back and forward while a modal is open.
 *
 * Every way of going back or forward — the desktop app's title-bar buttons, the
 * mouse's own buttons (the app hands both to the page), Alt+Left and Alt+Right,
 * the Android back button, and in a browser tab the browser's history — moves
 * inside the modal on top while there is one, and never the app behind it:
 *
 *  - back goes to the page or tab you were on before inside the modal, and
 *    forward returns, browser-style;
 *  - back on the first page you opened closes the modal, as the Android back
 *    button already did;
 *  - forward with nothing ahead does nothing, and is still used up;
 *  - a menu or popup on top (not a modal of its own) gets Escape on back, the
 *    way the Android back button closes it.
 *
 * The app's own history (desktopTitleBar.ts) is never touched while a modal is
 * open, so once the last one closes it is exactly as it was before.
 *
 * A modal joins with `useModalHistory`: ModalBase does it for every modal built
 * on it (tabs through its `pages` prop), and the modals with their own shell
 * (Settings, Server Settings, RTC debug, the emoji picker) call it themselves.
 * A page inside a modal page that has steps of its own (the roles editor's
 * tabs, the legal page's documents) joins its modal with `useModalPart`.
 */
import {
  computed, getCurrentInstance, inject, nextTick, onScopeDispose, provide, ref, shallowReactive, watch,
  type InjectionKey, type Ref,
} from 'vue'
import { createNavHistory } from './navHistory'
import { OVERLAY_SELECTOR } from './androidBack'
import { appBridge } from './desktopBridge'

export interface ModalHistoryOptions<S> {
  /** The modal's frame: the element of it that matches OVERLAY_SELECTOR. */
  el: () => Element | null | undefined
  /** Close the modal, with its leave transition where it has one. */
  close: () => void
  /** False once it is closing but still on screen for its leave. Default: always true. */
  active?: () => boolean
  /** The page on show, as plain data; undefined until it is known. Omit for a modal with one page. */
  read?: () => S | undefined
  /** Show that page. */
  go?: (s: S) => void
}

/** A tabbed modal built on ModalBase hands it these as its `pages` prop. */
export interface ModalPages<S> {
  /** The tab or page on show, as plain data. */
  read: () => S | undefined
  /** Show that tab or page. */
  go: (s: S) => void
}

export interface PartOptions<P> {
  /** The part's own page, as plain data; undefined until it is known (still loading). */
  read: () => P | undefined
  /** Show that page; may be called before the part has finished loading. */
  go: (p: P) => void
}

export interface PartHandle<P> {
  stop(): void
  /** For the part's own back button: see ModalHistory.backOr. */
  backOr(matches: (prev: P) => boolean, fallback: () => void): void
  quietly(fn: () => void): void
}

export interface ModalHistory<S> {
  /** The page before, or close on the first page. */
  back(): void
  /** The page ahead; false when there is none. */
  forward(): boolean
  /**
   * For the modal's own back button (a phone's "back to the list" arrow): step
   * back when the page before is what the button shows, so back and forward
   * stay true to what you did; otherwise run `fallback` in place of the page
   * you are on, so the next back closes rather than returning here.
   */
  backOr(matches: (prev: S) => boolean, fallback: () => void): void
  /** A change that is not a step of yours (a resize, a load): it swaps the page instead of adding one. */
  quietly(fn: () => void): void
  /** Join a page inside this modal that has steps of its own. */
  part<P>(id: string, p: PartOptions<P>): PartHandle<P>
}

/** A modal as the rest of the app sees it. */
interface Entry {
  el(): Element | null | undefined
  active(): boolean
  back(): void
  forward(): boolean
  canForward: Ref<boolean>
}

/** Open modals, in the order they opened. */
const open = shallowReactive<Entry[]>([])

type ModalEvent = 'open' | 'step' | 'close'
const listeners = new Set<(kind: ModalEvent, e: Entry) => void>()
const emit = (kind: ModalEvent, e: Entry) => { for (const l of listeners) l(kind, e) }

const topActive = (): Entry | null => {
  for (let i = open.length - 1; i >= 0; i--) if (open[i].active()) return open[i]
  return null
}

/** What the title bar shows while a modal is open; null with none. */
export const modalNav = computed(() => {
  const e = topActive()
  return e ? { canBack: true, canForward: e.canForward.value } : null
})

/** A modal's page, with the pages of its parts that are showing. */
interface Snap { own: unknown; parts: Record<string, unknown> }
const keyOf = (s: Snap) =>
  JSON.stringify([s.own ?? null, Object.keys(s.parts).sort().map(k => [k, s.parts[k]])])
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Whether going from `a` to `b` is a step of yours: a page that was already
 * known changed. A page becoming known (loaded), or a part appearing or going
 * away (mounting with its page, unmounting with it), is not.
 */
const isStep = (a: Snap, b: Snap) =>
  (a.own !== undefined && b.own !== undefined && !same(a.own, b.own)) ||
  Object.keys(b.parts).some(k => k in a.parts && !same(a.parts[k], b.parts[k]))

const HOST: InjectionKey<ModalHistory<unknown>> = Symbol('modal-history')

export const useModalHistory = <S>(opts: ModalHistoryOptions<S>): ModalHistory<S> => {
  const active = opts.active ?? (() => true)
  const parts = shallowReactive(new Map<string, PartOptions<unknown>>())
  /** Pages for parts that are not mounted yet, handed over when they mount. */
  const pending = new Map<string, unknown>()

  const snap = (): Snap => {
    const p: Record<string, unknown> = {}
    for (const [id, part] of parts) {
      const v = part.read()
      if (v !== undefined) p[id] = v
    }
    return { own: opts.read?.(), parts: p }
  }
  const withPending = (s: Snap): Snap =>
    pending.size ? { own: s.own, parts: { ...Object.fromEntries(pending), ...s.parts } } : s

  const history = createNavHistory<Snap>(keyOf)
  const canForward = ref(false)
  const sync = () => { canForward.value = history.canForward }
  let last = snap()
  history.replace(last)
  /** Showing a page from the history: what changes on the way is not a step. */
  let stepping = 0
  let quiet = 0

  watch(() => keyOf(snap()), () => {
    const next = snap()
    const prev = last
    last = next
    if (stepping) return
    if (!quiet && isStep(prev, next)) {
      pending.clear()
      history.push(next)
      emit('step', entry)
    } else {
      history.replace(withPending(next))
    }
    sync()
  })

  const show = (s: Snap) => {
    stepping++
    if (s.own !== undefined) opts.go?.(s.own as S)
    pending.clear()
    for (const [id, v] of Object.entries(s.parts)) {
      const part = parts.get(id)
      if (part) part.go(v)
      else pending.set(id, v)
    }
    sync()
    // After the watcher has seen the change.
    void nextTick(() => { stepping--; last = snap() })
  }

  const back = () => {
    const s = history.back()
    if (s) show(s)
    else opts.close()
  }
  const forward = () => {
    const s = history.forward()
    if (!s) return false
    show(s)
    return true
  }
  const quietly = (fn: () => void) => {
    quiet++
    try { fn() } finally { void nextTick(() => { quiet-- }) }
  }
  const backOrBy = <T>(pick: (s: Snap) => unknown) => (matches: (prev: T) => boolean, fallback: () => void) => {
    const prev = history.peekBack()
    const v = prev ? pick(prev) : undefined
    if (v !== undefined && matches(v as T)) back()
    else quietly(fallback)
  }

  const part = <P>(id: string, p: PartOptions<P>): PartHandle<P> => {
    const held = p as PartOptions<unknown>
    parts.set(id, held)
    if (pending.has(id)) {
      const v = pending.get(id)
      pending.delete(id)
      p.go(v as P)
    }
    return {
      stop: () => { if (parts.get(id) === held) parts.delete(id) },
      backOr: backOrBy<P>(s => s.parts[id]),
      quietly,
    }
  }

  const api: ModalHistory<S> = { back, forward, backOr: backOrBy<S>(s => s.own), quietly, part }
  const entry: Entry = { el: opts.el, active, back, forward, canForward }
  open.push(entry)
  emit('open', entry)
  onScopeDispose(() => {
    const i = open.indexOf(entry)
    if (i >= 0) open.splice(i, 1)
    emit('close', entry)
  })
  if (getCurrentInstance()) provide(HOST, api as ModalHistory<unknown>)
  return api
}

/** A page inside a modal page, with steps of its own. Outside a modal it does nothing. */
export const useModalPart = <P>(id: string, p: PartOptions<P>): PartHandle<P> => {
  const host = inject(HOST, null)
  if (!host) return { stop() {}, backOr: (_m, fallback) => fallback(), quietly: fn => fn() }
  const handle = host.part(id, p)
  onScopeDispose(handle.stop)
  return handle
}

/**
 * Back or forward from outside the page's own buttons. True when something
 * open on top used it — then the app behind must not move.
 */
export const navigateModals = (dir: 'back' | 'forward', doc: Document = document): boolean => {
  // A modal on its way out is still on screen for its leave; it is not on top any more.
  const leaving = open.filter(e => !e.active()).map(e => e.el()).filter((x): x is Element => !!x)
  const showing = Array.from(doc.querySelectorAll(OVERLAY_SELECTOR)).filter(el =>
    el.getClientRects().length > 0 && !leaving.some(l => l === el || l.contains(el)))
  const top = showing[showing.length - 1]
  const entry = top ? open.find(e => e.active() && e.el() === top) : topActive()
  if (entry) {
    if (dir === 'back') entry.back()
    else entry.forward()
    return true
  }
  if (!top) return false
  // A menu or popup: back closes it the way it already closes, on Escape.
  if (dir === 'back') top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  return true
}

/**
 * In a browser tab, the browser's own back and forward (its buttons, the
 * mouse's, Alt+Left) work the same way. The client has no history of its own
 * there — a conversation is not a history entry, so back with no modal open
 * leaves Skycord as it always has — so each modal, and each page in one, is
 * given an entry, and taken back off when the modal closes some other way.
 *
 * Not inside the Windows, Linux or Android app: they hand back and forward to
 * the page themselves (desktopTitleBar.ts, ChatApp's Android back).
 */
export const installBrowserModalHistory = (win: Window = window): (() => void) => {
  if (appBridge()) return () => {}
  const h = win.history
  const posOf = (s: unknown) => {
    const n = (s as { skycordModal?: unknown } | null)?.skycordModal
    return typeof n === 'number' ? n : 0
  }
  let pos = posOf(h.state)
  /** Where the browser was before each modal's first entry. */
  const bases = new WeakMap<Entry, number>()
  /** A traversal of ours under way; its popstate is not a press. */
  let expect: number | null = null
  let unwindTo: number | null = null
  let replaying = false

  // A browser skips entries added before the page was ever touched — and the
  // entry under them with them — so none are added until then.
  const touched = () =>
    (win.navigator as { userActivation?: { hasBeenActive?: boolean } } | undefined)?.userActivation?.hasBeenActive !== false

  const traverseTo = (to: number) => {
    if (to === pos) return
    const n = to - pos
    expect = to
    pos = to
    h.go(n)
  }

  const onModal = (kind: ModalEvent, e: Entry) => {
    if (kind === 'close') {
      const base = bases.get(e)
      bases.delete(e)
      if (base === undefined || base >= pos || replaying) return
      // A modal opened while this one was up sits on its entries: they become its own.
      const later = open.filter(x => (bases.get(x) ?? -1) > base)
      if (later.length) {
        for (const x of later) bases.set(x, base)
        return
      }
      // Gathered over a microtask: a modal and the one it was opened over can close together.
      const first = unwindTo === null
      unwindTo = unwindTo === null ? base : Math.min(unwindTo, base)
      if (first) queueMicrotask(() => {
        const to = unwindTo
        unwindTo = null
        if (to !== null && to < pos) traverseTo(to)
      })
      return
    }
    if (kind === 'open' && unwindTo !== null) {
      // Opened as another closed (Edit Profile from a profile): it takes over that one's entries.
      const to = unwindTo
      unwindTo = null
      bases.set(e, to)
      if (pos > to + 1) traverseTo(to + 1)
      return
    }
    if (replaying || !touched()) return
    if (!bases.has(e)) bases.set(e, pos)
    pos += 1
    h.pushState({ skycordModal: pos }, '')
  }

  const onPop = (ev: PopStateEvent) => {
    const p = posOf(ev.state)
    if (expect !== null && p === expect) { expect = null; return }
    expect = null
    if (!topActive()) { pos = p; return }
    replaying = true
    try {
      while (p < pos && topActive()) { topActive()!.back(); pos -= 1 }
      while (p > pos) {
        const t = topActive()
        if (!t || !t.forward()) break
        pos += 1
      }
      if (p > pos) {
        // Nothing ahead in the modal: put the browser back where it was.
        expect = pos
        h.go(pos - p)
      } else if (p < pos) {
        // The modals closed on the way; the rest of the way was not theirs.
        pos = p
      }
    } finally {
      replaying = false
    }
  }

  listeners.add(onModal)
  win.addEventListener('popstate', onPop as EventListener)
  return () => {
    listeners.delete(onModal)
    win.removeEventListener('popstate', onPop as EventListener)
  }
}
