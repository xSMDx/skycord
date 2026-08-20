# Channels Plan 3a — Client Vertical Slice

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make servers and text channels real in the UI — create a server, see it in the rail, pick a text channel, read history, send, and receive live — replacing the four hardcoded mock servers.

**Architecture:** A new module-level composable `useServers` owns server/channel state the way `useMessages` owns message state; `ChatApp.vue` reads from it instead of its `const servers`/`const channels` literals. Channel messages reuse the existing `useMessages.serverMessages` store, which already exists keyed by channel id. Sending is REST (`POST /servers/:sid/channels/:cid/messages`) — there is no `channel:send` socket event by design; the server broadcasts `channel:receive` to the `chan:<id>` room the socket layer joined at connect.

**Tech Stack:** Vue 3 `<script setup lang="ts">`, Composition API, socket.io-client, vitest (node environment, no DOM).

## Global Constraints

- **No new runtime or dev dependencies.** In particular no `jsdom` and no `@vue/test-utils` — this repo has never had a client test and this slice is not where that gets introduced. Tests cover plain-TS composables, which run in vitest's default node environment. Rendering is verified in the browser pane.
- **All 125 existing server tests stay green.** Run `npx vitest run` — not a filtered subset — before every commit.
- **`npm run typecheck` must exit 0.** It runs `vue-tsc` over the client and `tsc` over the server.
- **No `.vue` imports in any test file.** Vitest's default environment has no DOM; a test that imports a component will fail at mount, not at assert.
- **Server-side code is out of scope.** The API and socket surface this plan consumes is already merged and tested. If a task appears to need a server change, stop and report it rather than editing `server/`.
- **Wire event names, exactly:** `channel:receive`, `channel:created`, `channel:updated`, `channel:deleted`, `server:updated`, `server:deleted`, `server:memberJoined`, `server:memberLeft`.
- **Out of scope for 3a** (these are 3b): voice-channel join, member list, Server Settings, invite creation/join UI, channel create/delete UI, phone layout, drag reordering, categories.

---

### Task 1: Extract the ApiMessage → Message adapter

The mapping from a wire message to the client `Message` type is written out **four times** in `ChatApp.vue` (lines 763, 835, 935, 1031 — DM history, group history, `onMessage`, `onGroupMessage`). The channel path needs a fifth. Extract it first so the rest of the plan consumes one copy.

**Files:**
- Create: `src/composables/useMessageAdapter.ts`
- Create: `src/composables/__tests__/useMessageAdapter.test.ts`
- Modify: `src/views/ChatApp.vue` (four call sites)

**Interfaces:**
- Consumes: `ApiMessage` from `src/composables/useApi.ts`, `Message` from `src/types`, `avatarFor` from `src/composables/useAvatar.ts`
- Produces: `toClientMessage(m, myId?): Message` — used by Tasks 3 and 4

- [ ] **Step 1: Write the failing test**

Create `src/composables/__tests__/useMessageAdapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toClientMessage } from '../useMessageAdapter'

const base = {
  _id: '507f1f77bcf86cd799439011',
  conversationId: 'chan1',
  authorId: 'u1',
  authorName: 'Ada',
  authorAvatar: null,
  content: 'hello',
  reactions: [],
  pinned: false,
  edited: false,
  createdAt: '2026-08-19T10:30:00.000Z',
}

describe('toClientMessage', () => {
  it('keeps the full ObjectId in dbId and derives a numeric id', () => {
    const m = toClientMessage(base)
    expect(m.dbId).toBe('507f1f77bcf86cd799439011')
    expect(typeof m.id).toBe('number')
    expect(Number.isNaN(m.id)).toBe(false)
  })

  it('accepts `id` when the payload has no `_id`', () => {
    const m = toClientMessage({ ...base, _id: undefined, id: '507f1f77bcf86cd799439012' })
    expect(m.dbId).toBe('507f1f77bcf86cd799439012')
  })

  it('marks a reaction as reacted only for the calling user', () => {
    const withReacts = { ...base, reactions: [{ emoji: '👍', userIds: ['u1', 'u2'] }] }
    expect(toClientMessage(withReacts, 'u1').reactions[0]).toEqual({ emoji: '👍', count: 2, reacted: true })
    expect(toClientMessage(withReacts, 'u9').reactions[0].reacted).toBe(false)
  })

  it('leaves reactions empty rather than undefined when the payload omits them', () => {
    const m = toClientMessage({ ...base, reactions: undefined })
    expect(m.reactions).toEqual([])
  })

  it('falls back to a generated avatar when the author has none', () => {
    expect(toClientMessage(base).avatar).toContain('data:image/svg+xml')
  })

  it('keeps a stored avatar as-is and carries its crop', () => {
    const crop = { zoom: 1.4, x: 10, y: -5 }
    const m = toClientMessage({ ...base, authorAvatar: 'https://cdn/x.gif', authorAvatarCrop: crop })
    expect(m.avatar).toBe('https://cdn/x.gif')
    expect(m.avatarCrop).toEqual(crop)
  })

  it('drops an empty replyTo array so `v-if="replyTo"` stays false', () => {
    expect(toClientMessage({ ...base, replyTo: [] }).replyTo).toBeUndefined()
    const parents = [{ id: 'p1', author: 'Bob', content: 'hi' }]
    expect(toClientMessage({ ...base, replyTo: parents }).replyTo).toEqual(parents)
  })

  it('derives timestamp from createdAt', () => {
    expect(toClientMessage(base).timestamp).toBe(Date.parse('2026-08-19T10:30:00.000Z'))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/composables/__tests__/useMessageAdapter.test.ts
```

Expected: FAIL — `Failed to resolve import "../useMessageAdapter"`.

- [ ] **Step 3: Write the implementation**

Create `src/composables/useMessageAdapter.ts`:

```ts
/**
 * One wire-message → client-Message mapping, shared by every path that
 * receives one: DM history, group history, channel history, and the three
 * socket receive handlers.
 *
 * This existed as four separate copies inside ChatApp.vue. They had already
 * drifted — the history copies mapped `reactions`, the socket copies hardcoded
 * `[]` — so a reaction that arrived with a live message was silently dropped
 * until the next reload. One copy, one behaviour.
 */
import type { Message } from '@/types'
import { avatarFor } from './useAvatar'

/** Anything message-shaped off the wire: REST bodies and socket payloads differ. */
type WireMessage = Record<string, any>

/**
 * The client's `Message.id` is a number (it predates the database). The full
 * ObjectId lives in `dbId` and is what every server call uses — parsing the
 * hex id into a number truncates it to garbage, so the two are kept separate.
 * The numeric id only has to be unique within a rendered list, so the low 8
 * hex digits of the ObjectId are plenty.
 */
const numericId = (dbId: string): number =>
  parseInt(dbId.slice(-8), 16) || Date.now()

export const toClientMessage = (m: WireMessage, myId?: string): Message => {
  const dbId = m._id || m.id || ''
  return {
    id:          numericId(String(dbId)),
    dbId:        dbId || undefined,
    kind:        m.kind,
    systemType:  m.systemType,
    author:      m.authorName,
    authorId:    m.authorId,
    content:     m.content,
    time:        new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    timestamp:   new Date(m.createdAt).getTime(),
    avatar:      m.authorAvatar || avatarFor(m.authorName),
    avatarCrop:  m.authorAvatarCrop ?? null,
    avatarColor: '#5865f2',
    reactions:   (m.reactions || []).map((r: any) => ({
      emoji:   r.emoji,
      count:   r.userIds?.length || 0,
      reacted: !!myId && !!r.userIds?.includes(myId),
    })),
    pinned:  !!m.pinned,
    edited:  !!m.edited,
    replyTo: Array.isArray(m.replyTo) && m.replyTo.length ? m.replyTo : undefined,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/composables/__tests__/useMessageAdapter.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Migrate the four call sites in ChatApp.vue**

Add to the composable imports near the top of `<script setup>` (alongside the existing `useMessages` import around line 108):

```ts
import { toClientMessage } from '@/composables/useMessageAdapter'
```

Then replace each of the four inline object literals with a call. The DM history site (currently around line 762, inside `loadDMHistory`) becomes:

```ts
    const msgs: Message[] = data.messages.map((m: ApiMessage) => toClientMessage(m, authUser.value?.id))
