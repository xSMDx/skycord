import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, effectScope, nextTick } from 'vue'
import { useDesktopTitleBar, type Place } from '../desktopTitleBar'

const at = (view: Place['view'], ids: Partial<Place> = {}): Place =>
  ({ view, serverId: null, channelId: null, dmId: null, groupId: null, ...ids })

const TOKENS: Record<string, string> = { '--bg-floor': 'rgb(17, 18, 20)', '--text-1': 'rgb(220, 221, 222)', '--text-3': 'rgb(171, 177, 184)' }
const g = globalThis as { skycordDesktop?: unknown }
let nav: ((dir: 'back' | 'forward') => void) | null
let update: ReturnType<typeof vi.fn>
let colors: ReturnType<typeof vi.fn>
const listeners = new Set<unknown>()

beforeEach(() => {
  nav = null
  update = vi.fn()
  colors = vi.fn()
  g.skycordDesktop = {
    platform: 'win32', changeInstance: async () => {},
    titleBar: { update, colors },
    onNavigate: (cb: (dir: 'back' | 'forward') => void) => { nav = cb; return () => { nav = null } },
  }
  vi.stubGlobal('location', { origin: 'https://den.example' })
  vi.stubGlobal('window', { addEventListener: (_t: string, f: unknown) => listeners.add(f), removeEventListener: (_t: string, f: unknown) => listeners.delete(f) })
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('document', {
    documentElement: {},
    body: { append: () => {} },
    createElement: () => ({ style: { cssText: '' }, remove: () => {} }),
  })
  vi.stubGlobal('getComputedStyle', (el: { style: { cssText: string } }) => ({ color: TOKENS[/var\((--[\w-]+)\)/.exec(el.style.cssText)![1]] }))
})
afterEach(() => { delete g.skycordDesktop; vi.unstubAllGlobals(); listeners.clear() })

const mount = (go: (p: Place) => Promise<boolean>) => {
  const place = ref(at('friends'))
  const server = ref<{ name: string; img?: string } | null>(null)
  const channel = ref<{ name: string; type: 'text' | 'voice' } | null>(null)
  const scope = effectScope()
  scope.run(() => useDesktopTitleBar({ place: computed(() => place.value), server: computed(() => server.value), channel: computed(() => channel.value), go }))
  return { place, server, channel, scope }
}
const last = () => update.mock.calls.at(-1)![0]

describe('useDesktopTitleBar', () => {
  it('reports the page at once, with nowhere to go yet', () => {
    mount(async () => true)
    expect(last()).toEqual({ title: 'Friends', kind: 'friends', icon: null, canBack: false, canForward: false })
  })

  it('names the channel and server, and offers back once you have moved', async () => {
    const { place, server, channel } = mount(async () => true)
    server.value = { name: 'Sky Den', img: '/i.png' }
    channel.value = { name: 'general', type: 'text' }
    place.value = at('server', { serverId: 's1', channelId: 'c1' })
    await nextTick()
    expect(last()).toMatchObject({ title: '# general · Sky Den', icon: 'https://den.example/i.png', canBack: true })
  })

  it('follows a channel renamed while you are in it', async () => {
    const { place, server, channel } = mount(async () => true)
    server.value = { name: 'Sky Den' }
    channel.value = { name: 'general', type: 'text' }
    place.value = at('server', { serverId: 's1', channelId: 'c1' })
    await nextTick()
    channel.value = { name: 'lobby', type: 'text' }
    await nextTick()
    expect(last().title).toBe('# lobby · Sky Den')
  })

  it('back goes where you were, and forward becomes possible', async () => {
    const { place } = mount(async p => { place.value = p; return true })
    place.value = at('dm', { dmId: 'd1' })
    await nextTick()
    nav!('back')
    await vi.waitFor(() => expect(last()).toMatchObject({ title: 'Friends', canBack: false, canForward: true }))
  })

  it('skips a place that is gone', async () => {
    const visited: Place[] = []
    const { place } = mount(async p => { visited.push(p); if (p.dmId === 'gone') return false; place.value = p; return true })
    place.value = at('discover')
    await nextTick()
    place.value = at('dm', { dmId: 'gone' })
    await nextTick()
    place.value = at('server', { serverId: 's1' })
    await nextTick()
    nav!('back')
    await vi.waitFor(() => expect(place.value.view).toBe('discover'))
    expect(visited.map(p => p.view)).toEqual(['dm', 'discover'])
  })

  it('sends the theme’s colours as hex, once', () => {
    mount(async () => true)
    expect(colors).toHaveBeenCalledTimes(1)
    expect(colors).toHaveBeenCalledWith({ bar: '#111214', text: '#dcddde', muted: '#abb1b8' })
  })

  it('stops listening when its scope ends', () => {
    const { scope } = mount(async () => true)
    expect(listeners.size).toBe(1)
    scope.stop()
    expect(listeners.size).toBe(0)
    expect(nav).toBeNull()
  })

  it('does nothing in a browser', () => {
    delete g.skycordDesktop
    mount(async () => true)
    expect(update).not.toHaveBeenCalled()
  })
})
