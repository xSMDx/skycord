import { describe, it, expect, vi, beforeEach } from 'vitest'

// The test environment is Node, with no localStorage. An in-memory one,
// installed before the modules under test load.
vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
  }
})

import { webSink, pickSink } from '../notificationSinks'
import { notificationPrefs, setNotificationPref } from '../notificationPrefs'
import type { Notice } from '../notifyRules'

const notice: Notice = {
  id: 'msg:1', kind: 'message', conversation: { kind: 'dm', id: 'ana' }, title: 'Ana', body: 'hi',
  icon: null, group: { id: 'dm:ana', title: 'Ana' }, canReply: true,
}

/** A stand-in for the browser's Notification, recording what was shown. */
const fakeNotification = (permission: NotificationPermission, answer: NotificationPermission = permission) => {
  const shown: { title: string; opts: NotificationOptions; inst: any }[] = []
  const N: any = function (this: any, title: string, opts: NotificationOptions) {
    this.close = vi.fn(); shown.push({ title, opts, inst: this })
  }
  N.permission = permission
  N.requestPermission = vi.fn(async () => { N.permission = answer; return answer })
  return { N, shown }
}

const settle = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => { localStorage.clear(); setNotificationPref('asked', false) })

describe('web notifications', () => {
  it('shows one when permission is granted, tagged per conversation, silent', async () => {
    const { N, shown } = fakeNotification('granted')
    webSink({ Notification: N }).show(notice)
    await settle()
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ title: 'Ana', opts: { body: 'hi', tag: 'dm:ana', silent: true } })
  })

  it('asks once, on its own, the first time — never again', async () => {
    // Closing the prompt without choosing leaves permission at 'default': only
    // the asked-once flag stops a second prompt then.
    const { N, shown } = fakeNotification('default', 'default')
    const sink = webSink({ Notification: N })
    sink.show(notice); await settle()
    sink.show(notice); await settle()
    expect(N.requestPermission).toHaveBeenCalledTimes(1)
    expect(shown).toHaveLength(0)
    expect(notificationPrefs.asked).toBe(true)
  })

  it('a click focuses the window and reports which notice', async () => {
    const { N, shown } = fakeNotification('granted')
    const focus = vi.fn()
    const sink = webSink({ Notification: N, focus })
    const got: unknown[] = []
    sink.onActivated(a => got.push(a))
    sink.show(notice); await settle()
    shown[0].inst.onclick()
    expect(focus).toHaveBeenCalled()
    expect(got).toEqual([{ type: 'click', notice: { id: 'msg:1', conversation: { kind: 'dm', id: 'ana' } } }])
  })

  it('does nothing at all without the Notification API', () => {
    expect(() => webSink({}).show(notice)).not.toThrow()
  })
})

describe('choosing where notifications go', () => {
  it('the desktop app when it has the bridge, the browser otherwise', () => {
    const show = vi.fn()
    const bridge: any = { platform: 'win32', notifications: {
      show, ring: vi.fn(), unread: vi.fn(), callState: vi.fn(),
      onActivated: () => () => {}, onCallAction: () => () => {}, onTrayCommand: () => () => {},
      keepInTray: async () => true, setKeepInTray: vi.fn(),
    } }
    const desktop = pickSink(bridge)
    expect(desktop.kind).toBe('desktop')
    desktop.show(notice)
    expect(show).toHaveBeenCalledWith(notice)
    expect(pickSink({ platform: 'win32' } as any).kind).toBe('web')   // an older app build
    expect(pickSink(null).kind).toBe('web')
  })
})

describe('whether the window is in front', () => {
  it('the app says, because only it knows', () => {
    // Inside the desktop app the page reports focus and visibility as true
    // even when the window is hidden in the tray — the shell is the truth.
    let tell: ((v: boolean) => void) | null = null
    const bridge: any = { platform: 'win32', notifications: {
      show: vi.fn(), ring: vi.fn(), unread: vi.fn(), callState: vi.fn(),
      onActivated: () => () => {}, onCallAction: () => () => {}, onTrayCommand: () => () => {},
      onWindowFocus: (cb: (v: boolean) => void) => { tell = cb; return () => {} },
      keepInTray: async () => true, setKeepInTray: vi.fn(),
    } }
    const got: boolean[] = []
    pickSink(bridge).onWindowFocus(v => got.push(v))
    tell!(false); tell!(true)
    expect(got).toEqual([false, true])
  })
  it('a browser has nothing to say: the page asks the document itself', () => {
    const got: boolean[] = []
    webSink({}).onWindowFocus(v => got.push(v))
    expect(got).toEqual([])
  })
})

describe('prefs', () => {
  it('default on, and remembered on this device', () => {
    expect(notificationPrefs.enabled).toBe(true)
    expect(notificationPrefs.previews).toBe(true)
    setNotificationPref('previews', false)
    expect(JSON.parse(localStorage.getItem('skycord_notifications')!)).toMatchObject({ previews: false })
    setNotificationPref('previews', true)
  })
})
