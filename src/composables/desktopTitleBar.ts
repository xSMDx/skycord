/**
 * The Windows app's title bar, fed from here: what is on screen, where back
 * and forward go, and the theme's colours. It runs only inside the app; in a
 * browser, `useDesktopTitleBar` returns at once and nothing changes.
 *
 * The bar itself is drawn by the app, so this sends plain values and the app
 * checks every one of them.
 */
import { watch, onScopeDispose, type ComputedRef } from 'vue'
import { desktopBridge } from './desktopBridge'

export type View = 'friends' | 'dm' | 'server' | 'group' | 'discover'
export interface Place { view: View; serverId: string | null; channelId: string | null; dmId: string | null; groupId: string | null }

export const placeKey = (p: Place): string => [p.view, p.serverId, p.channelId, p.dmId, p.groupId].map(x => x ?? '').join(':')

/** Places visited, browser-style: a new place after going back drops the way forward. */
export const createNavHistory = <T>(key: (entry: T) => string, limit = 50) => {
  let entries: T[] = []
  let at = -1
  return {
    push(entry: T) {
      if (at >= 0 && key(entries[at]) === key(entry)) { entries[at] = entry; return }
      entries = entries.slice(0, at + 1)
      entries.push(entry)
      if (entries.length > limit) entries.shift()
      at = entries.length - 1
    },
    back(): T | null { if (at <= 0) return null; at -= 1; return entries[at] },
    forward(): T | null { if (at >= entries.length - 1) return null; at += 1; return entries[at] },
    get canBack() { return at > 0 },
    get canForward() { return at < entries.length - 1 },
  }
}

export interface TitleInfo { title: string; kind: 'friends' | 'dms' | 'server' | 'discover'; icon: string | null }

const absolute = (src: string | undefined, origin: string) => {
  if (!src) return null
  try { return new URL(src, origin).href } catch { return null }
}

/**
 * What the bar says for each view: "# general · Sky Den" in a channel (no hash
 * for voice), the server alone before one is open, and "Direct Messages" for
 * DMs and groups, as in Discord.
 */
export const titleOf = (
  view: View,
  server: { name: string; img?: string } | null,
  channel: { name: string; type: 'text' | 'voice' } | null,
  origin: string,
): TitleInfo => {
  if (view === 'server' && server) {
    const title = channel ? `${channel.type === 'voice' ? '' : '# '}${channel.name} · ${server.name}` : server.name
    return { title, kind: 'server', icon: absolute(server.img, origin) }
  }
  if (view === 'dm' || view === 'group') return { title: 'Direct Messages', kind: 'dms', icon: null }
  if (view === 'discover') return { title: 'Discover', kind: 'discover', icon: null }
  return { title: 'Friends', kind: 'friends', icon: null }
}

/** A computed colour ("rgb(17, 18, 20)") as #rrggbb, or null. */
export const toHex = (rgb: string): string | null => {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb)
  return m ? `#${[m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('')}` : null
}

/** A token's actual colour, whatever it is written as (var(), color-mix(), a theme's own). */
const resolve = (token: string): string | null => {
  const probe = document.createElement('span')
  probe.style.cssText = `display:none;color:var(${token})`
  document.body.append(probe)
  const hex = toHex(getComputedStyle(probe).color)
  probe.remove()
  return hex
}

export const useDesktopTitleBar = (opts: {
  place: ComputedRef<Place>
  server: ComputedRef<{ name: string; img?: string } | null>
  channel: ComputedRef<{ name: string; type: 'text' | 'voice' } | null>
  /** Go to a place; false if it no longer exists (a server left, a DM gone). */
  go(place: Place): Promise<boolean>
}): void => {
  const bridge = desktopBridge()
  const bar = bridge?.titleBar
  if (!bridge || !bar) return

  const history = createNavHistory<Place>(placeKey)
  // While stepping back or forward, the places passed on the way aren't visits.
  let stepping = false

  const report = () => bar.update({
    ...titleOf(opts.place.value.view, opts.server.value, opts.channel.value, location.origin),
    canBack: history.canBack,
    canForward: history.canForward,
  })
  watch(opts.place, p => { if (!stepping) history.push(p); report() }, { immediate: true })
  // A rename, or a new icon, while you're there.
  watch([opts.server, opts.channel], report)

  const step = async (dir: 'back' | 'forward') => {
    if (stepping) return
    stepping = true
    try {
      // Skip places that are gone, in the same direction.
      for (let p = dir === 'back' ? history.back() : history.forward(); p; p = dir === 'back' ? history.back() : history.forward()) {
        if (await opts.go(p)) break
      }
    } finally {
      stepping = false
      report()
    }
  }
  const stopNav = bridge.onNavigate?.(dir => void step(dir))

  // Alt+Left / Alt+Right, as in Discord — but never while typing.
  const onKey = (e: KeyboardEvent) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) return
    e.preventDefault()
    void step(e.key === 'ArrowLeft' ? 'back' : 'forward')
  }
  window.addEventListener('keydown', onKey)

  // The bar takes the rail's colour; the window's own buttons, the text's.
  let sent = ''
  const sendColors = () => {
    const b = resolve('--bg-floor'), t = resolve('--text-1'), m = resolve('--text-3')
    if (!b || !t || !m || `${b}${t}${m}` === sent) return
    sent = `${b}${t}${m}`
    bar.colors({ bar: b, text: t, muted: m })
  }
  const observer = new MutationObserver(sendColors)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
  sendColors()

  onScopeDispose(() => {
    stopNav?.()
    window.removeEventListener('keydown', onKey)
    observer.disconnect()
  })
}