```

The group history site (currently around line 834, inside `loadGroupHistory`) becomes:

```ts
    const msgs: Message[] = data.messages.map((m: ApiMessage) => toClientMessage(m, authUser.value?.id))
```

The `onMessage` socket site (currently around line 934) becomes:

```ts
    const msg: Message = toClientMessage(payload, authUser.value?.id)
```

The `onGroupMessage` socket site (currently around line 1030) becomes:

```ts
    const msg: Message = toClientMessage(payload, authUser.value?.id)
```

Each replacement removes the whole `{ id: parseInt(...), ..., replyTo: ... }` literal and nothing else — the surrounding `if (already have dbId) return` guards, the `pushDMMessage`/`pushGroupMessage` calls, and the unread bookkeeping all stay exactly as they are.

Note the deliberate behaviour change: the two socket sites previously hardcoded `reactions: []`, `pinned: false`, `edited: false`. They now map whatever the payload carries. For a freshly sent message the payload carries exactly those empty values, so live sends are unchanged; a replayed message now arrives with its reactions intact instead of blank.

- [ ] **Step 6: Verify nothing else referenced the removed literals**

```bash
grep -n "parseInt((.*'0').slice(-8), 16)" src/views/ChatApp.vue
```

Expected: no output — all four are gone.

```bash
grep -c "avatarColor: '#5865f2'," src/views/ChatApp.vue
```

Expected: `3` (down from 7 — the remaining three are local optimistic-send constructions, which this task does not touch).

- [ ] **Step 7: Typecheck and run the full suite**

```bash
npm run typecheck
```

Expected: exit 0.

```bash
npx vitest run
```

Expected: 133 passed (125 server + 8 new).

- [ ] **Step 8: Commit**

```bash
git add src/composables/useMessageAdapter.ts src/composables/__tests__/useMessageAdapter.test.ts src/views/ChatApp.vue
git commit -m "refactor: one shared ApiMessage -> Message adapter"
```

---

### Task 2: The `useServers` composable

Server and channel state, mirroring how `useMessages` holds message state: module-level refs so every component shares one copy.

**Files:**
- Create: `src/composables/useServers.ts`
- Create: `src/composables/__tests__/useServers.test.ts`
- Modify: `src/composables/useApi.ts` (five new calls, two new wire types)
- Modify: `src/types/index.ts:99-113` (widen `Server`, add `position` to `Channel`)

**Interfaces:**
- Consumes: `colorForUsername` from `src/composables/useAvatar.ts`, `useApi`
- Produces:
  - `useServers()` returning `{ servers, channelsByServer, activeServerId, activeChannelId, unreadChannels, activeServer, activeChannel, textChannels, voiceChannels, upsertServer, removeServer, receiveDetail, upsertChannel, removeChannel, markUnread, clearUnread, selectLanding, openChannel, loadServers, loadServerDetail, openServer }`
  - `serverIconFor(name: string, icon?: string | null): string`
  - types `WireServer`, `WireChannel` exported from `useApi.ts`

- [ ] **Step 1: Widen the client types**

In `src/types/index.ts`, replace the `Server` and `Channel` interfaces (currently lines 99-113) with:

```ts
export interface Server {
  id:     string
  name:   string
  /** Renderable icon: the stored icon when there is one, else a generated initials data-URI. */
  img:    string
  /** The raw stored icon, null when the user has never set one. */
  icon?:       string | null
  iconCrop?:   AvatarCrop | null
  owner?:      string
  memberCount?: number
  unread?: number
}
 
export interface Channel {
  id:       string
  name:     string
  type:     'text' | 'voice'
  serverId: string
  position?: number
  unread?:  number
  locked?:  boolean
}
```

- [ ] **Step 2: Add the REST calls to useApi**

In `src/composables/useApi.ts`, add a section after the Groups block and before Themes:

```ts
  // ── Servers & channels ───────────────────────────────────────────────────
  const createServerApi = (name: string) =>
    post<{ server: WireServer; channels: WireChannel[] }>('/servers', { name })

  const getMyServers = () =>
    get<{ servers: WireServer[] }>('/servers')

  const getServerDetail = (sid: string) =>
    get<{ server: WireServer; channels: WireChannel[] }>(`/servers/${sid}`)

  const getChannelMessagesApi = (sid: string, cid: string, before?: string) =>
    get<{ messages: ApiMessage[] }>(
      `/servers/${sid}/channels/${cid}/messages${before ? `?before=${before}` : ''}`
    )

  const sendChannelRest = (sid: string, cid: string, content: string, replyToIds: string[] = []) =>
    post<{ message: ApiMessage }>(
      `/servers/${sid}/channels/${cid}/messages`, { content, replyToIds }
    )
```

Note `sendChannelRest` sends no `authorName` or `authorAvatar`. The channel endpoint reads both from the User document and ignores the body — passing them would imply they matter.

Add all five to the returned object:

```ts
    createServerApi, getMyServers, getServerDetail, getChannelMessagesApi, sendChannelRest,
```

And add the wire types at the bottom of the file, next to `ApiMessage`:

```ts
/** Exactly `shapeServer` in server/controllers/serversController.ts:11. */
export interface WireServer {
  id:          string
  name:        string
  icon:        string | null
  iconCrop:    { zoom: number; x: number; y: number } | null
  bannerColor: string | null
  description: string | null
  owner:       string
  memberCount: number
  createdAt:   string
}

/** Exactly `shapeChannel` in server/controllers/serversController.ts:23. */
export interface WireChannel {
  id:       string
  server:   string
  name:     string
  type:     'text' | 'voice'
  position: number
}
```

- [ ] **Step 3: Write the failing test**

Create `src/composables/__tests__/useServers.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useServers, serverIconFor } from '../useServers'
import type { WireServer, WireChannel } from '../useApi'

const wireServer = (id: string, name = id): WireServer => ({
  id, name, icon: null, iconCrop: null, bannerColor: null,
  description: null, owner: 'u1', memberCount: 1, createdAt: '2026-08-19T00:00:00.000Z',
})

const wireChannel = (id: string, server: string, name: string, type: 'text' | 'voice', position = 0): WireChannel =>
  ({ id, server, name, type, position })

