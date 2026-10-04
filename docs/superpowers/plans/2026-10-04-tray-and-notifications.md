# Tray and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skycord notifies you of DMs, group messages, mentions, calls and friend requests: as rich Windows toasts in the desktop app (with Reply and Mark as read), as web notifications in a browser, with an always-on-top call window, a tray that keeps the app running, and an unread badge.

**Architecture:** One pure module (`notifyRules.ts`) decides whether something becomes a notification and what it says. `useNotifications.ts` turns the decision into a `Notice` and hands it to a sink: the web Notification API, or the desktop shell through an optional `skycordDesktop.notifications` bridge. The shell renders toasts, the call window, the tray and the taskbar badge. Every interaction (click, reply, mark read, accept, decline, tray mute) flows back to the page, which already knows how to do each one.

**Tech Stack:** Vue 3 + TS client, Electron 44.4.3 shell (`desktop/`), Vitest, ffmpeg (asset generation only).

**Spec:** `docs/superpowers/specs/2026-10-04-tray-and-notifications-design.md`

## Global Constraints

- **What notifies:** DMs, group messages, server channel messages that mention you (`<@display name>` / `<@username>`, case-insensitive) or carry the server's `mentionsEveryone`, incoming DM/group calls, friend requests received or accepted.
- **Never:** your own messages; muted conversations (`isMuted`, timed mutes included); anything while your chosen status is `dnd`; anything while the window is focused.
- **Content:** the title is the sender, then `· group` or `· #channel · Server`. The body is `stripMarkers` text, one line, at most 200 characters, ending in `…` when cut. With previews off, the body is `New message`.
- **Bridge members are optional**: a server's page can meet an older installed app. Without `skycordDesktop.notifications` the page uses web notifications, which also work inside Electron.
- **Untrusted input:** everything the page sends the shell is checked there. Icons must be `data:image/png;base64,…`, at most 200 000 characters. The shell never fetches a URL a page names.
- **Windows needs `app.setAppUserModelId('xyz.skycord.desktop')`**, the `appId` in `desktop/electron-builder.yml`, before any toast.
- **Toasts are `silent: true`**: the page already plays its own sounds.
- **Electron 44 on Windows:** `hasReply`/`reply`, `actions`/`action`, `groupId`/`groupTitle` and `Notification.handleActivation` exist. `remove`, `removeAll` and `removeGroup` are macOS only, so on Windows `close()` each toast you keep a reference to.
- Design-system rules apply to any CSS: tokens only, `--dur-*` durations, an accent fill declares `--text-on-accent` in the same rule, 40 px touch targets under 768 px.
- Stage files by name; never `git add -A`. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit locally; push only on request.
- Tests: client `npx vitest run src/`, desktop `npx vitest run desktop/src/`; types `npx vue-tsc --noEmit` and `npx tsc --noEmit -p desktop/tsconfig.json`.

## File map

| File | Purpose |
|---|---|
| `src/composables/notifyRules.ts` (new) | `decide`, `mentionsMe`, `plainBody`, `unreadCount`, the `Notice` type |
| `src/composables/notificationPrefs.ts` (new) | per-device prefs: enabled, previews, asked-once |
| `src/composables/noticeIcon.ts` (new) | an avatar drawn into a 64 px round PNG data URL |
| `src/composables/notificationSinks.ts` (new) | `webSink`, `desktopSink`, `pickSink` |
| `src/composables/useNotifications.ts` (new) | `notify`, `ringFor`, `setUnread`, `setCallTray`, activations, channel mentions |
| `src/composables/desktopBridge.ts` | the optional `notifications` member's types |
| `src/views/ChatApp.vue` | wiring into the existing handlers |
| `src/components/settings/NotificationsPage.vue` (new) + `SettingsModal.vue` | Settings › Notifications |
| `desktop/src/notice.ts` (new, pure) | `parseNotice`, `parseRing`, `toastOptions` |
| `desktop/src/trayModel.ts` (new, pure) | `trayMenu`, `badgeAsset`, `trayAsset`, `closeAction` |
| `desktop/scripts/make-tray-assets.mjs` (new) + `desktop/static/tray/*.png` | tray and badge images |
| `desktop/src/toasts.ts`, `desktop/src/tray.ts` (new) | Electron glue for toasts, tray, taskbar |
| `desktop/src/callWindow.ts` (new) + `desktop/static/call.html` | the incoming-call window |
| `desktop/src/main.ts`, `desktop/src/preload.ts`, `desktop/src/store.ts` | IPC, bridge, close-to-tray, AppUserModelId |

---

### Task 1: The rules

**Files:**
- Create: `src/composables/notifyRules.ts`
- Test: `src/composables/__tests__/notifyRules.test.ts`

**Interfaces — produces:**

```ts
export type ConvRef = { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string }
export interface Notice {
  id: string; kind: 'message' | 'mention' | 'call' | 'friend'; conversation: ConvRef | null
  title: string; body: string; icon: string | null; group: { id: string; title: string } | null; canReply: boolean
}
export interface Me { id: string; displayName: string; username: string }
export interface RuleState { me: Me; status: 'online' | 'idle' | 'dnd' | 'invisible'; focused: boolean; enabled: boolean; previews: boolean; isMuted: (key: string) => boolean }
export type Incoming = /* dm | group | channel | friend | call, below */
export const BODY_MAX: 200
export const plainBody: (content: string, max?: number) => string
export const mentionsMe: (content: string, me: Me) => boolean
export const decide: (e: Incoming, s: RuleState) => Notice | null
export const unreadCount: (dms: { id: string; unread?: number }[], groups: { id: string; unread?: number }[], mentioned: Iterable<string>, isMuted: (key: string) => boolean) => number
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/composables/__tests__/notifyRules.test.ts
import { describe, it, expect } from 'vitest'
import { decide, mentionsMe, plainBody, unreadCount, BODY_MAX, type RuleState, type Incoming } from '../notifyRules'

const me = { id: 'me', displayName: 'Sam Doe', username: 'samd' }
const state = (over: Partial<RuleState> = {}): RuleState => ({
  me, status: 'online', focused: false, enabled: true, previews: true, isMuted: () => false, ...over,
})
const dm = (over: Partial<Extract<Incoming, { type: 'dm' }>> = {}): Incoming =>
  ({ type: 'dm', messageId: 'm1', partnerId: 'ana', authorId: 'ana', authorName: 'Ana', content: 'hi there', ...over })
const group = (over = {}): Incoming =>
  ({ type: 'group', messageId: 'm2', groupId: 'g1', groupName: 'Crew', authorId: 'ana', authorName: 'Ana', content: 'yo', ...over })
const channel = (over = {}): Incoming => ({
  type: 'channel', messageId: 'm3', channelId: 'c1', channelName: 'general', serverId: 's1', serverName: 'Home',
  authorId: 'ana', authorName: 'Ana', content: 'hello', mentionsEveryone: false, ...over,
})

describe('what notifies', () => {
  it('a DM, titled by the sender, grouped per conversation, repliable', () => {
    expect(decide(dm(), state())).toEqual({
      id: 'msg:m1', kind: 'message', conversation: { kind: 'dm', id: 'ana' },
      title: 'Ana', body: 'hi there', icon: null, group: { id: 'dm:ana', title: 'Ana' }, canReply: true,
    })
  })
  it('a group message names the group', () => {
    const n = decide(group(), state())!
    expect(n.title).toBe('Ana · Crew')
    expect(n.group).toEqual({ id: 'group:g1', title: 'Crew' })
    expect(n.conversation).toEqual({ kind: 'group', id: 'g1' })
  })
  it('a channel message only when it mentions you', () => {
    expect(decide(channel(), state())).toBeNull()
    const n = decide(channel({ content: 'ping <@Sam Doe> look' }), state())!
    expect(n.kind).toBe('mention')
    expect(n.title).toBe('Ana · #general · Home')
    expect(n.body).toBe('ping @Sam Doe look')
    expect(n.conversation).toEqual({ kind: 'channel', id: 'c1', serverId: 's1' })
  })
  it('@everyone counts when the server says it does', () => {
    expect(decide(channel({ content: '@everyone', mentionsEveryone: true }), state())).not.toBeNull()
    expect(decide(channel({ content: '@everyone', mentionsEveryone: false }), state())).toBeNull()
  })
  it('friend requests, received and accepted', () => {
    expect(decide({ type: 'friend', userId: 'ana', name: 'Ana', accepted: false }, state())).toMatchObject({
      kind: 'friend', title: 'Friend request', body: 'Ana sent you a friend request.', conversation: null, canReply: false,
    })
    expect(decide({ type: 'friend', userId: 'ana', name: 'Ana', accepted: true }, state())?.body).toBe('Ana accepted your friend request.')
  })
  it('an incoming call', () => {
    expect(decide({ type: 'call', room: 'dm:a_b', kind: 'dm', convId: 'ana', muteKey: 'ana', name: 'Ana' }, state())).toMatchObject({
      id: 'call:dm:a_b', kind: 'call', title: 'Ana', body: 'Incoming call', conversation: { kind: 'dm', id: 'ana' },
    })
  })
})

describe('what never notifies', () => {
  it('your own message', () => {
    expect(decide(dm({ authorId: 'me' }), state())).toBeNull()
    expect(decide(group({ authorId: 'me' }), state())).toBeNull()
    expect(decide(channel({ authorId: 'me', content: '<@samd>' }), state())).toBeNull()
  })
  it('a muted conversation, keyed the way mutes are keyed', () => {
    const muted = (key: string) => key === 'ana' || key === 'g1' || key === 'c1'
    expect(decide(dm(), state({ isMuted: muted }))).toBeNull()
    expect(decide(group(), state({ isMuted: muted }))).toBeNull()
    expect(decide(channel({ content: '<@samd>' }), state({ isMuted: muted }))).toBeNull()
    expect(decide({ type: 'call', room: 'r', kind: 'dm', convId: 'ana', muteKey: 'ana', name: 'Ana' }, state({ isMuted: muted }))).toBeNull()
  })
  it('anything while Do Not Disturb', () => {
    expect(decide(dm(), state({ status: 'dnd' }))).toBeNull()
    expect(decide({ type: 'friend', userId: 'x', name: 'X', accepted: false }, state({ status: 'dnd' }))).toBeNull()
  })
  it('anything while the window is focused', () => {
    expect(decide(dm(), state({ focused: true }))).toBeNull()
  })
  it('anything when switched off', () => {
    expect(decide(dm(), state({ enabled: false }))).toBeNull()
  })
})

describe('what it says', () => {
  it('previews off hides the text', () => {
    expect(decide(dm(), state({ previews: false }))?.body).toBe('New message')
  })
  it('an empty message still says something', () => {
    expect(decide(dm({ content: '   ' }), state())?.body).toBe('New message')
  })
  it('cuts long text to one line', () => {
    const out = plainBody('a\n\n' + 'b'.repeat(400))
    expect(out.length).toBe(BODY_MAX)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/\n/)
  })
})

describe('mentionsMe', () => {
  it('matches display name or username, any case', () => {
    expect(mentionsMe('<@sam doe>', me)).toBe(true)
    expect(mentionsMe('<@SAMD>', me)).toBe(true)
    expect(mentionsMe('<@Samantha>', me)).toBe(false)
    expect(mentionsMe('Sam Doe without brackets', me)).toBe(false)
  })
  it('treats regex characters in a name literally', () => {
    const odd = { id: 'x', displayName: 'a.b+c', username: 'u' }
    expect(mentionsMe('<@a.b+c>', odd)).toBe(true)
    expect(mentionsMe('<@aXb+c>', odd)).toBe(false)
  })
})

describe('unreadCount', () => {
  it('counts conversations that would notify', () => {
    const dms = [{ id: 'ana', unread: 2 }, { id: 'bo', unread: 0 }, { id: 'cy', unread: 1 }]
    const groups = [{ id: 'g1', unread: 5 }, { id: 'g2' }]
    expect(unreadCount(dms, groups, ['c1', 'c2'], k => k === 'cy')).toBe(4)   // ana, g1, c1, c2
  })
})
```

