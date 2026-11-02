/**
 * Moving a song up or down your own queue, from the drawer.
 *
 * Two halves. The top of this file is arithmetic: which slot a held row is
 * over, how far the others step aside, where it comes to rest, how fast the
 * drawer scrolls near an edge. It is pure and unit-tested, because it is the
 * part that is easy to get subtly wrong and impossible to watch in a node test
 * runner. The bottom is the DOM glue that feeds it pointer positions.
 *
 * The behaviour, and why:
 *
 *   The handle, and only the handle   picks a song up. It carries touch-action:
 *                     none, so a finger on it drags the song and a finger
 *                     anywhere else scrolls the drawer: the drag never fights
 *                     the list's scroll, and needs no hold-to-start delay.
 *
 *   Pointer capture   keeps the drag alive once the finger leaves the handle,
 *                     which it does at once.
 *
 *   1:1, then a rubber band   The row follows the finger exactly, lifted, and
 *                     the others slide aside to show where it will land. Past
 *                     either end of your queue it resists — the sheets' rubber
 *                     band — rather than stopping dead.
 *
 *   Auto-scroll       Near the drawer's top or bottom edge the drawer scrolls
 *                     by itself, faster the closer the finger is, but only
 *                     toward more of your queue: never off into the playlist.
 *
 *   Land, then commit  On release the row glides into its slot, and only then
 *                     does the queue change. By then every row already sits
 *                     where the new order puts it, so the reorder itself moves
 *                     nothing on screen.
 *
 *   Give it back      Escape, a cancelled pointer, or a tap that never moved
 *                     puts the song back where it was. So does the queue
 *                     changing underneath — the song ending and the next one
 *                     leaving the queue to play: a drag never commits against
 *                     a list it did not start on.
 *
 *   Keys              ArrowUp and ArrowDown on a focused handle move the song
 *                     one place, instantly — a key press is never animated —
 *                     and focus stays on it.
 */
import { shallowRef, watch, nextTick, onBeforeUnmount, type Ref, type ShallowRef } from 'vue'
import { rubber } from './sheetDrag'

// ── the arithmetic ──────────────────────────────────────────────────────────

/** A row as measured when a song is picked up: its top and height, in the list's own coordinates. */
export interface Slot { top: number; height: number }
/** A vertical extent on screen. A DOMRect is one. */
export interface Span { top: number; bottom: number }

/**
 * The index a held row would land at, for its centre at `y`: one place past
 * every other row whose centre it has passed. So it swaps with a neighbour
 * exactly when it covers half of it, and however far past either end it is
 * taken, it lands first or last.
 */
export const dropIndex = (centres: readonly number[], from: number, y: number): number => {
  let to = 0
  for (let i = 0; i < centres.length; i++) if (i !== from && centres[i] < y) to++
  return to
}

/**
 * How far row `i` steps aside while the held row (from `from`) is over `to`:
 * the rows it has passed move one place toward where it came from.
 */
export const shiftFor = (i: number, from: number, to: number, pitch: number): number => {
  if (from < to && i > from && i <= to) return -pitch
  if (to < from && i >= to && i < from) return pitch
  return 0
}

/** One place, for the rows stepping aside: the held row's height and the gap after it. */
export const pitchOf = (slots: readonly Slot[], from: number): number => {
  const gap = slots.length > 1 ? slots[1].top - (slots[0].top + slots[0].height) : 0
  return slots[from].height + gap
}

/**
 * Where the held row is drawn, relative to where it was picked up, for a
 * finger that has moved `raw` px: exactly there anywhere level with the list,
 * and resisting past either end — never more than its own height further.
 */
export const heldOffset = (raw: number, slots: readonly Slot[], from: number): number => {
  const me = slots[from]
  const first = slots[0]
  const last = slots[slots.length - 1]
  const min = first.top - me.top
  const max = last.top + last.height - (me.top + me.height)
  if (raw < min) return min - rubber(min - raw, me.height)
  if (raw > max) return max + rubber(raw - max, me.height)
  return raw
}