describe('useServers', () => {
  let s: ReturnType<typeof useServers>

  beforeEach(() => {
    s = useServers()
    // Module-level state is shared across the whole app by design, so each
    // test starts by clearing it rather than by constructing a fresh instance.
    s.servers.value = []
    s.channelsByServer.value = {}
    s.activeServerId.value = null
    s.activeChannelId.value = null
    s.unreadChannels.value = {}
  })

  it('maps a wire server into the renderable client shape', () => {
    s.upsertServer(wireServer('s1', 'Skycord HQ'))
    expect(s.servers.value).toHaveLength(1)
    expect(s.servers.value[0].name).toBe('Skycord HQ')
    expect(s.servers.value[0].img).toContain('data:image/svg+xml')
  })

  it('uses the stored icon when there is one', () => {
    s.upsertServer({ ...wireServer('s1'), icon: 'https://cdn/icon.png' })
    expect(s.servers.value[0].img).toBe('https://cdn/icon.png')
  })

  it('upsert replaces rather than duplicating', () => {
    s.upsertServer(wireServer('s1', 'Old'))
    s.upsertServer(wireServer('s1', 'New'))
    expect(s.servers.value).toHaveLength(1)
    expect(s.servers.value[0].name).toBe('New')
  })

  it('splits channels by type and sorts them by position', () => {
    s.receiveDetail(wireServer('s1'), [
      wireChannel('c2', 's1', 'off-topic', 'text', 1),
      wireChannel('c1', 's1', 'general',   'text', 0),
      wireChannel('v1', 's1', 'Lounge',    'voice', 0),
    ])
    s.activeServerId.value = 's1'
    expect(s.textChannels.value.map(c => c.name)).toEqual(['general', 'off-topic'])
    expect(s.voiceChannels.value.map(c => c.name)).toEqual(['Lounge'])
  })

  it('lands on the first text channel, never a voice one', () => {
    s.receiveDetail(wireServer('s1'), [
      wireChannel('v1', 's1', 'Lounge',  'voice', 0),
      wireChannel('c1', 's1', 'general', 'text',  0),
    ])
    s.selectLanding('s1')
    expect(s.activeChannelId.value).toBe('c1')
  })

  it('remembers the last channel you were in per server', () => {
    s.receiveDetail(wireServer('s1'), [
      wireChannel('c1', 's1', 'general',   'text', 0),
      wireChannel('c2', 's1', 'off-topic', 'text', 1),
    ])
    s.receiveDetail(wireServer('s2'), [wireChannel('c3', 's2', 'general', 'text', 0)])
    s.activeServerId.value = 's1'
    s.openChannel('c2')
    s.selectLanding('s2')
    expect(s.activeChannelId.value).toBe('c3')
    s.selectLanding('s1')
    expect(s.activeChannelId.value).toBe('c2')
  })

  it('falls back to the first text channel when the remembered one is gone', () => {
    s.receiveDetail(wireServer('s1'), [
      wireChannel('c1', 's1', 'general',   'text', 0),
      wireChannel('c2', 's1', 'off-topic', 'text', 1),
    ])
    s.activeServerId.value = 's1'
    s.openChannel('c2')
    s.removeChannel('s1', 'c2')
    s.selectLanding('s1')
    expect(s.activeChannelId.value).toBe('c1')
  })

  it('leaves activeChannelId null for a server with no text channels', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('v1', 's1', 'Lounge', 'voice', 0)])
    s.selectLanding('s1')
    expect(s.activeChannelId.value).toBeNull()
  })

  it('removing the active channel clears the selection', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.activeServerId.value = 's1'
    s.openChannel('c1')
    s.removeChannel('s1', 'c1')
    expect(s.activeChannelId.value).toBeNull()
  })

  it('removing the active server clears both selections and its channels', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.activeServerId.value = 's1'
    s.openChannel('c1')
    s.removeServer('s1')
    expect(s.servers.value).toHaveLength(0)
    expect(s.channelsByServer.value['s1']).toBeUndefined()
    expect(s.activeServerId.value).toBeNull()
    expect(s.activeChannelId.value).toBeNull()
  })

  it('removing a server you are not looking at leaves the selection alone', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.receiveDetail(wireServer('s2'), [wireChannel('c3', 's2', 'general', 'text', 0)])
    s.activeServerId.value = 's1'
    s.openChannel('c1')
    s.removeServer('s2')
    expect(s.activeServerId.value).toBe('s1')
    expect(s.activeChannelId.value).toBe('c1')
  })

  it('upsertChannel adds a new channel and updates an existing one in place', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.upsertChannel(wireChannel('c2', 's1', 'off-topic', 'text', 1))
    expect(s.channelsByServer.value['s1']).toHaveLength(2)
    s.upsertChannel(wireChannel('c2', 's1', 'renamed', 'text', 1))
    expect(s.channelsByServer.value['s1']).toHaveLength(2)
    expect(s.channelsByServer.value['s1'].find(c => c.id === 'c2')!.name).toBe('renamed')
  })

  it('ignores a channel for a server whose detail has not been fetched', () => {
    s.upsertChannel(wireChannel('c9', 'unknown', 'ghost', 'text', 0))
    expect(s.channelsByServer.value['unknown']).toBeUndefined()
  })

  it('tracks unread per channel and clears it on open', () => {
    s.markUnread('c1')
    s.markUnread('c1')
    expect(s.unreadChannels.value['c1']).toBe(2)
    s.clearUnread('c1')
    expect(s.unreadChannels.value['c1']).toBeUndefined()
  })

  it('opening a channel clears its unread count', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.activeServerId.value = 's1'
    s.markUnread('c1')
    s.openChannel('c1')
    expect(s.unreadChannels.value['c1']).toBeUndefined()
  })
})