- [ ] **Step 2: Run, see it fail** — `npx vitest run src/composables/__tests__/notifyRules.test.ts` → FAIL, cannot find module `../notifyRules`.

- [ ] **Step 3: Implement**

```ts
// src/composables/notifyRules.ts
/**
 * Whether something that just happened becomes a notification, and what it
 * says. Pure: everything it needs comes in, so every rule is tested without a
 * socket, a window or a browser.
 *
 * The rules (spec: docs/superpowers/specs/2026-10-04-tray-and-notifications-design.md):
 * DMs, group messages, channel messages that mention you, calls, friend
 * requests — never your own, never a muted conversation, nothing while you are
 * Do Not Disturb, and nothing while the window is in front of you.
 */
import { stripMarkers } from '@/utils/richText'

export type ConvRef = { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string }

export interface Notice {
  /** Stable per message or call, so a repeat replaces rather than stacks. */
  id: string
  kind: 'message' | 'mention' | 'call' | 'friend'
  conversation: ConvRef | null
  title: string
  body: string
  /** A 64 px round PNG data URL, filled in by useNotifications. */
  icon: string | null
  /** One stack per conversation in Windows' notification centre. */
  group: { id: string; title: string } | null
  canReply: boolean
}

export interface Me { id: string; displayName: string; username: string }

export interface RuleState {
  me: Me
  status: 'online' | 'idle' | 'dnd' | 'invisible'
  /** The window is in front and visible. */
  focused: boolean
  /** Settings › Notifications › Desktop notifications. */
  enabled: boolean
  /** Settings › Notifications › Show message text. */
  previews: boolean
  /** The existing per-conversation mute, keyed as mutes are: a DM by partner id. */
  isMuted: (key: string) => boolean
}

export type Incoming =
  | { type: 'dm'; messageId: string; partnerId: string; authorId: string; authorName: string; content: string }
  | { type: 'group'; messageId: string; groupId: string; groupName: string; authorId: string; authorName: string; content: string }
  | {
      type: 'channel'; messageId: string; channelId: string; channelName: string; serverId: string; serverName: string
      authorId: string; authorName: string; content: string; mentionsEveryone: boolean
    }
  | { type: 'friend'; userId: string; name: string; accepted: boolean }
  | { type: 'call'; room: string; kind: 'dm' | 'group'; convId: string; muteKey: string; name: string }

export const BODY_MAX = 200

/** The message as one line of plain text: markers turned into words, cut short. */
export const plainBody = (content: string, max = BODY_MAX): string => {
  const flat = stripMarkers(content ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether a message mentions you. Mentions are written by name today
 * (`<@Name>`), so two people sharing a display name are both matched — the
 * known limit, until mentions carry user ids.
 */
export const mentionsMe = (content: string, me: Me): boolean => {
  const names = [me.displayName, me.username].map(n => (n ?? '').trim()).filter(Boolean).map(literal)
  if (!names.length) return false
  return new RegExp(`<@(?:${names.join('|')})>`, 'i').test(content ?? '')
}

export const decide = (e: Incoming, s: RuleState): Notice | null => {
  if (!s.enabled || s.focused || s.status === 'dnd') return null
  const text = (content: string) => (s.previews ? plainBody(content) || 'New message' : 'New message')

  switch (e.type) {
    case 'dm':
      if (e.authorId === s.me.id || s.isMuted(e.partnerId)) return null
      return {
        id: `msg:${e.messageId}`, kind: 'message', conversation: { kind: 'dm', id: e.partnerId },
        title: e.authorName, body: text(e.content), icon: null,
        group: { id: `dm:${e.partnerId}`, title: e.authorName }, canReply: true,
      }
    case 'group':
      if (e.authorId === s.me.id || s.isMuted(e.groupId)) return null
      return {
        id: `msg:${e.messageId}`, kind: 'message', conversation: { kind: 'group', id: e.groupId },
        title: `${e.authorName} · ${e.groupName}`, body: text(e.content), icon: null,
        group: { id: `group:${e.groupId}`, title: e.groupName }, canReply: true,
      }
    case 'channel': {
      if (e.authorId === s.me.id || s.isMuted(e.channelId)) return null
      if (!e.mentionsEveryone && !mentionsMe(e.content, s.me)) return null
      const where = `#${e.channelName} · ${e.serverName}`
      return {
        id: `msg:${e.messageId}`, kind: 'mention',
        conversation: { kind: 'channel', id: e.channelId, serverId: e.serverId || undefined },
        title: `${e.authorName} · ${where}`, body: text(e.content), icon: null,
        group: { id: `channel:${e.channelId}`, title: where }, canReply: true,
      }
    }
    case 'friend':
      return {
        id: `friend:${e.userId}:${e.accepted ? 'accepted' : 'request'}`, kind: 'friend', conversation: null,
        title: e.accepted ? 'Friend request accepted' : 'Friend request',
        body: e.accepted ? `${e.name} accepted your friend request.` : `${e.name} sent you a friend request.`,
        icon: null, group: null, canReply: false,
      }
    case 'call':
      if (s.isMuted(e.muteKey)) return null
      return {
        id: `call:${e.room}`, kind: 'call', conversation: { kind: e.kind, id: e.convId },
        title: e.name, body: 'Incoming call', icon: null, group: null, canReply: false,
      }
  }
}

/** What the tray dot and taskbar badge count: conversations holding something that would notify. */
export const unreadCount = (
  dms: { id: string; unread?: number }[],
  groups: { id: string; unread?: number }[],
  mentioned: Iterable<string>,
  isMuted: (key: string) => boolean,
): number => {
  let n = 0
  for (const d of dms) if ((d.unread ?? 0) > 0 && !isMuted(d.id)) n++
  for (const g of groups) if ((g.unread ?? 0) > 0 && !isMuted(g.id)) n++
  for (const _ of mentioned) n++
  return n
}
```

- [ ] **Step 4: Run, pass** — same command → all pass. Then mutation-check: remove `s.focused ||` from the first guard and confirm "anything while the window is focused" fails; restore. Do the same with `s.isMuted(e.partnerId)` → the mute test fails; restore.

- [ ] **Step 5: Commit**

```bash
git add src/composables/notifyRules.ts src/composables/__tests__/notifyRules.test.ts
git commit -m "Notifications: the rules"
```

---

### Task 2: Delivery — prefs, icons, sinks, and the bridge types

**Files:**
- Create: `src/composables/notificationPrefs.ts`, `src/composables/noticeIcon.ts`, `src/composables/notificationSinks.ts`, `src/composables/useNotifications.ts`
- Modify: `src/composables/desktopBridge.ts` (add to `DesktopBridge`)
- Test: `src/composables/__tests__/notificationDelivery.test.ts`

**Interfaces:**
- Consumes: `Notice`, `ConvRef` from Task 1.
- Produces:

```ts
// notificationPrefs.ts
export const notificationPrefs: { enabled: boolean; previews: boolean; asked: boolean }   // reactive
export const setNotificationPref: (key: 'enabled' | 'previews' | 'asked', on: boolean) => void
// notificationSinks.ts
export interface NoticeActivation { type: 'click' | 'reply' | 'read'; notice: { id: string; conversation: ConvRef | null }; reply?: string }
export interface RingInfo { name: string; icon: string | null; group: boolean }
export interface CallTrayState { inCall: boolean; muted: boolean; deafened: boolean }
export interface Sink {
  kind: 'web' | 'desktop'
  show(n: Notice): void
  ring(call: RingInfo | null): void
  unread(count: number): void
  callState(s: CallTrayState): void
  onActivated(cb: (a: NoticeActivation) => void): () => void
  onCallAction(cb: (a: 'accept' | 'decline') => void): () => void
  onTrayCommand(cb: (c: 'mute' | 'deafen') => void): () => void
}
export const webSink: (env?: { Notification?: typeof Notification; focus?: () => void }) => Sink
export const pickSink: (bridge: DesktopBridge | null) => Sink
// useNotifications.ts
export const notify: (n: Notice | null, iconSrc: string | null) => Promise<void>
export const ringFor: (call: RingInfo | null) => Promise<void>
export const setUnread: (count: number) => void
export const setCallTray: (s: CallTrayState) => void
export const onNoticeActivated: (cb: (a: NoticeActivation) => void) => () => void
export const onCallAction: (cb: (a: 'accept' | 'decline') => void) => () => void
export const onTrayCommand: (cb: (c: 'mute' | 'deafen') => void) => () => void
export const mentionedChannels: Set<string>                  // reactive
export const noteMention: (channelId: string) => void
export const clearMention: (channelId: string) => void
export const desktopDelivers: boolean
// noticeIcon.ts
export const roundIcon: (src: string, size?: number) => Promise<string | null>
```

- [ ] **Step 1: Failing tests**

```ts
// src/composables/__tests__/notificationDelivery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