/**
 * Where the held row comes to rest, relative to where it was picked up, once
 * it lands at `to`: the top of the slot it is taking going up, the bottom of
 * it going down — right for rows of any height.
 */
export const restOffset = (slots: readonly Slot[], from: number, to: number): number => {
  if (to > from) return slots[to].top + slots[to].height - (slots[from].top + slots[from].height)
  if (to < from) return slots[to].top - slots[from].top
  return 0
}

/** How close to an edge the drawer starts scrolling, px. */
export const EDGE_ZONE = 56
/** The fastest it scrolls, px/s: at the edge and past it. */
export const EDGE_SPEED = 900

/**
 * The drawer's own scroll while a song is held, px/s, negative for up.
 *
 * Still in the middle, ramping up within EDGE_ZONE of an edge, full speed at
 * the edge and past it. Only toward more of your queue: if that end of the
 * list is already in view, there is nothing to scroll to. A short drawer is
 * not all edge — the zone is at most a third of it.
 */
export const autoScrollSpeed = (
  y: number,
  view: Span,
  list: Span,
  zone = EDGE_ZONE,
  max = EDGE_SPEED,
): number => {
  const z = Math.max(1, Math.min(zone, (view.bottom - view.top) / 3))
  if (y < view.top + z && list.top < view.top) return -max * Math.min(1, (view.top + z - y) / z)
  if (y > view.bottom - z && list.bottom > view.bottom) return max * Math.min(1, (y - (view.bottom - z)) / z)
  return 0
}

/** Where an arrow key on a focused handle sends the song. The same index at an end; null for any other key. */
export const keyTarget = (key: string, index: number, count: number): number | null => {
  if (key === 'ArrowUp') return Math.max(0, index - 1)
  if (key === 'ArrowDown') return Math.min(count - 1, index + 1)
  return null
}

/** What a screen reader hears after a move. */
export const movedSaid = (to: number, count: number): string => `Moved to position ${to + 1} of ${count}`

/**
 * Row keys for a queue that can hold one song twice: the id, and which copy
 * it is. A key that travels with its song means a move moves that row's
 * element — cover and all — rather than refilling every row in between.
 */
export const stableKeys = (ids: readonly string[]): string[] => {
  const seen = new Map<string, number>()
  return ids.map(id => {
    const n = seen.get(id) ?? 0
    seen.set(id, n + 1)
    return `${id}#${n}`
  })
}

/** A motion token's value ("180ms", ".2s") in ms; 0 for anything else. */
export const toMs = (value: string): number => {
  const v = value.trim()
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return 0
  return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : 0
}

// ── the drag ────────────────────────────────────────────────────────────────

export interface QueueDragOptions {
  /** The <ol> your queued songs are rows of. */
  list: Ref<HTMLElement | null>
  /** What scrolls: the drawer the list sits in. */
  scroller: () => HTMLElement | null
  /** Your queue as the player holds it. Counted, and watched: if it changes mid-drag, the drag is off. */
  items: () => readonly unknown[]
  /** Commit a move. */
  move: (from: number, to: number) => void
  /** Tell a screen reader what happened. */
  say: (message: string) => void
}

/** The row being held, for the template: lifted while the finger is down, then landing. */
export interface Held { index: number; phase: 'drag' | 'settle' }

interface Drag {
  rows: HTMLElement[]
  slots: Slot[]
  centres: number[]
  pitch: number
  from: number
  to: number
  offset: number
  pointerId: number
  startY: number
  lastY: number
  startScroll: number
  /** The song picked up, and how many there were, to check the queue is still the one this drag began on. */
  grabbed: unknown
  count: number
}