describe('serverIconFor', () => {
  it('returns the stored icon untouched', () => {
    expect(serverIconFor('Anything', 'https://cdn/a.gif')).toBe('https://cdn/a.gif')
  })

  it('generates a stable data-URI for the same name', () => {
    expect(serverIconFor('Skycord HQ')).toBe(serverIconFor('Skycord HQ'))
  })

  it('takes one initial per word, at most two', () => {
    expect(decodeURIComponent(serverIconFor('Skycord HQ'))).toContain('>SH<')
    expect(decodeURIComponent(serverIconFor('Dev'))).toContain('>D<')
    expect(decodeURIComponent(serverIconFor('one two three'))).toContain('>ot<')
  })

  it('does not crash on an empty name', () => {
    expect(serverIconFor('')).toContain('data:image/svg+xml')
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npx vitest run src/composables/__tests__/useServers.test.ts
```

Expected: FAIL — `Failed to resolve import "../useServers"`.

- [ ] **Step 5: Write the implementation**

Create `src/composables/useServers.ts`:

```ts
/**
 * Servers and their channels.
 *
 * Module-level refs, the same shape as useMessages: one copy of the state for
 * the whole app, so the rail, the sidebar, and the socket handlers are all
 * looking at the same objects rather than each holding a snapshot.
 *
 * This replaces four hardcoded server literals and six channel literals that
 * lived inside ChatApp.vue.
 */
import { ref, computed } from 'vue'
import type { Server, Channel } from '@/types'
import type { WireServer, WireChannel } from './useApi'
import { useApi } from './useApi'
import { colorForUsername } from './useAvatar'

const servers          = ref<Server[]>([])
const channelsByServer = ref<Record<string, Channel[]>>({})
const activeServerId   = ref<string | null>(null)
const activeChannelId  = ref<string | null>(null)
/** Channel id → count of messages that arrived while you were not looking. */
const unreadChannels   = ref<Record<string, number>>({})

/**
 * Where you were last time you were in each server. Discord does this and it
 * matters more than it sounds: without it, every rail click dumps you back in
 * #general and you lose your place in the channel you were actually reading.
 * Plain object, not a ref — nothing renders it directly.
 */
const lastChannelIn: Record<string, string> = {}

/**
 * A server with no icon draws its initials on a colour derived from its name,
 * matching how a user with no avatar is handled in useAvatar. Same generator,
 * so a server and a user never look like they came from different apps.
 */
export const serverIconFor = (name: string, icon?: string | null): string => {
  if (icon) return icon
  const initials = (name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]).join('') || '?')
  const bg = colorForUsername(name || '?')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">` +
    `<rect width="48" height="48" fill="${bg}"/>` +
    `<text x="24" y="24" fill="#fff" font-family="sans-serif" font-size="18" ` +
    `font-weight="600" text-anchor="middle" dominant-baseline="central">${initials}</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const toClientServer = (w: WireServer): Server => ({
  id:          w.id,
  name:        w.name,
  img:         serverIconFor(w.name, w.icon),
  icon:        w.icon,
  iconCrop:    w.iconCrop,
  owner:       w.owner,
  memberCount: w.memberCount,
})

const toClientChannel = (w: WireChannel): Channel => ({
  id:       w.id,
  name:     w.name,
  type:     w.type,
  serverId: w.server,
  position: w.position,
})

const byPosition = (a: Channel, b: Channel) => (a.position ?? 0) - (b.position ?? 0)

export const useServers = () => {
  const api = useApi()

  // ── Pure state mutators ─────────────────────────────────────────────────

  const upsertServer = (w: WireServer) => {
    const next = toClientServer(w)
    const i = servers.value.findIndex(s => s.id === next.id)
    // Carry the unread badge across an update — a rename should not clear it.
    if (i === -1) servers.value.push(next)
    else servers.value[i] = { ...next, unread: servers.value[i].unread }
  }

  const removeServer = (sid: string) => {
    servers.value = servers.value.filter(s => s.id !== sid)
    delete channelsByServer.value[sid]
    delete lastChannelIn[sid]
    if (activeServerId.value === sid) {
      activeServerId.value  = null
      activeChannelId.value = null
    }
  }

  /** Fold a `GET /servers/:sid` response into state. */
  const receiveDetail = (w: WireServer, chans: WireChannel[]) => {
    upsertServer(w)
    channelsByServer.value[w.id] = chans.map(toClientChannel).sort(byPosition)
  }

  const upsertChannel = (w: WireChannel) => {
    // A channel for a server whose detail was never fetched has nowhere to go.
    // Creating the bucket here would half-populate it — one channel where the
    // server actually has ten — and the sidebar would render that as truth.
    const list = channelsByServer.value[w.server]
    if (!list) return
    const next = toClientChannel(w)
    const i = list.findIndex(c => c.id === next.id)
    if (i === -1) list.push(next)
    else list[i] = next
    list.sort(byPosition)
  }

  const removeChannel = (sid: string, cid: string) => {
    const list = channelsByServer.value[sid]
    if (list) channelsByServer.value[sid] = list.filter(c => c.id !== cid)
    if (lastChannelIn[sid] === cid) delete lastChannelIn[sid]
    if (activeChannelId.value === cid) activeChannelId.value = null
    delete unreadChannels.value[cid]
  }

  const markUnread  = (cid: string) => { unreadChannels.value[cid] = (unreadChannels.value[cid] || 0) + 1 }
  const clearUnread = (cid: string) => { delete unreadChannels.value[cid] }

  /** Pick which channel entering `sid` should land on. */
  const selectLanding = (sid: string) => {
    const list = channelsByServer.value[sid] ?? []
    const remembered = lastChannelIn[sid]
    const target = (remembered && list.some(c => c.id === remembered))
      ? remembered
      : list.find(c => c.type === 'text')?.id ?? null
    activeChannelId.value = target
    if (target) clearUnread(target)
  }

  const openChannel = (cid: string) => {
    activeChannelId.value = cid
    if (activeServerId.value) lastChannelIn[activeServerId.value] = cid
    clearUnread(cid)
  }

  // ── I/O ─────────────────────────────────────────────────────────────────

  const loadServers = async () => {
    const { servers: list } = await api.getMyServers()
    list.forEach(upsertServer)
  }

  const loadServerDetail = async (sid: string) => {
    const { server, channels } = await api.getServerDetail(sid)
    receiveDetail(server, channels)
  }

  /**
   * Enter a server. Channels are fetched once per server and then cached —
   * `channel:created` / `:updated` / `:deleted` keep the cache honest, so
   * refetching on every rail click would be a request that changes nothing.
   */
  const openServer = async (sid: string) => {
    activeServerId.value = sid
    if (!channelsByServer.value[sid]) await loadServerDetail(sid)
    selectLanding(sid)
  }

  // ── Derived ─────────────────────────────────────────────────────────────

  const activeServer   = computed(() => servers.value.find(s => s.id === activeServerId.value) ?? null)
  const activeChannels = computed(() =>
    activeServerId.value ? channelsByServer.value[activeServerId.value] ?? [] : [])
  const textChannels   = computed(() => activeChannels.value.filter(c => c.type === 'text'))
  const voiceChannels  = computed(() => activeChannels.value.filter(c => c.type === 'voice'))
  const activeChannel  = computed(() => activeChannels.value.find(c => c.id === activeChannelId.value) ?? null)

  return {
    servers, channelsByServer, activeServerId, activeChannelId, unreadChannels,
    activeServer, activeChannel, textChannels, voiceChannels,
    upsertServer, removeServer, receiveDetail, upsertChannel, removeChannel,
    markUnread, clearUnread, selectLanding, openChannel,
    loadServers, loadServerDetail, openServer,
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run src/composables/__tests__/useServers.test.ts
```

Expected: PASS, 19 tests.

- [ ] **Step 7: Typecheck and run the full suite**

```bash
npm run typecheck && npx vitest run
```

Expected: exit 0, then 152 passed.

- [ ] **Step 8: Commit**

```bash
git add src/composables/useServers.ts src/composables/__tests__/useServers.test.ts src/composables/useApi.ts src/types/index.ts
git commit -m "feat: useServers composable backing servers and channels with the real API"
```

---

### Task 3: Channel history and sending, in the message store

`useMessages` already has `serverMessages`, `initChannel`, and `getChannelMessages` from the mock era. `initChannel` refuses to overwrite (`if (!serverMessages.value[id])`), which is wrong for seeding from the database — a reopened channel would keep whatever was in memory and never pick up messages sent while you were away.

**Files:**
- Modify: `src/composables/useMessages.ts:16-18` (`initChannel`), and add `pushChannelMessage` next to `pushGroupMessage`
- Create: `src/composables/__tests__/useMessages.channel.test.ts`

**Interfaces:**
- Consumes: `Message` from `src/types`
- Produces: `initChannel(id, seed)` now overwrites; `pushChannelMessage(channelId, msg)` — used by Tasks 4 and 5

- [ ] **Step 1: Write the failing test**

Create `src/composables/__tests__/useMessages.channel.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useMessages } from '../useMessages'
import type { Message } from '@/types'

const msg = (id: number, dbId: string, content = 'hi'): Message => ({
  id, dbId, author: 'Ada', authorId: 'u1', content,
  time: '10:30', timestamp: 1_755_000_000_000,
  avatar: '', avatarColor: '#5865f2', reactions: [],
})

describe('useMessages — channel store', () => {
  let m: ReturnType<typeof useMessages>
  beforeEach(() => { m = useMessages(); m.initChannel('c1', []); m.initChannel('c2', []) })

  it('seeds a channel with history', () => {
    m.initChannel('c1', [msg(1, 'a')])
    expect(m.getChannelMessages('c1')).toHaveLength(1)
  })

  it('re-seeding REPLACES rather than keeping the stale list', () => {
    m.initChannel('c1', [msg(1, 'a')])
    m.initChannel('c1', [msg(2, 'b'), msg(3, 'c')])
    expect(m.getChannelMessages('c1').map(x => x.dbId)).toEqual(['b', 'c'])
  })

  it('pushes a message onto a channel that has no list yet', () => {
    m.pushChannelMessage('brand-new', msg(1, 'a'))
    expect(m.getChannelMessages('brand-new')).toHaveLength(1)
  })

  it('does not double-push the same dbId', () => {
    m.pushChannelMessage('c1', msg(1, 'a'))
    m.pushChannelMessage('c1', msg(1, 'a'))
    expect(m.getChannelMessages('c1')).toHaveLength(1)
  })

  it('de-dupes on dbId, not on the derived numeric id', () => {
    // Two different messages can collide on the numeric id (it is only the low
    // 8 hex digits of the ObjectId). Keying the guard on the numeric id would
    // silently swallow the second one.
    m.pushChannelMessage('c1', msg(7, 'aaa'))
    m.pushChannelMessage('c1', msg(7, 'bbb'))
    expect(m.getChannelMessages('c1')).toHaveLength(2)
  })

  it('keeps channels separate', () => {
    m.pushChannelMessage('c1', msg(1, 'a'))
    m.pushChannelMessage('c2', msg(2, 'b'))
    expect(m.getChannelMessages('c1')).toHaveLength(1)
    expect(m.getChannelMessages('c2')).toHaveLength(1)
  })

  it('returns an empty array for an unknown channel rather than undefined', () => {
    expect(m.getChannelMessages('nope')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/composables/__tests__/useMessages.channel.test.ts
```

Expected: FAIL — `m.pushChannelMessage is not a function`, and the re-seed test fails because `initChannel` keeps the old list.

- [ ] **Step 3: Fix `initChannel` and add `pushChannelMessage`**

In `src/composables/useMessages.ts`, replace:

```ts
  const initChannel = (id: string, seed: Message[] = []) => {
    if (!serverMessages.value[id]) serverMessages.value[id] = seed
  }
```

with:

```ts
  /**
   * Overwrites, like initDM and initGroup. The old guard (`if (!…)`) dated from
   * the mock era, where the seed was a constant and re-seeding was pointless.
   * Against a real database it is a bug: reopening a channel kept whatever was
   * in memory and never picked up messages sent while you were elsewhere.
   */
  const initChannel = (id: string, seed: Message[] = []) => {
    serverMessages.value[id] = seed
  }
```

And add, next to `pushGroupMessage`:

```ts
  const pushChannelMessage = (channelId: string, msg: Message) => {
    if (!serverMessages.value[channelId]) serverMessages.value[channelId] = []
    // Keyed on dbId, not the numeric id: the numeric id is only the low 8 hex
    // digits of the ObjectId, so two distinct messages can collide on it.
    if (!serverMessages.value[channelId].some(m => m.dbId === msg.dbId)) {
      serverMessages.value[channelId].push(msg)
    }
  }
```

Add `pushChannelMessage` to the object returned at line 124.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/composables/__tests__/useMessages.channel.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full suite**

```bash
npm run typecheck && npx vitest run
```

Expected: exit 0, then 159 passed.

- [ ] **Step 6: Commit**

```bash
git add src/composables/useMessages.ts src/composables/__tests__/useMessages.channel.test.ts
git commit -m "fix: channel message store seeds from the database instead of keeping stale state"
```

---

### Task 4: Socket wiring for channel and server events

Eight events exist on the wire and nothing in the client listens for any of them. `useSocket` registers handlers by name into its `_h` map; add the new slots there, subscribe in `connect()`, then bind them in `ChatApp.vue` next to the existing `socketOn('onGroupMessage', …)`.

**Files:**
- Modify: `src/composables/useSocket.ts` — line 39 area (`setActiveChannel`), lines 42-58 (the `_h` map), and the `connect()` body after the `group:receive` block around line 158
- Modify: `src/views/ChatApp.vue` — socket bindings after line 1054, and `liveList` at line 1060

**Interfaces:**
- Consumes: `useServers` (Task 2), `toClientMessage` (Task 1), `pushChannelMessage` (Task 3)
- Produces: `setActiveChannel(id: string | null)`; handler names `onChannelMessage`, `onChannelCreated`, `onChannelUpdated`, `onChannelDeleted`, `onServerUpdated`, `onServerDeleted`, `onServerMemberJoined`, `onServerMemberLeft`

- [ ] **Step 1: Add an active-channel tracker and the handler slots**

In `src/composables/useSocket.ts`, next to `setActiveGroup` (line 39):

```ts
// Same idea again for channels: a message arriving in the channel already on
// screen should not ding.
let _activeChannelId: string | null = null
export const setActiveChannel = (id: string | null) => { _activeChannelId = id }
```

Add to the `_h` map:

```ts
  onChannelMessage:     ((_p: any) => {}) as CB<any>,
  onChannelCreated:     ((_p: any) => {}) as CB<any>,
  onChannelUpdated:     ((_p: any) => {}) as CB<any>,
  onChannelDeleted:     ((_p: any) => {}) as CB<any>,
  onServerUpdated:      ((_p: any) => {}) as CB<any>,
  onServerDeleted:      ((_p: any) => {}) as CB<any>,
  onServerMemberJoined: ((_p: any) => {}) as CB<any>,
  onServerMemberLeft:   ((_p: any) => {}) as CB<any>,
```

- [ ] **Step 2: Subscribe to the eight events**

In `connect()`, after the `group:receive` block:

```ts
    // ── Servers & channels ──────────────────────────────────────────────
    // A channel message dings under the same rule as a group one: not from
    // you, and not the channel you are looking at. Channel mutes are not a
    // feature yet, so unlike groups there is no isMuted() check to make here.
    _socket.on('channel:receive', (p: any) => {
      if (p.authorId !== user.value?.id && _activeChannelId !== p.conversationId) soundMessage()
      _h.onChannelMessage(p)
    })

    _socket.on('channel:created',     (p: any) => _h.onChannelCreated(p))
    _socket.on('channel:updated',     (p: any) => _h.onChannelUpdated(p))
    _socket.on('channel:deleted',     (p: any) => _h.onChannelDeleted(p))
    _socket.on('server:updated',      (p: any) => _h.onServerUpdated(p))
    _socket.on('server:deleted',      (p: any) => _h.onServerDeleted(p))
    _socket.on('server:memberJoined', (p: any) => _h.onServerMemberJoined(p))
    _socket.on('server:memberLeft',   (p: any) => _h.onServerMemberLeft(p))
```

`setActiveChannel` stays a top-level `export const` and does **not** go in the object `useSocket()` returns — that matches how `setActiveGroup` and `setActiveDMPartner` are exported, so non-component code can call it.

- [ ] **Step 3: Check the payload field names before writing handlers against them**

The handlers below read `p.channel`, `p.serverId`, `p.channelId`, `p.server`, and `p.memberCount`. Confirm each against what the server actually emits rather than assuming:

```bash
grep -n "emitToServer(.*'channel:" -A 6 server/controllers/channelsController.ts
grep -n "emitToServer(.*'server:" -A 6 server/controllers/serversController.ts
grep -n "emitToServer(.*'server:memberJoined'" -A 6 server/controllers/invitesController.ts
```

Adjust the handler bodies to the real field names. If a payload lacks `memberCount`, leave the guard below in place — it makes the handler a harmless no-op — and note it as a 3b follow-up rather than editing `server/`, which is out of scope.

- [ ] **Step 4: Bind the handlers in ChatApp.vue**

Add the import alongside the other composable imports:

```ts
import { useServers } from '@/composables/useServers'
```

and destructure, near the existing `useMessages` destructure around line 108:

```ts
const {
  servers, activeServerId, activeChannelId,
  activeServer, activeChannel, textChannels, voiceChannels, unreadChannels,
  loadServers, openServer: enterServer, openChannel, selectLanding,
  upsertServer, removeServer, upsertChannel, removeChannel, markUnread,
} = useServers()
```

`openServer` is aliased to `enterServer` because `ChatApp.vue` already has a function of that name — the rail's click handler, rewritten in Task 5 Step 5, which wraps this one. `channelsByServer` and `receiveDetail` are deliberately not destructured here: nothing in `ChatApp.vue` needs them, and `CreateServerModal` calls `useServers()` itself for `receiveDetail`.

Three existing destructures in `ChatApp.vue` also need extending — all three are within the first 115 lines:

```ts
// the `= api` destructure at line 98 gains:
  getChannelMessagesApi, sendChannelRest,

// the `useMessages()` destructure at line 107 gains pushChannelMessage
// and DROPS sendChannel, whose only call site Task 5 replaces:
  pushDMMessage, pushGroupMessage, pushChannelMessage,
  sendDM, sendGroup,

// and the useSocket import gains setActiveChannel alongside setActiveGroup.
```

Note the two message getters that now coexist: `getChannelMessages` (the local store, from `useMessages`) and `getChannelMessagesApi` (the HTTP call, from `useApi`). The `Api` suffix exists to keep them apart — do not "tidy" it away.

Then, immediately after the `socketOn('onGroupMessage', …)` block (currently ending around line 1054):

```ts
  // ── Servers & channels ────────────────────────────────────────────────────
  socketOn('onChannelMessage', (payload: any) => {
    const channelId = payload.conversationId
    // Reconnect can replay, and our own send already stamped its dbId from the
    // 201 response. Either way, having the id means we have the message.
    if (payload._id && getChannelMessages(channelId).some(m => m.dbId === payload._id)) return
    pushChannelMessage(channelId, toClientMessage(payload, authUser.value?.id))
    const looking = view.value === 'server' && activeChannelId.value === channelId
    if (!looking) markUnread(channelId)
  })

  socketOn('onChannelCreated', (p: any) => upsertChannel(p.channel))
  socketOn('onChannelUpdated', (p: any) => upsertChannel(p.channel))
  socketOn('onChannelDeleted', (p: any) => {
    removeChannel(p.serverId, p.channelId)
    // removeChannel clears activeChannelId when the deleted channel was the one
    // on screen. Land somewhere real rather than on an empty pane.
    if (!activeChannelId.value && activeServerId.value === p.serverId) {
      selectLanding(p.serverId)
      if (activeChannelId.value) {
        setActiveChannel(activeChannelId.value)
        loadChannelHistory(activeChannelId.value)
      }
    }
  })

  socketOn('onServerUpdated', (p: any) => upsertServer(p.server))
  socketOn('onServerDeleted', (p: any) => {
    const wasHere = activeServerId.value === p.serverId
    removeServer(p.serverId)
    if (wasHere) { setActiveChannel(null); openFriends() }
  })

  // The member list is 3b; until then the only visible consequence of someone
  // joining or leaving is the count, so keep just that honest.
  const syncMemberCount = (p: any) => {
    const s = servers.value.find(x => x.id === p.serverId)
    if (s && typeof p.memberCount === 'number') s.memberCount = p.memberCount
  }
  socketOn('onServerMemberJoined', syncMemberCount)
  socketOn('onServerMemberLeft',   syncMemberCount)
```

- [ ] **Step 4b: Define `loadChannelHistory`**

The `onChannelDeleted` handler above calls it, so it is defined here rather than in Task 5. Add it next to `loadGroupHistory` (around line 830), mirroring that function's shape:

```ts
const loadChannelHistory = async (channelId: string) => {
  const sid = activeServerId.value
  if (!sid) return
  loadingMsgs.value = true
  try {
    const data = await getChannelMessagesApi(sid, channelId)
    initChannel(channelId, data.messages.map(m => toClientMessage(m, authUser.value?.id)))
  } catch (e) {
    console.error('[loadChannelHistory]', e)
    initChannel(channelId, [])
  } finally {
    loadingMsgs.value = false
    await nextTick()
    msgListRef.value?.scrollToBottom()
  }
}
```

Everything it depends on already exists: `getChannelMessagesApi` from Task 2, `toClientMessage` from Task 1, `initChannel` from Task 3, and `loadingMsgs` / `msgListRef` / `nextTick` from `ChatApp.vue` itself. Declare it **above** the socket-handler block that calls it — the handlers are registered inside a function that runs on mount, but `const` arrow functions are not hoisted, so a definition placed after the registration site would still be in scope at call time yet reads confusingly; keep it with its sibling history loaders.

- [ ] **Step 5: Extend `liveList` so edits, deletes, pins and reactions reach channels**

`liveList()` at line 1060 resolves the message list the live-update handlers write into. It knows about groups and DMs only, so a `message:edited` arriving for a channel currently lands nowhere. The server-side half of this was fixed on the `channels-hardening` branch (`canAccessMessage` gained a channel branch and the four handlers now broadcast to `chan:<id>`); this is the client half. Replace:

```ts
  const liveList = (): Message[] => {
    if (view.value === 'group' && activeGroup.value) return getGroupMsgs(activeGroup.value.id)
    if (activeDM.value) return getDMMessages(activeDM.value.id)
    return []
  }
```

with:

```ts
  const liveList = (): Message[] => {
    if (view.value === 'server' && activeChannelId.value) return getChannelMessages(activeChannelId.value)
    if (view.value === 'group'  && activeGroup.value)     return getGroupMsgs(activeGroup.value.id)
    if (activeDM.value)                                   return getDMMessages(activeDM.value.id)
    return []
  }
```

The channel branch goes first: `activeDM.value` is not cleared on every path into a server, so a trailing `if (activeDM.value)` would otherwise win and route a channel edit into the last DM you had open.

- [ ] **Step 6: Typecheck and run the full suite**

```bash
npm run typecheck && npx vitest run
```

Expected: exit 0, then 159 passed. This task adds no tests — it is wiring between two already-tested modules, and its gate is the two-client browser pass in Task 6.

- [ ] **Step 7: Commit**

```bash
git add src/composables/useSocket.ts src/views/ChatApp.vue
git commit -m "feat: subscribe to channel and server lifecycle events"
```

---

### Task 5: Render real servers and channels

Delete the mock literals and point the rail, the sidebar, and the send path at `useServers`.

**Files:**
- Modify: `src/views/ChatApp.vue` — `:281-282` (the old string refs), `:492-505` (the mocks), `:621-624` (the computeds), `:658`, `:830` area (add `loadChannelHistory`), `:1236-1241` (`openServer`), `:1338` (`doSend`), `:1360`, `:1392`, `:1823-1842` (rail), `:1955-1990` (sidebar), boot sequence around `:709`

**Interfaces:**
- Consumes: everything produced by Tasks 1-4
- Produces: `loadChannelHistory(channelId)` and `selectChannel(ch)` — used by Task 6

- [ ] **Step 1: Delete the mock data**

Remove the `// ── Static server/channel data ──` comment, `const servers: Server[] = [...]`, and `const channels: Channel[] = [...]` (they were at lines 492-505 before earlier tasks shifted things). Leave `const members: Member[] = []` alone; the member list is 3b. (`voiceUsers` and `roleColor`, which used to sit in this block, were already removed as dead code in commit `5d36e2a`.)

There is a **second** mock-data site further down, inside `onMounted` — currently around line 1524, immediately after `await loadMyGroups()`:

```ts
  initChannel('general', [
    { id: 1, author: 'Skycord', authorId: 'system', avatar: avatarFor('skycord'),
      avatarColor: '#5865f2', time: '12:00 PM', timestamp: Date.now() - 5000000,
      content: '👋 Welcome to Skycord! Add friends to start chatting.', reactions: [] },
  ])
  channels.filter(c => c.type === 'text' && c.id !== 'general').forEach(c => initChannel(c.id, []))
```

Delete both statements. They seed a fake welcome message into a channel literally named `general` — a mock id, not a real one — and the second line will not even compile once `channels` is gone. Channel history now comes from `loadChannelHistory`, which Step 4 adds.

```bash
grep -n "initChannel" src/views/ChatApp.vue
```

Expected after this step: one hit, the destructure at line ~109. If `initChannel` ends up with no callers at all in `ChatApp.vue`, remove it from that destructure too — Step 4 adds it back as a real caller, so most likely it stays.

- [ ] **Step 2: Delete the computeds the composable replaces**

Remove lines 621-624:

```ts
const textChannels    = computed(() => channels.filter(c => c.type === 'text'  && c.serverId === activeServer.value))
const voiceChannels   = computed(() => channels.filter(c => c.type === 'voice' && c.serverId === activeServer.value))
const currentChannel  = computed(() => channels.find(c => c.id === activeChannel.value))
const currentServer   = computed(() => servers.find(s => s.id === activeServer.value))
```

`textChannels` and `voiceChannels` now come from `useServers`. `currentChannel` and `currentServer` are replaced by `activeChannel` and `activeServer` — rename every template reference (`currentServer?.name` in the sidebar header, `currentChannel?.name` in the chat header, and any others the grep below turns up).

```bash
grep -n "currentServer\|currentChannel" src/views/ChatApp.vue
```

- [ ] **Step 3: Delete the old string refs and fix every reference**

Remove lines 281-282:

```ts
const activeServer  = ref('sykord')
const activeChannel = ref('general')
```

Both names now belong to the `useServers` computeds destructured in Task 4, and the **ids** they used to hold live in `activeServerId` / `activeChannelId`.

```bash
grep -n "activeServer\.value\|activeChannel\.value" src/views/ChatApp.vue
```

Work through every hit: anywhere the old ref was used as an id, it becomes `activeServerId.value` / `activeChannelId.value`. The sites known in advance are line 658 (`getChannelMessages(activeChannel.value)`), 1237 (`activeServer.value = srv.id`), 1338 (`sendChannel(activeChannel.value, …)`), 1360 (`getChannelMessages(activeChannel.value)`), and 1392 (`toggleChannelReaction(activeChannel.value, …)`). Lines 658 and 1360 need a null guard, since `activeChannelId` can be `null` where the old ref was always a string:

```ts
  if (view.value === 'server') return activeChannelId.value ? getChannelMessages(activeChannelId.value) : []
```

- [ ] **Step 4: Add the channel-open handler**

`loadChannelHistory` already exists — Task 4 added it next to `loadGroupHistory`, because its `onChannelDeleted` handler needed it. Do not define it again; just call it.

Add a channel-open handler, next to `openGroup`:

```ts
const selectChannel = async (ch: Channel) => {
  if (ch.type !== 'text') return          // voice-channel join is 3b
  openChannel(ch.id)
  setActiveChannel(ch.id)
  await loadChannelHistory(ch.id)
}
```

Call `setActiveChannel(null)` everywhere `setActiveGroup(null)` is already called, so leaving a server stops suppressing that channel's ding:

```bash
grep -n "setActiveGroup(null)" src/views/ChatApp.vue
```

- [ ] **Step 5: Rewrite `openServer`**

Replace lines 1236-1241:

```ts
const openServer = async (srv: Server) => {
  view.value = 'server'
  setActiveDMPartner(null)
  setActiveGroup(null)
  try {
    await enterServer(srv.id)
  } catch (e) {
    console.error('[openServer]', e)
    showToast('Could not open that server')
    return
  }
  if (activeChannelId.value) {
    setActiveChannel(activeChannelId.value)
    await loadChannelHistory(activeChannelId.value)
  } else {
    setActiveChannel(null)
  }
}
```

- [ ] **Step 6: Send over REST**

`doSend` ends with a three-way `if / else if / else if` on `view.value`. The last branch (line ~1336) currently reads:

```ts
  } else if (view.value === 'server') {
    sendChannel(activeChannel.value, name, userId, myAvatar.value, text)
    newMessage.value = ''
    await nextTick(); msgListRef.value?.scrollToBottom()
  }
```

Replace that branch body with:

```ts
  } else if (view.value === 'server') {
    const sid = activeServerId.value, cid = activeChannelId.value
    if (!sid || !cid) { sendingMsg.value = false; return }

    // `replyIds` in the DM and group branches is scoped inside each of those
    // blocks, so it is not in scope here — recompute it from the same source
    // and clear the targets the same way they do.
    const replyIds = replyTargetMeta.value.map(r => r.id)
    replyTargets.value = []

    newMessage.value = ''
    try {
      const { message } = await sendChannelRest(sid, cid, text, replyIds)
      pushChannelMessage(cid, toClientMessage(message, authUser.value?.id))
    } catch (e: any) {
      console.error('[doSend channel]', e)
      showToast(e?.message || 'Message failed to send')
      newMessage.value = text     // give the text back rather than losing it
    } finally {
      sendingMsg.value = false
    }
    await nextTick(); msgListRef.value?.scrollToBottom()
  }
```

Two details worth not getting wrong. `sendingMsg.value = false` belongs in a `finally`, matching the group branch — the old mock branch never set it because it never awaited anything, so a failed send would otherwise leave the composer disabled forever. And `sendChannel` from `useMessages` is now unused; delete its import if nothing else references it.

There is deliberately no optimistic insert. The POST returns the real message and the round trip is local; an optimistic copy would need reconciling against both the 201 and the `channel:receive` echo, which is three code paths kept consistent for a few tens of milliseconds. If that latency turns out to matter over the real VPS, add it in 3b — Task 3's dedupe tests already cover the hard part.

- [ ] **Step 7: Point the rail at real servers**

The rail's `v-for` (lines 1832-1838) already reads `servers`, which is now the ref from `useServers`, so only the active check changes:

```html
        <div v-for="srv in servers" :key="srv.id"
          class="ri" :class="{ active: view==='server' && activeServerId===srv.id }"
          v-tip="srv.name" @click.stop="openServer(srv)">
          <div class="ri-pip" />
          <div class="ri-icon"><img :src="srv.img" :alt="srv.name" /></div>
          <span v-if="srv.unread" class="ri-badge">{{ srv.unread }}</span>
        </div>
```

- [ ] **Step 8: Point the sidebar at real channels**

In the channel sidebar (lines 1956-1990) — header:

```html
        <div class="sb-header">
          <span>{{ activeServer?.name }}</span>
          <ChevronDown :size="14" :stroke-width="1.5"/>
        </div>
```

Text channels. The `Lock` branch goes — `locked` was mock-only and per-channel permissions are not a feature. The `+` button next to the group label goes too, rather than being left as a control that does nothing (channel creation is 3b):

```html
          <div class="ch-group">
            <div class="ch-group-label">
              <ChevronRight :size="10" :stroke-width="2.25"/><span>Text Channels</span>
            </div>
            <button v-for="ch in textChannels" :key="ch.id"
              class="ch-item" :class="{ active: activeChannelId===ch.id, unread: !!unreadChannels[ch.id] }"
              @click="selectChannel(ch)">
              <Hash class="ch-icon" :size="15" :stroke-width="1.5"/>
              <span class="ch-name">{{ ch.name }}</span>
              <span v-if="unreadChannels[ch.id]" class="ch-unread">{{ unreadChannels[ch.id] }}</span>
            </button>
          </div>
```

Voice channels keep rendering (every server has a default `General` voice channel) but stay inert, and the hardcoded `LIVE` badge goes — nothing is live in it yet:

```html
            <button v-for="ch in voiceChannels" :key="ch.id" class="ch-item voice">
              <Volume2 class="ch-icon" :size="15" :stroke-width="1.5"/>
              <span class="ch-name">{{ ch.name }}</span>
            </button>
```

If `Lock` is now unused, remove it from the lucide import list — `vue-tsc` will not flag it but the build will warn.

- [ ] **Step 9: Load servers at boot**

In the boot sequence alongside the existing DM/group/prefs fetches (around line 709):

```ts
    // The rail is the app's spine — an empty one reads as "you have no servers"
    // rather than "this failed", so a failure is worth a console warning even
    // though it must not block the rest of boot.
    loadServers().catch(e => console.warn('[servers] rail unavailable', e))
```

- [ ] **Step 10: Verify the mocks are gone, then typecheck and build**

```bash
grep -n "'sykord'\|'gaming'\|dicebear\|off-topic" src/views/ChatApp.vue
```

Expected: no output.

```bash
npm run typecheck && npx vitest run && npx vite build
```

Expected: exit 0 for all three, 159 tests passing.

- [ ] **Step 11: Commit**

```bash
git add src/views/ChatApp.vue
git commit -m "feat: rail and channel sidebar render real servers and channels"
```

---

### Task 6: Create Server modal, and verify the whole slice

Without a way to create a server the slice is unreachable — a fresh account has no servers. This is the minimum: a name and a button. Icon upload, templates, and join-by-invite are 3b.

**Files:**
- Create: `src/components/modals/CreateServerModal.vue`
- Modify: `src/views/ChatApp.vue` (the rail's `add` button at line 1841, plus state and the mount point)

**Interfaces:**
- Consumes: `createServerApi` and `receiveDetail` (Task 2), `enterServer` / `loadChannelHistory` / `setActiveChannel` (Tasks 2 and 5)
- Produces: nothing downstream — this is the last task

- [ ] **Step 1: Read the existing modal pattern first**

```bash
sed -n '1,60p' src/components/modals/NewDMModal.vue
sed -n '1,60p' src/components/modals/ModalBase.vue
```

Match `ModalBase`'s real prop names, slot names, and CSS variables. The component below is the intent; where it disagrees with what `ModalBase` actually exposes, `ModalBase` wins.

- [ ] **Step 2: Write the component**

Create `src/components/modals/CreateServerModal.vue`:

```vue
<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import ModalBase from './ModalBase.vue'
import { useApi } from '@/composables/useApi'
import { useServers } from '@/composables/useServers'

const emit = defineEmits<{ (e: 'close'): void; (e: 'created', serverId: string): void }>()

const { createServerApi } = useApi()
const { receiveDetail } = useServers()

const name  = ref('')
const busy  = ref(false)
const error = ref('')
const input = ref<HTMLInputElement | null>(null)

onMounted(async () => { await nextTick(); input.value?.focus() })

const submit = async () => {
  const n = name.value.trim()
  if (!n || busy.value) return
  busy.value  = true
  error.value = ''
  try {
    const { server, channels } = await createServerApi(n)
    // Fold it into state here rather than refetching: the 201 already carries
    // the server and its two default channels, so the modal's caller can enter
    // it without a second round trip.
    receiveDetail(server, channels)
    emit('created', server.id)
    emit('close')
  } catch (e: any) {
    // The server's own message is the useful one ("Give the server a name",
    // the rate-limit text) — only fall back when there isn't one.
    error.value = e?.message || 'Could not create that server'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalBase title="Create a server" @close="emit('close')">
    <p class="hint">Your server is where you and your friends hang out. Make yours and start talking.</p>
    <label class="lbl" for="srv-name">Server name</label>
    <input id="srv-name" ref="input" v-model="name" class="in" maxlength="100"
      placeholder="Skycord HQ" @keydown.enter.prevent="submit" />
    <p v-if="error" class="err">{{ error }}</p>
    <template #footer>
      <button class="btn ghost" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="!name.trim() || busy" @click="submit">
        {{ busy ? 'Creating…' : 'Create' }}
      </button>
    </template>
  </ModalBase>
</template>

<style scoped>
.hint{color:var(--text-muted);font-size:14px;margin:0 0 18px}
.lbl{display:block;font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px}
.in{width:100%;padding:10px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);font-size:15px}
.in:focus{outline:none;border-color:var(--accent)}
.err{color:var(--danger);font-size:13px;margin:10px 0 0}
</style>
```

- [ ] **Step 3: Wire the rail's + button**

In `ChatApp.vue`, add the state next to the other modal flags:

```ts
const showCreateServer = ref(false)
```

Change the rail's add button (line 1841):

```html
        <button class="ri add" v-tip="'Add server'" @click.stop="showCreateServer = true">
          <div class="ri-pip"/><div class="ri-icon add-icon"><Plus :size="20" :stroke-width="1.5"/></div>
        </button>
```

Mount the modal alongside the other modals at the end of the template:

```html
      <CreateServerModal v-if="showCreateServer"
        @close="showCreateServer = false"
        @created="onServerCreated" />
```

Add the handler next to `openServer`:

```ts
const onServerCreated = async (serverId: string) => {
  // The modal already folded the server and its two default channels into
  // state, so enterServer finds them cached and makes no second request.
  view.value = 'server'
  setActiveDMPartner(null)
  setActiveGroup(null)
  await enterServer(serverId)
  if (activeChannelId.value) {
    setActiveChannel(activeChannelId.value)
    await loadChannelHistory(activeChannelId.value)
  }
}
```

Import the component with the other modal imports.

- [ ] **Step 4: Typecheck, test, build**

```bash
npm run typecheck && npx vitest run && npx vite build
```

Expected: exit 0 for all three, 159 passing.

- [ ] **Step 5: Verify the whole slice in the browser**

This is the slice's real gate — Tasks 4, 5, and 6 have no unit tests and this is what covers them. Use the browser pane, not a request to the user.

Start the API and Vite (the `.claude/launch.json` entry, or `npm run dev`) and confirm MongoDB is running.

1. Log in. The rail shows only the home button — no Skycord HQ, no Gaming Zone. **If the four mock servers are still there, Task 5 Step 1 did not land.**
2. Click **+**, name a server, create. Expect: the modal closes, an icon showing the server's initials appears in the rail, the sidebar header shows the name, `#general` is selected, and the message pane is empty rather than showing mock history.
3. Send a message. Expect: it appears exactly once.
4. Reload. Expect: the server is still in the rail and the message is still there. This is what proves `loadServers`, `loadChannelHistory`, and the `initChannel` overwrite fix.
5. Switch to a DM and back to the server. Expect: the channel reloads and shows the same message, not an empty pane.
6. Open a second browser profile, log in as a second account, and join the server. The invite UI is 3b, so mint one by hand from client A's console: `await fetch('/servers/<sid>/invites', { method:'POST', headers:{ Authorization:'Bearer <token>' } }).then(r=>r.json())`, then `POST /invites/<code>` as B.
7. Send from each side. Expect: each message appears exactly once on both, and the sender never sees a duplicate — that pair is what the `.except()` on the server and the dbId dedupe in Task 3 are for.
8. With B looking at the friends view, send from A. Expect: B's sidebar shows an unread count on the channel, and clicking it clears the count and shows the message.
9. From A: edit, delete, pin, and react to a channel message. Expect: all four appear on B without a reload. This is precisely what the `liveList` channel branch in Task 4 Step 5 exists for — if any of the four does nothing on B, that branch is wrong.
10. Check `read_console_messages` for errors and `read_network_requests` for any 4xx.
11. Screenshot the server view for the report.

- [ ] **Step 6: Commit**

```bash
git add src/components/modals/CreateServerModal.vue src/views/ChatApp.vue
git commit -m "feat: create a server from the rail"
```

---

## Deploy gate

Not a task — a release blocker to hand back with the branch. Before this reaches app.skycord.xyz, `/etc/nginx/sites-available/skycord` line 8 needs `servers` and `invites` added to its location alternation. Without it both paths return 200 with the SPA's `index.html`, so every call fails by parsing HTML as JSON rather than by erroring visibly. The Vite dev proxy already has both, which is exactly why this will pass locally and fail in production.

## Carried into 3b

- **Presence events have no ordering guarantee.** Socket.IO writes in the order the `emit()` statements execute, not the order their async work began, so a rapid disconnect/reconnect can deliver `offline` after `online`. Found during the `channels-hardening` review; the fix needs a client-side sequence check.
- Voice channel join (instant on desktop, bottom sheet on touch), member list with role grouping, Server Settings, invite create/join UI, channel create/rename/delete UI, categories, the phone layout, per-server profile, and message pagination in channels (`getChannelMessagesApi` already takes `before`; nothing calls it with one yet).