beforeEach(() => { localStorage.clear(); setNotificationPref('asked', false) })

describe('web notifications', () => {
  it('shows one when permission is granted, tagged per conversation, silent', async () => {
    const { N, shown } = fakeNotification('granted')
    webSink({ Notification: N }).show(notice)
    await Promise.resolve(); await Promise.resolve()
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ title: 'Ana', opts: { body: 'hi', tag: 'dm:ana', silent: true } })
  })

  it('asks once, on its own, the first time — never again', async () => {
    const { N, shown } = fakeNotification('default', 'denied')
    const sink = webSink({ Notification: N })
    sink.show(notice); await new Promise(r => setTimeout(r, 0))
    sink.show(notice); await new Promise(r => setTimeout(r, 0))
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
    sink.show(notice); await Promise.resolve(); await Promise.resolve()
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

describe('prefs', () => {
  it('default on, and remembered on this device', () => {
    expect(notificationPrefs.enabled).toBe(true)
    expect(notificationPrefs.previews).toBe(true)
    setNotificationPref('previews', false)
    expect(JSON.parse(localStorage.getItem('skycord_notifications')!)).toMatchObject({ previews: false })
    setNotificationPref('previews', true)
  })
})
```

- [ ] **Step 2: Run, see it fail** — `npx vitest run src/composables/__tests__/notificationDelivery.test.ts` → modules missing.

- [ ] **Step 3: Implement**

```ts
// src/composables/notificationPrefs.ts
/**
 * Notification settings, per device: they are about this screen (who can see
 * it) and this machine, not the account.
 */
import { reactive } from 'vue'

const KEY = 'skycord_notifications'

const read = (): { enabled?: boolean; previews?: boolean; asked?: boolean } => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') ?? {} } catch { return {} }
}
const saved = read()

export const notificationPrefs = reactive({
  enabled: saved.enabled !== false,
  previews: saved.previews !== false,
  /** The browser has been asked for permission once, on its own. Never again after that. */
  asked: saved.asked === true,
})

export const setNotificationPref = (key: 'enabled' | 'previews' | 'asked', on: boolean): void => {
  notificationPrefs[key] = on
  try { localStorage.setItem(KEY, JSON.stringify({ ...notificationPrefs })) } catch { /* private mode */ }
}
```

```ts
// src/composables/noticeIcon.ts
/**
 * An avatar as a 64 px round PNG data URL, for a notification.
 *
 * Drawn here, in the page, because avatars are JPEG data URLs, animated SVG
 * data URLs (the default avatar) or links to GIF hosts — and a Windows toast
 * takes only an image it can decode, never a web address. So the shell is
 * handed one small PNG and never fetches anything itself. A host that refuses
 * CORS taints the canvas; that avatar is simply left out.
 */
const cache = new Map<string, string | null>()
const CACHE_MAX = 100

export const roundIcon = (src: string, size = 64): Promise<string | null> => {
  if (cache.has(src)) return Promise.resolve(cache.get(src) ?? null)
  return new Promise(resolve => {
    let settled = false
    const done = (v: string | null) => {
      if (settled) return
      settled = true
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
      cache.set(src, v)
      resolve(v)
    }
    if (typeof Image === 'undefined' || typeof document === 'undefined') return done(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = size; c.height = size
        const g = c.getContext('2d')
        if (!g) return done(null)
        g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.closePath(); g.clip()
        g.drawImage(img, 0, 0, size, size)
        done(c.toDataURL('image/png'))
      } catch { done(null) }
    }
    img.onerror = () => done(null)
    setTimeout(() => done(null), 3000)
    img.src = src
  })
}
```

```ts
// src/composables/notificationSinks.ts
/**
 * Where a notification is shown. One shape, two places: the browser's own
 * notifications, or the desktop shell's richer ones. The page picks once at
 * start-up and nothing else needs to know which.
 */
import type { ConvRef, Notice } from './notifyRules'
import type { DesktopBridge } from './desktopBridge'
import { notificationPrefs, setNotificationPref } from './notificationPrefs'

export interface NoticeActivation { type: 'click' | 'reply' | 'read'; notice: { id: string; conversation: ConvRef | null }; reply?: string }
export interface RingInfo { name: string; icon: string | null; group: boolean }
export interface CallTrayState { inCall: boolean; muted: boolean; deafened: boolean }

export interface Sink {
  kind: 'web' | 'desktop'
  show(n: Notice): void
  ring(call: RingInfo | null): void
  unread(count: number): void
  callState(s: CallTrayState): void
  onActivated(cb: (a: NoticeActivation) => void): () => void
  onCallAction(cb: (a: 'accept' | 'decline') => void): () => void
  onTrayCommand(cb: (c: 'mute' | 'deafen') => void): () => void
}

const never = () => () => {}

/**
 * The browser's notifications. They only open the conversation when clicked:
 * buttons on a web notification need a service worker, which this app does
 * not have. Permission is asked the first time one would show, once — after
 * that only the Allow button in Settings asks.
 */
export const webSink = (env: { Notification?: typeof Notification; focus?: () => void } = {
  Notification: typeof Notification === 'undefined' ? undefined : Notification,
  focus: () => window.focus(),
}): Sink => {
  const listeners = new Set<(a: NoticeActivation) => void>()
  const N = env.Notification

  const ready = async (): Promise<boolean> => {
    if (!N) return false
    if (N.permission === 'granted') return true
    if (N.permission === 'denied' || notificationPrefs.asked) return false
    setNotificationPref('asked', true)
    return (await N.requestPermission()) === 'granted'
  }

  return {
    kind: 'web',
    show(n) {
      void ready().then(ok => {
        if (!ok || !N) return
        const shown = new N(n.title, { body: n.body, icon: n.icon ?? undefined, tag: n.group?.id ?? n.id, silent: true })
        shown.onclick = () => {
          env.focus?.()
          shown.close()
          for (const cb of listeners) cb({ type: 'click', notice: { id: n.id, conversation: n.conversation } })
        }
      }).catch(() => {})
    },
    ring() {},          // a browser has no call window: the call arrives as a notice, via show()
    unread() {},
    callState() {},
    onActivated(cb) { listeners.add(cb); return () => { listeners.delete(cb) } },
    onCallAction: never,
    onTrayCommand: never,
  }
}

const desktopSink = (d: NonNullable<DesktopBridge['notifications']>): Sink => ({
  kind: 'desktop',
  show: n => d.show(n),
  ring: c => d.ring(c),
  unread: n => d.unread(n),
  callState: s => d.callState(s),
  onActivated: cb => d.onActivated(cb),
  onCallAction: cb => d.onCallAction(cb),
  onTrayCommand: cb => d.onTrayCommand(cb),
})

/** The desktop app when its build has the bridge; the browser's notifications otherwise. */
export const pickSink = (bridge: DesktopBridge | null): Sink =>
  bridge?.notifications ? desktopSink(bridge.notifications) : webSink()
```

```ts
// src/composables/useNotifications.ts
/**
 * Notifications, wired: a decided Notice gets its icon and goes to the sink;
 * whatever the person does with it comes back through onNoticeActivated.
 *
 * Channel mentions are tracked here because they are the one unread the
 * client did not already count: a channel's unread flag covers every
 * message, and the badge counts only what would notify.
 */
import { reactive } from 'vue'
import type { Notice } from './notifyRules'
import { pickSink, type RingInfo, type CallTrayState, type NoticeActivation } from './notificationSinks'
import { desktopBridge } from './desktopBridge'
import { roundIcon } from './noticeIcon'

const sink = pickSink(desktopBridge())
export const desktopDelivers = sink.kind === 'desktop'

export const notify = async (n: Notice | null, iconSrc: string | null): Promise<void> => {
  if (!n) return
  const icon = iconSrc ? await roundIcon(iconSrc) : null
  sink.show({ ...n, icon })
}

let ringSeq = 0
/** Open (or update) the call window, or close it with null. The last call wins. */
export const ringFor = async (call: RingInfo | null): Promise<void> => {
  const mine = ++ringSeq
  if (!call) { sink.ring(null); return }
  const icon = call.icon ? await roundIcon(call.icon) : null
  if (mine === ringSeq) sink.ring({ ...call, icon })
}

export const setUnread = (count: number): void => sink.unread(count)
export const setCallTray = (s: CallTrayState): void => sink.callState(s)
export const onNoticeActivated = (cb: (a: NoticeActivation) => void): (() => void) => sink.onActivated(cb)
export const onCallAction = (cb: (a: 'accept' | 'decline') => void): (() => void) => sink.onCallAction(cb)
export const onTrayCommand = (cb: (c: 'mute' | 'deafen') => void): (() => void) => sink.onTrayCommand(cb)

