/**
 * The Android app's page shim (android/app/src/main/assets/bridge/app-shim.js), run as the app injects
 * it, on a stand-in page: a window holding the app's message port, a location, nothing else. What it
 * posts to the app is what the app would receive.
 *
 * Covered here: a chat attachment's Download link. WebView does nothing with an <a download> click, so
 * the shim takes the click and passes the address and the link's name to the app.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const SHIM = readFileSync(fileURLToPath(new URL('../app/src/main/assets/bridge/app-shim.js', import.meta.url)), 'utf8')

const ORIGIN = 'https://chat.example.com'
const KEY = 'Qm9vbXNoYWthbGFrYTEyMw' // 22 characters of base64url, as the server makes them

type Message = { type: string; method?: string; args?: unknown[] }
type Listener = { type: string; fn: (event: unknown) => void; capture: unknown }

/** The shim on a page of [origin]; [port] false is a page the app gave no port (any other site). */
const load = (origin = ORIGIN, port = true) => {
  const posted: Message[] = []
  const listeners: Listener[] = []
  const window: Record<string, unknown> = {
    addEventListener: (type: string, fn: (event: unknown) => void, capture: unknown) => listeners.push({ type, fn, capture }),
  }
  if (port) window.__skycordPort = { postMessage: (s: string) => posted.push(JSON.parse(s)), onmessage: null }
  vm.runInContext(SHIM, vm.createContext({ window, location: { href: `${origin}/channels/1`, origin }, URL }))
  const downloads = () => posted.filter(m => m.type === 'call' && m.method === 'download').map(m => m.args)
  return { listeners, downloads }
}

/** An element under the finger; [link] is the <a> it sits in, with these attributes, or none. */
const clickOn = (shim: ReturnType<typeof load>, link: Record<string, string> | null) => {
  let prevented = false
  const anchor = link && { getAttribute: (name: string) => link[name] ?? null }
  const target = { closest: (selector: string) => (selector === 'a[download]' && link && 'download' in link ? anchor : null) }
  const event = { target, preventDefault: () => { prevented = true } }
  for (const l of shim.listeners) if (l.type === 'click') l.fn(event)
  return prevented
}

describe("the Android app's page shim: attachment downloads", () => {
  it('listens for clicks on window, in the capture phase, before the page', () => {
    const shim = load()
    const clicks = shim.listeners.filter(l => l.type === 'click')
    expect(clicks).toHaveLength(1)
    expect(clicks[0].capture).toBe(true)
  })

  it("takes a file card's Download and hands the app the address and the name", () => {
    const shim = load()
    const prevented = clickOn(shim, { href: `/messages/attachments/${KEY}/notes.pdf`, download: 'notes.pdf' })
    expect(prevented).toBe(true)
    expect(shim.downloads()).toEqual([[`${ORIGIN}/messages/attachments/${KEY}/notes.pdf`, 'notes.pdf']])
  })

  it("takes the large view's Download, a full address with an encoded name", () => {
    const shim = load()
    const href = `${ORIGIN}/messages/attachments/${KEY}/caf%C3%A9%20menu.png`
    expect(clickOn(shim, { href, download: 'café menu.png' })).toBe(true)
    expect(shim.downloads()).toEqual([[href, 'café menu.png']])
  })

  it('passes an empty name when the link names none (the app then reads it from the address)', () => {
    const shim = load()
    expect(clickOn(shim, { href: `/messages/attachments/${KEY}/notes.pdf`, download: '' })).toBe(true)
    expect(shim.downloads()).toEqual([[`${ORIGIN}/messages/attachments/${KEY}/notes.pdf`, '']])
  })

  it("leaves another site's download link alone", () => {
    const shim = load()
    expect(clickOn(shim, { href: `https://evil.example.com/messages/attachments/${KEY}/x.pdf`, download: 'x.pdf' })).toBe(false)
    expect(clickOn(shim, { href: `http://chat.example.com/messages/attachments/${KEY}/x.pdf`, download: 'x.pdf' })).toBe(false)
    expect(shim.downloads()).toEqual([])
  })

  it('leaves every other path on the server alone', () => {
    const shim = load()
    for (const href of [
      '/music/tracks/1/stream',
      '/messages/attachments',
      `/messages/attachments/${KEY}`,
      `/messages/attachments/${KEY}/`,
      `/messages/attachments/${KEY}/a/b`,
      '/messages/attachments/a.b/notes.pdf',
      'blob:https://chat.example.com/6f1c2a8e-0000-4000-8000-000000000000',
      'data:text/plain,hi',
      'javascript:alert(1)',
    ]) expect(clickOn(shim, { href, download: 'x' }), href).toBe(false)
    expect(shim.downloads()).toEqual([])
  })

  it('leaves a link without the download attribute alone, and a click on nothing', () => {
    const shim = load()
    expect(clickOn(shim, { href: `/messages/attachments/${KEY}/notes.pdf` })).toBe(false)
    expect(clickOn(shim, null)).toBe(false)
    for (const l of shim.listeners) expect(() => l.fn({ target: null, preventDefault: () => {} })).not.toThrow()
    expect(shim.downloads()).toEqual([])
  })

  it('does nothing on a page the app gave no port', () => {
    expect(load('https://evil.example.com', false).listeners).toEqual([])
  })
})