export const useQueueDrag = (o: QueueDragOptions): {
  held: ShallowRef<Held | null>
  onGripDown: (e: PointerEvent, index: number) => void
  onGripMove: (e: PointerEvent) => void
  onGripUp: (e: PointerEvent) => void
  onGripCancel: (e: PointerEvent) => void
  onGripKey: (e: KeyboardEvent, index: number) => void
} => {
  const held = shallowRef<Held | null>(null)
  let d: Drag | null = null
  let raf = 0
  let lastFrame = 0
  /** Sub-pixel scroll owed: scrollTop rounds, and a slow edge would otherwise never move. */
  let carry = 0
  let landing: ReturnType<typeof setTimeout> | null = null

  /*
   * Rows are moved with the `translate` property, written straight to the
   * element: a drag repaints at the pointer's rate, and routing that through
   * the modal's render would re-render the whole library behind the drawer on
   * every move. `translate` rather than `transform`, so it composes with the
   * lift's `scale` instead of being scaled by it — the row stays under the
   * finger to the pixel. Vue never binds these rows' style, so it never
   * fights the writes.
   */
  const place = (el: HTMLElement | undefined, y: number): void => {
    if (el) el.style.translate = y ? `0 ${y}px` : ''
  }

  const placeOthers = (g: Drag): void => {
    g.rows.forEach((r, i) => { if (i !== g.from) place(r, shiftFor(i, g.from, g.to, g.pitch)) })
  }

  /** Draw the held row under the finger, and step the others aside if it has crossed into a new slot. */
  const follow = (g: Drag): void => {
    const scrolled = (o.scroller()?.scrollTop ?? g.startScroll) - g.startScroll
    const offset = heldOffset(g.lastY - g.startY + scrolled, g.slots, g.from)
    if (offset !== g.offset) { g.offset = offset; place(g.rows[g.from], offset) }
    const to = dropIndex(g.centres, g.from, g.centres[g.from] + offset)
    if (to !== g.to) { g.to = to; placeOthers(g) }
  }

  /*
   * Every frame while the finger is down: scroll near an edge, then follow.
   * Following every frame, not just on pointermove, keeps the row under a
   * finger that is holding still while the drawer scrolls beneath it — by
   * this loop, or by a mouse wheel turned mid-drag.
   */
  const tick = (now: number): void => {
    raf = 0
    const g = d
    if (!g || held.value?.phase !== 'drag') return
    const list = o.list.value
    if (!list?.isConnected) { clear(); return }
    const sc = o.scroller()
    if (sc) {
      const v = autoScrollSpeed(g.lastY, sc.getBoundingClientRect(), list.getBoundingClientRect())
      // Capped, so a frame delayed by a busy tab does not fling the list.
      carry = v ? carry + (v * Math.min(50, now - lastFrame)) / 1000 : 0
      const step = Math.trunc(carry)
      if (step) { sc.scrollTop += step; carry -= step }
    }
    lastFrame = now
    follow(g)
    raf = requestAnimationFrame(tick)
  }

  const stopFollowing = (): void => {
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    window.removeEventListener('keydown', onEscape, true)
  }

  /** End everything at once: no glide, no move. The rows go back to where the list lays them. */
  const clear = (): void => {
    stopFollowing()
    if (landing) { clearTimeout(landing); landing = null }
    d?.rows.forEach(r => place(r, 0))
    d = null
    held.value = null
  }

  /*
   * The row is in its slot. Commit, in the same tick as the inline offsets
   * come off and the held classes go: the render that reorders the list and
   * the frame that drops the offsets are the same frame, so nothing jumps.
   */
  const land = (): void => {
    landing = null
    const g = d
    if (!g) return
    const items = o.items()
    const unchanged = items.length === g.count && items[g.from] === g.grabbed
    clear()
    if (g.to !== g.from && unchanged) {
      o.move(g.from, g.to)
      o.say(movedSaid(g.to, g.count))
    }
  }

  /** Let go of the song: it glides to slot `to` (its own slot, to give it back), then lands. */
  const settle = (to: number): void => {
    const g = d
    if (!g) return
    g.to = to
    stopFollowing()
    held.value = { index: g.from, phase: 'settle' }
    // After the render that puts the list into its settling state, so the
    // glide has its transition to run on.
    void nextTick(() => {
      if (d !== g) return
      placeOthers(g)
      place(g.rows[g.from], restOffset(g.slots, g.from, g.to))
      // The token, read live: halved by the Balanced motion setting, and 1ms
      // under reduced motion or Off, where the glide is a snap.
      const glide = toMs(getComputedStyle(document.documentElement).getPropertyValue('--dur-2'))
      landing = setTimeout(land, glide)
    })
  }

  /*
   * In the capture phase on the window, so it is heard before the modal's own
   * Escape — which would close the whole music room — and stopped there.
   * Only while a finger is down: once the song is landing, Escape is the
   * modal's again.
   */
  function onEscape(e: KeyboardEvent): void {
    if (e.key === 'Escape' && held.value?.phase === 'drag') {
      e.preventDefault()
      e.stopPropagation()
      settle(d?.from ?? 0)
    }
  }

  const onGripDown = (e: PointerEvent, index: number): void => {
    // One song at a time: a second finger, a press while the last song is
    // still landing, and anything but the main button are ignored.
    if (d || !e.isPrimary || e.button !== 0) return
    const list = o.list.value
    const sc = o.scroller()
    const items = o.items()
    if (!list || !sc) return
    const rows = Array.from(list.children) as HTMLElement[]
    if (!rows[index] || rows.length !== items.length) return
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      return
    }
    // offsetTop and offsetHeight ignore transforms, so a row still easing
    // back from a lift measures where it really is.
    const slots = rows.map(r => ({ top: r.offsetTop, height: r.offsetHeight }))
    d = {
      rows, slots,
      centres: slots.map(s => s.top + s.height / 2),
      pitch: pitchOf(slots, index),
      from: index, to: index, offset: 0,
      pointerId: e.pointerId,
      startY: e.clientY, lastY: e.clientY,
      startScroll: sc.scrollTop,
      grabbed: items[index], count: items.length,
    }
    carry = 0
    lastFrame = performance.now()
    window.addEventListener('keydown', onEscape, true)
    raf = requestAnimationFrame(tick)
    held.value = { index, phase: 'drag' }
  }

  const onGripMove = (e: PointerEvent): void => {
    const g = d
    if (!g || held.value?.phase !== 'drag' || e.pointerId !== g.pointerId) return
    g.lastY = e.clientY
    follow(g)
  }

  const onGripUp = (e: PointerEvent): void => {
    const g = d
    if (!g || held.value?.phase !== 'drag' || e.pointerId !== g.pointerId) return
    g.lastY = e.clientY
    follow(g)
    settle(g.to)
  }

  /** A cancelled pointer, or capture lost to something else: the song goes back. After a release this is a no-op. */
  const onGripCancel = (e: PointerEvent): void => {
    const g = d
    if (!g || held.value?.phase !== 'drag' || e.pointerId !== g.pointerId) return
    settle(g.from)
  }

  const onGripKey = (e: KeyboardEvent, index: number): void => {
    // While a pointer holds a song, the pointer owns the queue.
    if (d) return
    const n = o.items().length
    const to = keyTarget(e.key, index, n)
    if (to === null) return
    e.preventDefault()
    if (to === index) {
      o.say(n === 1 ? 'The only song in your queue' : index === 0 ? 'Already first in your queue' : 'Already last in your queue')
      return
    }
    o.move(index, to)
    o.say(movedSaid(to, n))
    // The row moved; the focus goes with it, so the next arrow moves it again.
    void nextTick(() => { o.list.value?.querySelectorAll<HTMLElement>('[data-qgrip]')[to]?.focus() })
  }

  // The queue changed underneath — a song ended and the next left the queue
  // to play, or a song was removed. Indices no longer mean what they did.
  watch(o.items, () => { if (d) clear() })
  // The drawer closed mid-drag.
  watch(o.list, el => { if (!el && d) clear() })
  onBeforeUnmount(clear)

  return { held, onGripDown, onGripMove, onGripUp, onGripCancel, onGripKey }
}