export const mentionedChannels = reactive(new Set<string>())
export const noteMention = (channelId: string): void => { mentionedChannels.add(channelId) }
export const clearMention = (channelId: string): void => { mentionedChannels.delete(channelId) }
```

In `src/composables/desktopBridge.ts`, add to `interface DesktopBridge` (after `updates?`), importing the types:

```ts
  /**
   * Notifications the app shows itself: rich toasts, the call window, the
   * tray and the taskbar badge. Absent in app builds before them — the page
   * then uses web notifications, which work inside the app too.
   */
  notifications?: {
    show(n: import('./notifyRules').Notice): void
    ring(call: import('./notificationSinks').RingInfo | null): void
    unread(count: number): void
    callState(s: import('./notificationSinks').CallTrayState): void
    onActivated(cb: (a: import('./notificationSinks').NoticeActivation) => void): () => void
    onCallAction(cb: (a: 'accept' | 'decline') => void): () => void
    onTrayCommand(cb: (c: 'mute' | 'deafen') => void): () => void
    keepInTray(): Promise<boolean>
    setKeepInTray(on: boolean): void
  }
```

- [ ] **Step 4: Run, pass** — the test file, then `npx vue-tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/composables/notificationPrefs.ts src/composables/noticeIcon.ts src/composables/notificationSinks.ts src/composables/useNotifications.ts src/composables/desktopBridge.ts src/composables/__tests__/notificationDelivery.test.ts
git commit -m "Notifications: prefs, icons, and where they are shown"
```

---

### Task 3: Wire it into the app

**Files:**
- Modify: `src/views/ChatApp.vue`

**Interfaces — consumes:** `decide`, `mentionsMe`, `unreadCount`, `ConvRef`, `Incoming`, `RuleState` (Task 1); `notify`, `ringFor`, `setUnread`, `setCallTray`, `onNoticeActivated`, `onCallAction`, `onTrayCommand`, `mentionedChannels`, `noteMention`, `clearMention`, `desktopDelivers` (Task 2); `notificationPrefs` (Task 2); existing `chosenStatus` and `isConvMuted` (already imported), `openDM`, `openGroup`, `openServer`, `selectChannel`, `doSend`, `newMessage`, `clearUnread`, `incomingCall`, `acceptIncomingCall`, `declineIncomingCall`, `onToggleMute`, `onToggleDeafen`, `micOff`, `deafOff`, `voice`.

- [ ] **Step 1: Imports and state.** Add near the other composable imports (skip any already imported):

```ts
import { decide, mentionsMe, unreadCount, type ConvRef, type Incoming, type RuleState } from '@/composables/notifyRules'
import {
  notify, ringFor, setUnread, setCallTray, onNoticeActivated, onCallAction, onTrayCommand,
  mentionedChannels, noteMention, clearMention, desktopDelivers,
} from '@/composables/useNotifications'
import { notificationPrefs } from '@/composables/notificationPrefs'
```

`chosenStatus` (from `usePresence`) and the mute check (`isMuted as isConvMuted`, from `useConvPrefs`) are already imported in `ChatApp.vue`; the code below uses those names.

Then, after `incomingCall`, `acceptIncomingCall` and `declineIncomingCall` are defined:

```ts
// ── notifications ───────────────────────────────────────────────────────────
// Whether the window is in front, kept as a ref so the call window can close
// the moment you come back (the in-app ring takes over).
const appFocused = ref(document.hasFocus() && document.visibilityState === 'visible')
const syncFocus = () => { appFocused.value = document.hasFocus() && document.visibilityState === 'visible' }
onMounted(() => {
  window.addEventListener('focus', syncFocus)
  window.addEventListener('blur', syncFocus)
  document.addEventListener('visibilitychange', syncFocus)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', syncFocus)
  window.removeEventListener('blur', syncFocus)
  document.removeEventListener('visibilitychange', syncFocus)
})

const noticeMe = () => ({
  id: authUser.value?.id ?? '',
  displayName: authUser.value?.displayName ?? '',
  username: authUser.value?.username ?? '',
})
const ruleState = (): RuleState => ({
  me: noticeMe(),
  status: chosenStatus.value,
  focused: document.hasFocus() && document.visibilityState === 'visible',
  enabled: notificationPrefs.enabled,
  previews: notificationPrefs.previews,
  isMuted: isConvMuted,
})
const consider = (e: Incoming, iconSrc: string | null): void => { void notify(decide(e, ruleState()), iconSrc) }

/** A channel's server and names, from what is loaded. */
const channelHome = (cid: string) => {
  for (const srv of servers.value) {
    const ch = channelsByServer.value[srv.id]?.find(c => c.id === cid)
    if (ch) return { srv, ch }
  }
  return null
}

/** Open any conversation a notice names — the same moves as clicking it in the sidebar. */
const openConversationRef = async (c: ConvRef): Promise<boolean> => {
  if (c.kind === 'dm') {
    const dm = dmsData.value.find(d => d.id === c.id)
    if (!dm) return false
    await openDM(dm); return true
  }
  if (c.kind === 'group') {
    const g = groupsData.value.find(x => x.id === c.id)
    if (!g) return false
    await openGroup(g); return true
  }
  const home = channelHome(c.id)
  if (!home) return false
  await openServer(home.srv)
  await selectChannel(home.ch)
  return true
}

const markConversationRead = (c: ConvRef | null): void => {
  if (!c) return
  if (c.kind === 'dm') { const d = dmsData.value.find(x => x.id === c.id); if (d) d.unread = undefined }
  else if (c.kind === 'group') { const g = groupsData.value.find(x => x.id === c.id); if (g) g.unread = undefined }
  else { clearUnread(c.id); clearMention(c.id) }
}

const stopNotices = onNoticeActivated(async a => {
  const c = a.notice.conversation
  if (a.type === 'read') { markConversationRead(c); return }
  const opened = c ? await openConversationRef(c) : false
  // Through the chat box's own send path: a reply fails exactly as a typed
  // message does, visibly, in the conversation.
  if (a.type === 'reply' && opened && a.reply?.trim()) {
    newMessage.value = a.reply.trim()
    await doSend()
  }
})
const stopCallActions = onCallAction(a => { if (a === 'accept') acceptIncomingCall(); else declineIncomingCall() })
const stopTray = onTrayCommand(cmd => { if (cmd === 'mute') onToggleMute(); else onToggleDeafen() })
onBeforeUnmount(() => { stopNotices(); stopCallActions(); stopTray() })

// The badge and the tray dot: conversations holding something that would notify.
watchEffect(() => setUnread(unreadCount(dmsData.value, groupsData.value, mentionedChannels, isConvMuted)))
// The tray menu's Mute and Deafen, only while in a call.
watchEffect(() => setCallTray({ inCall: voice.connected, muted: !!micOff.value, deafened: !!deafOff.value }))

// A mention is seen once its channel is the text on screen.
watch(
  () => (view.value === 'server' && !voiceStageOpen.value ? activeChannelId.value : null),
  cid => { if (cid) clearMention(cid) },
  { immediate: true },
)

// Calls: the desktop app's call window, or a notification in a browser. Only
// while the window is not in front — in front, the in-app ring already shows.
watch([incomingCall, appFocused, () => notificationPrefs.enabled, chosenStatus], ([c]) => {
  if (!c) { void ringFor(null); return }
  const n = decide({ type: 'call', room: c.room, kind: c.kind, convId: c.convId, muteKey: c.convId, name: c.name }, ruleState())
  if (!n) { void ringFor(null); return }
  if (desktopDelivers) void ringFor({ name: c.name, icon: c.avatar, group: c.kind === 'group' })
  else void notify(n, c.avatar)
})
```

Make sure `watchEffect` is in the `vue` import of `ChatApp.vue`.

- [ ] **Step 2: Messages.** In `socketOn('onMessage', …)`, at the end of the handler, after the sidebar update:

```ts
    consider({
      type: 'dm', messageId: String(payload._id ?? payload.id ?? ''), partnerId,
      authorId: payload.authorId, authorName: payload.authorName ?? 'Someone', content: payload.content ?? '',
    }, payload.authorAvatar || avatarFor(payload.authorName ?? ''))
```

In `socketOn('onGroupMessage', …)`, at the end:

```ts
    consider({
      type: 'group', messageId: String(payload._id ?? ''), groupId,
      groupName: g ? groupDisplayName(g) : 'a group',
      authorId: payload.authorId, authorName: payload.authorName ?? 'Someone', content: payload.content ?? '',
    }, payload.authorAvatar || avatarFor(payload.authorName ?? ''))
```

In `socketOn('onChannelMessage', …)`, replace `if (!looking) markUnread(channelId)` with:

```ts
    if (!looking) markUnread(channelId)
    const mine = payload.authorId === authUser.value?.id
    const forMe = !!payload.mentionsEveryone || mentionsMe(payload.content ?? '', noticeMe())
    if (!looking && !mine && forMe) noteMention(channelId)
    const home = channelHome(channelId)
    consider({
      type: 'channel', messageId: String(payload._id ?? ''), channelId,
      channelName: home?.ch.name ?? 'a channel', serverId: home?.srv.id ?? '', serverName: home?.srv.name ?? 'a server',
      authorId: payload.authorId, authorName: payload.authorName ?? 'Someone', content: payload.content ?? '',
      mentionsEveryone: !!payload.mentionsEveryone,
    }, payload.authorAvatar || avatarFor(payload.authorName ?? ''))
```

- [ ] **Step 3: Friends.** In `socketOn('onFriendRequest', …)` at the end:

```ts
    const r = payload.requester ?? {}
    consider({ type: 'friend', userId: r.id ?? payload._id, name: r.displayName || r.username || 'Someone', accepted: false },
      r.avatar ?? avatarFor(r.username ?? ''))
```

Replace `socketOn('onFriendAccepted', async () => { await loadFriends() })` with:

```ts
  socketOn('onFriendAccepted', async (p: any) => {
    await loadFriends()
    const f = apiFriends.value.find(x => x.id === p?.friendId)
    consider({ type: 'friend', userId: p?.friendId ?? '', name: f ? (f.displayName || f.username) : 'Someone', accepted: true },
      f ? avatarFor(f.username, f.avatar ?? null) : null)
  })
```

- [ ] **Step 4: Verify** — `npx vue-tsc --noEmit` clean; `npx vitest run src/` passes. In a browser at `localhost:5500`, sign in two accounts; with account A's tab in the background, send a DM from B → a browser notification titled B's name. Click it → A's tab focuses on that DM.

- [ ] **Step 5: Commit**

```bash
git add src/views/ChatApp.vue
git commit -m "Notifications: DMs, groups, mentions, calls and friends, wired in"
```

---

### Task 4: Settings › Notifications

**Files:**
- Create: `src/components/settings/NotificationsPage.vue`
- Modify: `src/components/modals/SettingsModal.vue` (nav entry under App Settings after `voice`; render branch beside `<PerformancePage />`)

- [ ] **Step 1: The page**

```vue
<script setup lang="ts">
/**
 * Settings › Notifications. Three switches, and — in a browser — the one
 * thing the switch cannot decide: whether the browser lets us notify at all.
 */
import { ref, onMounted } from 'vue'
import { notificationPrefs, setNotificationPref } from '@/composables/notificationPrefs'
import { desktopBridge } from '@/composables/desktopBridge'

const notifications = desktopBridge()?.notifications ?? null
const permission = ref<NotificationPermission | 'unsupported'>(
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
const keepInTray = ref<boolean | null>(null)

onMounted(async () => { keepInTray.value = notifications ? await notifications.keepInTray() : null })

const allow = async () => {
  if (typeof Notification === 'undefined') return
  setNotificationPref('asked', true)
  permission.value = await Notification.requestPermission()
}
const toggleTray = () => {
  if (keepInTray.value === null || !notifications) return
  keepInTray.value = !keepInTray.value
  notifications.setKeepInTray(keepInTray.value)
}
</script>

<template>
  <div class="st-card">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Desktop notifications</span>
        <span class="st-field-value prose">DMs, group messages, mentions, calls and friend requests, while Skycord is not the window in front.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.enabled }" role="switch"
        :aria-checked="notificationPrefs.enabled" aria-label="Desktop notifications"
        @click="setNotificationPref('enabled', !notificationPrefs.enabled)"
      />
    </div>

    <div v-if="!notifications && permission !== 'granted'" class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Browser permission</span>
        <span v-if="permission === 'unsupported'" class="st-field-value prose">This browser can't show notifications.</span>
        <span v-else-if="permission === 'denied'" class="st-field-value prose">Blocked for this site. Allow notifications from the padlock beside the address, then reload.</span>
        <span v-else class="st-field-value prose">The browser asks once. Allow it here.</span>
      </div>
      <button v-if="permission === 'default'" type="button" class="st-btn" @click="allow">Allow</button>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Show message text in notifications</span>
        <span class="st-field-value prose">Off, a notification says only "New message" — for a screen other people can see.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.previews }" role="switch"
        :aria-checked="notificationPrefs.previews" aria-label="Show message text in notifications"
        @click="setNotificationPref('previews', !notificationPrefs.previews)"
      />
    </div>

    <div v-if="keepInTray !== null" class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Keep Skycord running in the tray when closed</span>
        <span class="st-field-value prose">Closing the window keeps notifications and calls coming. Quit from the tray icon.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: keepInTray }" role="switch"
        :aria-checked="keepInTray" aria-label="Keep Skycord running in the tray when closed"
        @click="toggleTray"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 2: Register it** in `SettingsModal.vue`:
  - Import: `import NotificationsPage from '@/components/settings/NotificationsPage.vue'`.
  - In `navSections`, App Settings `items`, after `{ id: 'voice', label: 'Voice & Video' },` add `{ id: 'notifications', label: 'Notifications' },`.
  - After the Performance branch (`<template v-else-if="page === 'performance'"><PerformancePage /></template>`), add:
    ```vue
          <!-- ── Notifications ── -->
          <template v-else-if="page === 'notifications'">
            <NotificationsPage />
          </template>
    ```

- [ ] **Step 3: Verify** — `npx vue-tsc --noEmit`; `npx vitest run src/components src/styles` (design rules). Open Settings in the browser → Notifications page shows its switches; toggling Show message text and reloading keeps the choice.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/NotificationsPage.vue src/components/modals/SettingsModal.vue
git commit -m "Settings: Notifications"
```

---

### Task 5: The shell's pure parts

**Files:**
- Create: `desktop/src/notice.ts`, `desktop/src/trayModel.ts`
- Test: `desktop/src/__tests__/notice.test.ts`, `desktop/src/__tests__/trayModel.test.ts`

**Interfaces — produces:**

```ts
// notice.ts
export interface ShellNotice { id: string; kind: 'message' | 'mention' | 'call' | 'friend'; conversation: { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string } | null; title: string; body: string; icon: string | null; group: { id: string; title: string } | null; canReply: boolean }
export interface RingInfo { name: string; icon: string | null; group: boolean }
export const parseNotice: (v: unknown) => ShellNotice | null
export const parseRing: (v: unknown) => RingInfo | null
export const toastOptions: (n: ShellNotice) => { title: string; body: string; silent: true; hasReply: boolean; replyPlaceholder?: string; actions: { type: 'button'; text: string }[]; groupId?: string; groupTitle?: string }
// trayModel.ts
export interface TrayState { inCall: boolean; muted: boolean; deafened: boolean; unread: number }
export type TrayItem = { id: 'open' | 'mute' | 'deafen' | 'updates' | 'quit'; label: string; checked?: boolean } | { id: 'sep' }
export const trayMenu: (s: TrayState) => TrayItem[]
export const badgeAsset: (unread: number) => string | null     // '1'…'9', '9plus', or null
export const trayAsset: (unread: number) => 'tray' | 'tray-unread'
export const closeAction: (s: { quitting: boolean; keepInTray: boolean }) => 'hide' | 'close'
```

- [ ] **Step 1: Failing tests**

```ts
// desktop/src/__tests__/notice.test.ts
import { describe, it, expect } from 'vitest'
import { parseNotice, parseRing, toastOptions } from '../notice'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const good = {
  id: 'msg:1', kind: 'message', conversation: { kind: 'dm', id: 'ana' }, title: 'Ana', body: 'hi',
  icon: PNG, group: { id: 'dm:ana', title: 'Ana' }, canReply: true,
}

describe('parseNotice — everything from the page is checked', () => {
  it('keeps a well-formed notice', () => { expect(parseNotice(good)).toEqual(good) })
  it('refuses the wrong shapes', () => {
    for (const bad of [null, 'x', { ...good, kind: 'evil' }, { ...good, title: 42 }, { ...good, id: '' },
      { ...good, conversation: { kind: 'dm', id: '../x' } }, { ...good, conversation: { kind: 'web', id: 'a' } }]) {
      expect(parseNotice(bad)).toBeNull()
    }
  })
  it('drops an icon that is not a small PNG data URL, and keeps the notice', () => {
    expect(parseNotice({ ...good, icon: 'https://evil.test/a.png' })?.icon).toBeNull()
    expect(parseNotice({ ...good, icon: 'data:image/svg+xml;base64,PHN2Zz4=' })?.icon).toBeNull()
    expect(parseNotice({ ...good, icon: 'data:image/png;base64,' + 'A'.repeat(200_001) })?.icon).toBeNull()
  })
  it('cuts overlong text', () => {
    const n = parseNotice({ ...good, title: 't'.repeat(500), body: 'b'.repeat(1000) })!
    expect(n.title.length).toBeLessThanOrEqual(120)
    expect(n.body.length).toBeLessThanOrEqual(300)
  })
})

describe('parseRing', () => {
  it('keeps a caller, drops a bad icon', () => {
    expect(parseRing({ name: 'Ana', icon: PNG, group: false })).toEqual({ name: 'Ana', icon: PNG, group: false })
    expect(parseRing({ name: 'Ana', icon: 'file:///c:/x.png', group: true })).toEqual({ name: 'Ana', icon: null, group: true })
    expect(parseRing({ name: '', icon: null, group: false })).toBeNull()
    expect(parseRing(null)).toBeNull()
  })
})

describe('toastOptions', () => {
  it('silent, repliable, Mark as read, grouped per conversation', () => {
    expect(toastOptions(parseNotice(good)!)).toEqual({
      title: 'Ana', body: 'hi', silent: true, hasReply: true, replyPlaceholder: 'Reply…',
      actions: [{ type: 'button', text: 'Mark as read' }], groupId: 'dm:ana', groupTitle: 'Ana',
    })
  })
  it('a friend request has nothing to reply to or mark', () => {
    const o = toastOptions(parseNotice({ ...good, kind: 'friend', conversation: null, group: null, canReply: false })!)
    expect(o).toEqual({ title: 'Ana', body: 'hi', silent: true, hasReply: false, actions: [] })
  })
})
```

```ts
// desktop/src/__tests__/trayModel.test.ts
import { describe, it, expect } from 'vitest'
import { trayMenu, badgeAsset, trayAsset, closeAction } from '../trayModel'

describe('trayMenu', () => {
  it('outside a call: open, updates, quit', () => {
    expect(trayMenu({ inCall: false, muted: false, deafened: false, unread: 0 }).map(i => i.id))
      .toEqual(['open', 'sep', 'updates', 'sep', 'quit'])
  })
  it('in a call: mute and deafen, ticked by state', () => {
    const m = trayMenu({ inCall: true, muted: true, deafened: false, unread: 0 })
    expect(m.map(i => i.id)).toEqual(['open', 'sep', 'mute', 'deafen', 'sep', 'updates', 'sep', 'quit'])
    expect(m.find(i => i.id === 'mute')).toMatchObject({ checked: true })
    expect(m.find(i => i.id === 'deafen')).toMatchObject({ checked: false })
  })
})

describe('badges', () => {
  it('nothing at zero, a number to nine, then 9+', () => {
    expect(badgeAsset(0)).toBeNull()
    expect(badgeAsset(1)).toBe('1')
    expect(badgeAsset(9)).toBe('9')
    expect(badgeAsset(10)).toBe('9plus')
    expect(badgeAsset(-3)).toBeNull()
  })
  it('the tray dot', () => {
    expect(trayAsset(0)).toBe('tray')
    expect(trayAsset(4)).toBe('tray-unread')
  })
})

describe('closing the window', () => {
  it('hides to the tray unless quitting or switched off', () => {
    expect(closeAction({ quitting: false, keepInTray: true })).toBe('hide')
    expect(closeAction({ quitting: true, keepInTray: true })).toBe('close')
    expect(closeAction({ quitting: false, keepInTray: false })).toBe('close')
  })
})
```

- [ ] **Step 2: Run, see it fail** — `npx vitest run desktop/src/__tests__/notice.test.ts desktop/src/__tests__/trayModel.test.ts` → modules missing.

- [ ] **Step 3: Implement**

```ts
// desktop/src/notice.ts
/**
 * What the page asks the shell to show, checked. The page is a server's web
 * client: whatever it sends is untrusted, the same as every other bridge call.
 *
 * An icon is accepted only as a small PNG data URL, which the page draws
 * itself (src/composables/noticeIcon.ts). The shell never fetches anything a
 * page names, so a notification cannot be used to make it dial out.
 */
export interface ShellNotice {
  id: string
  kind: 'message' | 'mention' | 'call' | 'friend'
  conversation: { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string } | null
  title: string
  body: string
  icon: string | null
  group: { id: string; title: string } | null
  canReply: boolean
}
export interface RingInfo { name: string; icon: string | null; group: boolean }

const KINDS = ['message', 'mention', 'call', 'friend'] as const
const CONV = ['dm', 'group', 'channel'] as const
const ID = /^[\w:-]{1,128}$/
const ICON = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/
const ICON_MAX = 200_000

const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' ? v.slice(0, max) : null
const icon = (v: unknown): string | null =>
  typeof v === 'string' && v.length <= ICON_MAX && ICON.test(v) ? v : null

export const parseNotice = (v: unknown): ShellNotice | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || !ID.test(o.id)) return null
  if (!KINDS.includes(o.kind as never)) return null
  const title = text(o.title, 120), body = text(o.body, 300)
  if (title === null || body === null) return null

  let conversation: ShellNotice['conversation'] = null
  if (o.conversation !== null && o.conversation !== undefined) {
    const c = o.conversation as Record<string, unknown>
    if (!CONV.includes(c.kind as never) || typeof c.id !== 'string' || !ID.test(c.id)) return null
    if (c.serverId !== undefined && (typeof c.serverId !== 'string' || !ID.test(c.serverId))) return null
    conversation = { kind: c.kind as ShellNotice['conversation'] extends infer T ? T extends { kind: infer K } ? K : never : never, id: c.id, ...(c.serverId ? { serverId: c.serverId as string } : {}) }
  }

  let group: ShellNotice['group'] = null
  if (o.group !== null && o.group !== undefined) {
    const g = o.group as Record<string, unknown>
    const gt = text(g.title, 120)
    if (typeof g.id !== 'string' || !ID.test(g.id) || gt === null) return null
    group = { id: g.id, title: gt }
  }

  return { id: o.id, kind: o.kind as ShellNotice['kind'], conversation, title, body, icon: icon(o.icon), group, canReply: o.canReply === true }
}

export const parseRing = (v: unknown): RingInfo | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = text(o.name, 80)
  if (!name) return null
  return { name, icon: icon(o.icon), group: o.group === true }
}

/** Electron Notification options for a notice, minus the icon (the glue decodes it). */
export const toastOptions = (n: ShellNotice) => ({
  title: n.title,
  body: n.body,
  silent: true as const,
  hasReply: n.canReply,
  ...(n.canReply ? { replyPlaceholder: 'Reply…' } : {}),
  actions: n.conversation && n.kind !== 'call' ? [{ type: 'button' as const, text: 'Mark as read' }] : [],
  ...(n.group ? { groupId: n.group.id, groupTitle: n.group.title } : {}),
})
```

(If the conditional-type cast on `conversation.kind` reads badly, write `kind: c.kind as 'dm' | 'group' | 'channel'` — same meaning.)

```ts
// desktop/src/trayModel.ts
/** The tray and taskbar, as data: what the menu holds and which image shows. Pure. */
export interface TrayState { inCall: boolean; muted: boolean; deafened: boolean; unread: number }
export type TrayItem =
  | { id: 'open' | 'mute' | 'deafen' | 'updates' | 'quit'; label: string; checked?: boolean }
  | { id: 'sep' }

export const trayMenu = (s: TrayState): TrayItem[] => [
  { id: 'open', label: 'Open Skycord' },
  { id: 'sep' },
  ...(s.inCall
    ? [{ id: 'mute', label: 'Mute', checked: s.muted } as TrayItem, { id: 'deafen', label: 'Deafen', checked: s.deafened } as TrayItem, { id: 'sep' } as TrayItem]
    : []),
  { id: 'updates', label: 'Check for updates' },
  { id: 'sep' },
  { id: 'quit', label: 'Quit Skycord' },
]

/** The taskbar badge image's name under static/tray/badge-<name>.png, or null for none. */
export const badgeAsset = (unread: number): string | null =>
  unread <= 0 ? null : unread > 9 ? '9plus' : String(Math.floor(unread))

export const trayAsset = (unread: number): 'tray' | 'tray-unread' => (unread > 0 ? 'tray-unread' : 'tray')

/** What the window's close button does. */
export const closeAction = (s: { quitting: boolean; keepInTray: boolean }): 'hide' | 'close' =>
  !s.quitting && s.keepInTray ? 'hide' : 'close'
```

- [ ] **Step 4: Run, pass**; `npx tsc --noEmit -p desktop/tsconfig.json`.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/notice.ts desktop/src/trayModel.ts desktop/src/__tests__/notice.test.ts desktop/src/__tests__/trayModel.test.ts
git commit -m "Desktop: notifications and tray, as checked data"
```

---

### Task 6: Tray and badge images

**Files:**
- Create: `desktop/scripts/make-tray-assets.mjs`; generated `desktop/static/tray/tray.png`, `tray-unread.png`, `badge-1.png` … `badge-9.png`, `badge-9plus.png`

- [ ] **Step 1: The generator** (run on Windows; ffmpeg with drawtext and Segoe UI Bold, both present on the dev machine):

```js
// desktop/scripts/make-tray-assets.mjs
/**
 * The tray icon (plain and with an unread dot) and the taskbar badges 1–9 and
 * 9+. Generated rather than drawn at run time: Electron's nativeImage cannot
 * draw, and a badge is the same eleven images forever. Each is rendered at 4x
 * and scaled down, so the circle's edge is smooth.
 *
 *   node desktop/scripts/make-tray-assets.mjs
 */
import { spawnSync } from 'child_process'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'static', 'tray')
const icon = join(here, '..', 'build', 'icon.png')
const FONT = 'C\\:/Windows/Fonts/segoeuib.ttf'
const RED = { r: 242, g: 63, b: 67 }   // the app's danger red, #f23f43
mkdirSync(out, { recursive: true })

const run = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  if (r.status !== 0) { console.error(r.stderr.toString()); process.exit(1) }
}
const disc = (cx, cy, rad) => `lte(hypot(X-${cx},Y-${cy}),${rad})`

// Tray, 32x32, plain.
run(['-i', icon, '-vf', 'scale=32:32:flags=lanczos', join(out, 'tray.png')])

// Tray with a red dot top-right, at 4x then down.
const dot = disc(100, 28, 26)
run(['-i', icon, '-vf',
  `scale=128:128:flags=lanczos,format=rgba,geq=r='if(${dot},${RED.r},r(X,Y))':g='if(${dot},${RED.g},g(X,Y))':b='if(${dot},${RED.b},b(X,Y))':a='if(${dot},255,alpha(X,Y))',scale=32:32:flags=lanczos`,
  join(out, 'tray-unread.png')])

// Badges: a red disc with a white number, 4x then 32x32.
for (const label of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']) {
  const name = label === '9+' ? '9plus' : label
  const size = label === '9+' ? 56 : 80
  run(['-f', 'lavfi', '-i', 'color=c=black@0.0:s=128x128,format=rgba', '-frames:v', '1', '-vf',
    `geq=r='if(${disc(63.5, 63.5, 62)},${RED.r},0)':g='if(${disc(63.5, 63.5, 62)},${RED.g},0)':b='if(${disc(63.5, 63.5, 62)},${RED.b},0)':a='if(${disc(63.5, 63.5, 62)},255,0)',` +
    `drawtext=fontfile='${FONT}':text='${label}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=(h-text_h)/2-4,scale=32:32:flags=lanczos`,
    join(out, `badge-${name}.png`)])
}
console.log('wrote', out)
```

- [ ] **Step 2: Run it** — `node desktop/scripts/make-tray-assets.mjs` → `wrote …/static/tray`; `ls desktop/static/tray` lists 12 PNGs. Open three in the Read tool (tray-unread, badge-3, badge-9plus) and check that the disc is round and the number is centred and legible at 32 px.

- [ ] **Step 3: Commit**

```bash
git add desktop/scripts/make-tray-assets.mjs desktop/static/tray
git commit -m "Desktop: tray and badge images"
```

---

### Task 7: The shell — toasts, tray, taskbar, close-to-tray

**Files:**
- Create: `desktop/src/toasts.ts`, `desktop/src/tray.ts`
- Modify: `desktop/src/main.ts`, `desktop/src/preload.ts`, `desktop/src/store.ts`, `desktop/src/updates.ts`

**Interfaces:**
- Consumes: `parseNotice`, `toastOptions` (Task 5); `trayMenu`, `badgeAsset`, `trayAsset`, `closeAction` (Task 5); images (Task 6).
- Produces IPC: page → shell `desktop:notify` (notice), `desktop:unread` (number), `desktop:callState` ({inCall, muted, deafened}), `desktop:setKeepInTray` (boolean), invoke `desktop:keepInTray` → boolean. Shell → page: `desktop:noticeActivated` ({type, notice:{id, conversation}, reply?}), `desktop:trayCommand` ('mute' | 'deafen').

- [ ] **Step 1: `toasts.ts`**

```ts
// desktop/src/toasts.ts
/**
 * Windows toasts for the page's notices.
 *
 * Interactions arrive on each Notification object's own events, which is how
 * a Reply reaches the conversation it belongs to. The shell keeps the objects
 * so that it can (a) replace the previous toast of the same conversation and
 * (b) close all of them on quit — Windows has no remove-all for an app
 * (Notification.removeAll is macOS only), and closing one also takes it out
 * of Action Center. handleActivation is registered for the one case those
 * events cannot cover, a cold start from a toast a crash left behind: that
 * can only bring the window up, because it carries no notification identity.
 */
import { Notification, nativeImage, type WebContents } from 'electron'
import { toastOptions, type ShellNotice } from './notice'

const live = new Map<string, { n: Notification; notice: ShellNotice }>()   // by notice id
const byGroup = new Map<string, string>()                                    // group id -> notice id
const LIVE_MAX = 50

export interface ToastHooks {
  page(): WebContents | null
  showWindow(): void
}
let hooks: ToastHooks | null = null

export const initToasts = (h: ToastHooks): void => {
  hooks = h
  Notification.handleActivation(() => h.showWindow())
}

const send = (type: 'click' | 'reply' | 'read', notice: ShellNotice, reply?: string) =>
  hooks?.page()?.send('desktop:noticeActivated', {
    type, notice: { id: notice.id, conversation: notice.conversation }, ...(reply !== undefined ? { reply } : {}),
  })

const forget = (id: string) => {
  const entry = live.get(id)
  if (!entry) return
  live.delete(id)
  if (entry.notice.group && byGroup.get(entry.notice.group.id) === id) byGroup.delete(entry.notice.group.id)
}

export const showToast = (notice: ShellNotice): void => {
  if (!Notification.isSupported()) return
  // A newer message in the same conversation replaces the older toast.
  const prevId = notice.group ? byGroup.get(notice.group.id) : undefined
  if (prevId) { live.get(prevId)?.n.close(); forget(prevId) }
  if (live.size >= LIVE_MAX) { const oldest = live.keys().next().value as string; live.get(oldest)?.n.close(); forget(oldest) }

  const n = new Notification({
    ...toastOptions(notice),
    ...(notice.icon ? { icon: nativeImage.createFromDataURL(notice.icon) } : {}),
  })
  n.on('click', () => { hooks?.showWindow(); send('click', notice); forget(notice.id) })
  n.on('reply', (e: { reply?: string }, legacy?: string) => {
    hooks?.showWindow()
    send('reply', notice, e?.reply ?? legacy ?? '')
    forget(notice.id)
  })
  n.on('action', () => { send('read', notice); n.close(); forget(notice.id) })
  n.on('close', () => forget(notice.id))
  live.set(notice.id, { n, notice })
  if (notice.group) byGroup.set(notice.group.id, notice.id)
  n.show()
}

/** On quit: close every toast, which also removes it from Action Center. */
export const closeAllToasts = (): void => {
  for (const { n } of live.values()) n.close()
  live.clear(); byGroup.clear()
}
```

- [ ] **Step 2: `tray.ts`**

```ts
// desktop/src/tray.ts
/**
 * The tray icon, its menu, and the taskbar badge and flash. The menu's
 * contents and the images chosen come from trayModel.ts; this only renders
 * them and routes the clicks.
 */
import { Tray, Menu, nativeImage, app, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { trayMenu, trayAsset, badgeAsset, type TrayState, type TrayItem } from './trayModel'

const img = (name: string) => nativeImage.createFromPath(join(app.getAppPath(), 'static', 'tray', `${name}.png`))

export interface TrayHooks {
  window(): BrowserWindow | null
  showWindow(): void
  command(c: 'mute' | 'deafen'): void
  checkUpdates(): void
  quit(): void
}

let tray: Tray | null = null
let hooks: TrayHooks | null = null
let state: TrayState = { inCall: false, muted: false, deafened: false, unread: 0 }

const render = () => {
  if (!tray || !hooks) return
  const h = hooks
  const item = (i: TrayItem): MenuItemConstructorOptions => {
    if (i.id === 'sep') return { type: 'separator' }
    const click = () => {
      if (i.id === 'open') h.showWindow()
      else if (i.id === 'mute' || i.id === 'deafen') h.command(i.id)
      else if (i.id === 'updates') h.checkUpdates()
      else if (i.id === 'quit') h.quit()
    }
    return i.checked === undefined ? { label: i.label, click } : { label: i.label, type: 'checkbox', checked: i.checked, click }
  }
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu(state).map(item)))
  tray.setImage(img(trayAsset(state.unread)))
  tray.setToolTip(state.unread ? `Skycord — ${state.unread} unread` : 'Skycord')
  const win = h.window()
  if (win && process.platform === 'win32') {
    const badge = badgeAsset(state.unread)
    win.setOverlayIcon(badge ? img(`badge-${badge}`) : null, badge ? `${state.unread} unread` : '')
  }
}

export const initTray = (h: TrayHooks): void => {
  hooks = h
  tray = new Tray(img('tray'))
  tray.on('click', () => h.showWindow())
  render()
}

export const updateTray = (next: Partial<TrayState>): void => { state = { ...state, ...next }; render() }

/** Flash the taskbar button until the window is focused (Windows stops it on focus). */
export const flashTaskbar = (): void => {
  const win = hooks?.window()
  if (win && !win.isFocused()) win.flashFrame(true)
}

export const destroyTray = (): void => { tray?.destroy(); tray = null }
```

- [ ] **Step 3: `store.ts`** — add `keepInTray?: unknown; trayHintShown?: unknown` to `Stored`.

- [ ] **Step 4: `updates.ts`** — export a hook that runs before the install quits, so close-to-tray cannot hold the update:

```ts
let beforeInstall: () => void = () => {}
/** Called just before quitAndInstall, so the window really closes. */
export const onBeforeInstall = (fn: () => void): void => { beforeInstall = fn }
```

and in `installUpdateNow`, call `beforeInstall()` immediately before `autoUpdater.quitAndInstall()`. The other install path, `autoInstallOnAppQuit = true`, only runs on a real quit, and `before-quit` already sets `quitting` (Step 5), so it needs nothing.

- [ ] **Step 5: `main.ts`** — wire it all. At the top with the other imports:

```ts
import { initToasts, showToast, closeAllToasts } from './toasts'
import { initTray, updateTray, flashTaskbar, destroyTray } from './tray'
import { parseNotice } from './notice'
import { closeAction } from './trayModel'
import { onBeforeInstall } from './updates'
```

Module state, near `let current`:

```ts
/** Set once Skycord is really quitting, so closing the window closes it. */
let quitting = false
const keepInTray = () => readStore().keepInTray !== false
const showWindow = () => {
  const w = shellWin?.win
  if (!w) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}
const quitApp = () => { quitting = true; app.quit() }
app.on('before-quit', () => { quitting = true; closeAllToasts(); destroyTray() })
onBeforeInstall(() => { quitting = true; closeAllToasts() })
```

IPC handlers, after the existing `desktop:updateInstall` handler:

```ts
ipcMain.on('desktop:notify', (event, value: unknown) => {
  const n = fromInstance(event) ? parseNotice(value) : null
  if (!n) return
  showToast(n)
  if (n.kind === 'message' || n.kind === 'mention') flashTaskbar()
})
ipcMain.on('desktop:unread', (event, value: unknown) => {
  if (!fromInstance(event)) return
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(999, Math.floor(value))) : 0
  updateTray({ unread: n })
})
ipcMain.on('desktop:callState', (event, value: unknown) => {
  if (!fromInstance(event) || !value || typeof value !== 'object') return
  const v = value as Record<string, unknown>
  updateTray({ inCall: v.inCall === true, muted: v.muted === true, deafened: v.deafened === true })
})
ipcMain.handle('desktop:keepInTray', event => (fromInstance(event) ? keepInTray() : null))
ipcMain.on('desktop:setKeepInTray', (event, value: unknown) => {
  if (fromInstance(event) && typeof value === 'boolean') writeStore({ ...readStore(), keepInTray: value })
})
```

Inside `app.whenReady().then(...)`, as the first lines after `if (!primary) return`:

```ts
  // Windows shows an app's toasts under the identity it declares; this must
  // match the installer's appId (electron-builder.yml).
  if (process.platform === 'win32') app.setAppUserModelId('xyz.skycord.desktop')
```

After `shellWin = createAppWindow(...)` and its existing listeners:

```ts
  initToasts({ page: () => shellWin?.page ?? null, showWindow })
  initTray({
    window: () => shellWin?.win ?? null,
    showWindow,
    command: c => shellWin?.page.send('desktop:trayCommand', c),
    checkUpdates: () => checkForUpdatesNow(),
    quit: quitApp,
  })
  shellWin.win.on('close', e => {
    if (closeAction({ quitting, keepInTray: keepInTray() }) === 'close') return
    e.preventDefault()
    shellWin?.win.hide()
    if (readStore().trayHintShown !== true) {
      writeStore({ ...readStore(), trayHintShown: true })
      showToast({
        id: 'tray-hint', kind: 'friend', conversation: null, title: 'Skycord is still running',
        body: 'It keeps notifications and calls coming. Quit from the tray icon.', icon: null, group: null, canReply: false,
      })
    }
  })
```

`checkForUpdatesNow` is already imported where the existing handlers use it; reuse that import. Replace the last line `app.on('window-all-closed', () => app.quit())` with:

```ts
// With close-to-tray the window hides rather than closes, so this fires only
// when Skycord is genuinely on its way out.
app.on('window-all-closed', () => { if (quitting || !keepInTray()) app.quit() })
```

The existing `second-instance` handler restores and focuses the window; make it call `showWindow()` instead of `w.restore(); w.focus()`, so a second launch also brings a hidden window back.

- [ ] **Step 6: `preload.ts`** — inside the `skycordDesktop` object, after `performance`:

```ts
    // Notifications the app shows itself. Interactions come back here.
    notifications: {
      show: (notice: unknown) => ipcRenderer.send('desktop:notify', notice),
      ring: (call: unknown) => ipcRenderer.send('desktop:ring', call),
      unread: (count: number) => ipcRenderer.send('desktop:unread', count),
      callState: (s: unknown) => ipcRenderer.send('desktop:callState', s),
      onActivated: (cb: (a: unknown) => void) => {
        const h = (_e: unknown, a: unknown) => cb(a)
        ipcRenderer.on('desktop:noticeActivated', h)
        return () => { ipcRenderer.off('desktop:noticeActivated', h) }
      },
      onCallAction: (cb: (a: unknown) => void) => {
        const h = (_e: unknown, a: unknown) => cb(a)
        ipcRenderer.on('desktop:callAction', h)
        return () => { ipcRenderer.off('desktop:callAction', h) }
      },
      onTrayCommand: (cb: (c: unknown) => void) => {
        const h = (_e: unknown, c: unknown) => cb(c)
        ipcRenderer.on('desktop:trayCommand', h)
        return () => { ipcRenderer.off('desktop:trayCommand', h) }
      },
      keepInTray: () => ipcRenderer.invoke('desktop:keepInTray'),
      setKeepInTray: (on: boolean) => ipcRenderer.send('desktop:setKeepInTray', on),
    },
```

- [ ] **Step 7: Verify** — `npx tsc --noEmit -p desktop/tsconfig.json`; `npx vitest run desktop/src/`. Then run the app from source with `npm --prefix desktop run dev` (compiles and launches Electron), choosing the local server `http://localhost:5500` in its picker.
  - With the window behind another app, send a DM from a second account → a toast with the avatar, Reply and Mark as read.
  - Reply → the message appears in the DM.
  - Close the window → the app is in the tray, and a "still running" toast shows once.
  - A DM now still toasts, the tray icon shows the dot, and the taskbar badge shows 1.
  - Tray › Quit closes the app.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/toasts.ts desktop/src/tray.ts desktop/src/main.ts desktop/src/preload.ts desktop/src/store.ts desktop/src/updates.ts
git commit -m "Desktop: toasts with Reply, the tray, the taskbar badge, close to tray"
```

---

### Task 8: The incoming-call window

**Files:**
- Create: `desktop/src/callWindow.ts`, `desktop/static/call.html`
- Modify: `desktop/src/main.ts`, `desktop/src/preload.ts`
- Test: `desktop/src/__tests__/notice.test.ts` (parseRing is already covered — nothing new to unit-test here; this task is verified live)

**Interfaces:**
- Consumes: `parseRing` (Task 5). Page → shell `desktop:ring` (RingInfo | null). Call page → shell `call:answer` ('accept' | 'decline'). Shell → page `desktop:callAction`.

- [ ] **Step 1: `callWindow.ts`**

```ts
// desktop/src/callWindow.ts
/**
 * The incoming-call window: small, always on top, bottom-right of the work
 * area. It shows who is calling and answers through the page, which owns the
 * call — this window only asks. The ringtone stays in the page, so there is
 * one source of sound.
 */
import { BrowserWindow, screen, app } from 'electron'
import { join } from 'path'
import type { RingInfo } from './notice'

const CALL = join(app.getAppPath(), 'static', 'call.html')
const W = 320, H = 132, MARGIN = 16

let win: BrowserWindow | null = null
let last: RingInfo | null = null

export const showCall = (preload: string, info: RingInfo, colors: { bar: string; text: string; muted: string } | null): void => {
  last = info
  if (win && !win.isDestroyed()) { win.webContents.send('call:info', { ...info, colors }); win.showInactive(); return }
  const area = screen.getPrimaryDisplay().workArea
  win = new BrowserWindow({
    width: W, height: H, x: area.x + area.width - W - MARGIN, y: area.y + area.height - H - MARGIN,
    frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: false, show: false, title: 'Incoming call',
    backgroundColor: colors?.bar ?? '#1e1f22',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.once('did-finish-load', () => { win?.webContents.send('call:info', { ...last, colors }); win?.showInactive() })
  win.on('closed', () => { win = null })
  void win.loadFile(CALL)
}

export const hideCall = (): void => { if (win && !win.isDestroyed()) win.close(); win = null; last = null }
export const isCallWindow = (contents: Electron.WebContents): boolean => !!win && !win.isDestroyed() && contents === win.webContents
```

- [ ] **Step 2: `static/call.html`** — no remote content, script inline, theme colours from the shell:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Incoming call</title>
<style>
  :root { --bar: #1e1f22; --text: #f2f3f5; --muted: #b5bac1; }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    font: 14px/1.35 "Segoe UI", system-ui, sans-serif; color: var(--text); background: var(--bar);
    display: grid; grid-template-columns: 56px 1fr; grid-template-rows: auto auto 1fr; gap: 2px 12px;
    padding: 14px 14px 12px; -webkit-app-region: drag; user-select: none; border: 1px solid rgba(255,255,255,.08);
  }
  .face { grid-row: 1 / span 2; width: 56px; height: 56px; border-radius: 50%; background: rgba(255,255,255,.08); object-fit: cover; }
  .name { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; align-self: end; }
  .what { color: var(--muted); font-size: 12.5px; }
  .acts { grid-column: 1 / -1; display: flex; gap: 8px; align-self: end; -webkit-app-region: no-drag; }
  button { flex: 1; height: 36px; border: 0; border-radius: 8px; font: 600 13px "Segoe UI", system-ui, sans-serif; color: #fff; cursor: pointer; }
  .accept { background: #248046; } .accept:hover { background: #1a6334; }
  .decline { background: #da373c; } .decline:hover { background: #a12828; }
</style>
</head>
<body>
  <img class="face" id="face" alt="">
  <div class="name" id="name">Someone</div>
  <div class="what" id="what">Incoming call</div>
  <div class="acts">
    <button class="decline" id="decline">Decline</button>
    <button class="accept" id="accept">Accept</button>
  </div>
<script>
  const $ = id => document.getElementById(id)
  window.skycordCall.onInfo(info => {
    $('name').textContent = info.name || 'Someone'
    $('what').textContent = info.group ? 'Group call' : 'Incoming call'
    if (info.icon && /^data:image\/png;base64,/.test(info.icon)) $('face').src = info.icon
    if (info.colors) {
      document.documentElement.style.setProperty('--bar', info.colors.bar)
      document.documentElement.style.setProperty('--text', info.colors.text)
      document.documentElement.style.setProperty('--muted', info.colors.muted)
    }
  })
  $('accept').onclick = () => window.skycordCall.answer('accept')
  $('decline').onclick = () => window.skycordCall.answer('decline')
</script>
</body>
</html>
```

(The page is local, static and shell-owned, so it sits outside the client's token system; its two button colours are Discord-standard green and red, matching the in-app incoming-call modal. If a design test scans `desktop/static`, mirror how `splash.html` and `share.html` are treated.)

- [ ] **Step 3: `preload.ts`** — a branch for the call page, placed before the generic `else if (local)`:

```ts
} else if (local && page === 'call.html') {
  contextBridge.exposeInMainWorld('skycordCall', {
    onInfo: (cb: (info: unknown) => void) => { ipcRenderer.on('call:info', (_e, i) => cb(i)) },
    answer: (a: 'accept' | 'decline') => ipcRenderer.send('call:answer', a),
  })
```

Also add `call.html` to the list at the top of the file's header comment.

- [ ] **Step 4: `main.ts`**

```ts
import { showCall, hideCall, isCallWindow } from './callWindow'
import { parseRing } from './notice'   // extend the existing notice import instead if present
```

The title bar already receives the theme colours through `desktop:titleColors`. Keep the last value: in that existing handler, after parsing, also assign `lastColors = c`, with `let lastColors: { bar: string; text: string; muted: string } | null = null` declared beside `current`. Then:

```ts
ipcMain.on('desktop:ring', (event, value: unknown) => {
  if (!fromInstance(event)) return
  const info = value === null ? null : parseRing(value)
  if (info) showCall(PRELOAD, info, lastColors)
  else hideCall()
})
ipcMain.on('call:answer', (event, value: unknown) => {
  if (!isCallWindow(event.sender) || (value !== 'accept' && value !== 'decline')) return
  hideCall()
  if (value === 'accept') showWindow()
  shellWin?.page.send('desktop:callAction', value)
})
```

In the `before-quit` handler, add `hideCall()`.

- [ ] **Step 5: Verify live.** Run the app against the local server.
  - With the window unfocused, a second account starts a DM call → the call window appears bottom-right, with name and avatar, and the page rings.
  - Decline closes it and the ring stops.
  - Call again, Accept → the main window comes forward and joins the call.
  - Call again and have the caller hang up → the window closes by itself.
  - Call again and focus the main window instead → the call window closes and the in-app ring shows.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/callWindow.ts desktop/static/call.html desktop/src/main.ts desktop/src/preload.ts
git commit -m "Desktop: the incoming-call window"
```

---

### Task 9: Prove it, and record it

- [ ] **Step 1: Full suite** with the CI env vars (`.github/workflows/ci.yml`): `npx vitest run` → all pass. Types: `npx vue-tsc --noEmit`, `npx tsc --noEmit -p tsconfig.server.json`, `npx tsc --noEmit -p desktop/tsconfig.json`.
- [ ] **Step 2: The live checklist from the spec**, in the desktop app with a second account, writing down pass or fail for each:
  - DM while unfocused → toast;
  - Reply sends;
  - Mark as read clears the badge;
  - a click opens the conversation;
  - closed to the tray, a DM still toasts;
  - call window: Accept joins, and the window closes when the caller hangs up;
  - Quit from the tray quits;
  - Do Not Disturb → nothing;
  - a muted DM → nothing;
  - a channel @mention → toast, a plain channel message → none;
  - previews off → "New message".
  
  In a browser tab: the permission prompt appears once; a DM in a background tab → a web notification; clicking it focuses the tab on the DM.
- [ ] **Step 3: Screenshots** of a toast, the tray menu, the badge and the call window. Look at each before reporting.
- [ ] **Step 4: Roadmap** — in `docs/ROADMAP.md`, mark slice 5.4 ✅ with the date, one line on what shipped, and the known limits (mentions by name; a crash-left toast cannot route a reply).
- [ ] **Step 5: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "Roadmap: tray and notifications done"
```
