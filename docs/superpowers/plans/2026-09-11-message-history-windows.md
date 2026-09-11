# Message History Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every conversation load older history as you scroll up, and let any message be jumped to — loading the messages around it — with a "Jump to present" way back. Part 1 of `docs/superpowers/specs/2026-09-11-message-search-design.md`.

**Architecture:** One server helper, `loadHistoryWindow`, gives the channel, DM and group history endpoints a shared cursor contract (`before`/`after`/`around` by message id, ordered by `(createdAt, _id)`, answering `hasOlder`/`hasNewer`). On the client, `useMessages` records where each conversation's loaded window sits (`hasOlder`, `live`, `awayCount`); `MessageList` asks for older/newer pages at its edges and shows a bar while the window is not live; ChatApp wires the fetches, the jump, and holds live socket arrivals while you are back in history.

**Tech Stack:** Express + Mongoose 8 (MongoDB 4.4), Vue 3 `<script setup>`, Vitest (node environment), Playwright MCP for the browser pass.

## Global Constraints

- No commits unless the user asks (repository rule). Work stays on branch `fix/channel-findings` until told otherwise.
- Server tests run against the Docker Mongo, database `sykord_test` (`server/__tests__/helpers.ts`); run with `npx vitest run <path>`.
- Keep every existing permission gate exactly as it is: a channel without Read Message History answers an empty window; a group checks membership; a DM is only ever its two participants.
- `before=<ISO date>` must keep working (clients already deployed send it).
- Comments follow the codebase's style: explain WHY, in full sentences, where the reason is not obvious.
- Dev servers: `preview_start` names `skycord-api` (8990) and `skycord-dev` (4173) from `H:\projects\.claude\launch.json`.

---

### Task 1: Server — shared history window

**Files:**
- Create: `server/utils/historyWindow.ts`
- Modify: `server/controllers/channelsController.ts` (`getChannelMessages`)
- Modify: `server/controllers/messagesController.ts` (`getDMMessages`)
- Modify: `server/controllers/conversationsController.ts` (`getGroupMessages`)
- Test: `server/__tests__/historyWindow.test.ts`

**Interfaces:**
- Produces: `loadHistoryWindow(base: Record<string, unknown>, q: HistoryQuery): Promise<HistoryWindow>`; response shape `{ messages, hasOlder: boolean, hasNewer: boolean }` on all three endpoints; 404 `"That message is no longer here"` for a cursor outside the conversation; 400 for two cursors.

- [ ] **Step 1: Write the failing test** — `server/__tests__/historyWindow.test.ts`

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { Role } from '../models/Role'
import { Conversation } from '../models/Conversation'
import { dmConvId } from '../controllers/messagesController'
import { PERMISSIONS } from '../permissions'

/**
 * Paging a conversation's history.
 *
 * The endpoints paged by `createdAt < before` alone, so two messages written in
 * the same millisecond could straddle a page boundary and one was never
 * returned. They now share one cursor contract, ordered by (createdAt, _id).
 */

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'HW' })).body
const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')

/**
 * Raw inserts, bypassing Mongoose: the tests need exact `createdAt` values,
 * including two identical ones, and `timestamps: true` would stamp its own.
 */
const seed = async (conversationId: string, kind: string, authorId: string, times: Date[], label = 'm') => {
  const docs = times.map((t, i) => ({
    _id: new Types.ObjectId(), conversationId, kind,
    authorId: new Types.ObjectId(authorId), authorName: 'seed', authorAvatar: null, authorAvatarCrop: null,
    content: `${label}${i}`, systemType: null, reactions: [], pinned: false, mentionsEveryone: false,
    edited: false, replyTo: null, replyToIds: [], createdAt: t, updatedAt: t,
  }))
  await Message.collection.insertMany(docs)
  return docs
}
const seconds = (n: number, from = Date.UTC(2026, 0, 1)) =>
  Array.from({ length: n }, (_, i) => new Date(from + i * 1000))
const contents = (res: any) => res.body.messages.map((m: any) => m.content)

const channelUrl = (sid: string, cid: string, qs = '') => `/servers/${sid}/channels/${cid}/messages${qs}`

describe('channel history', () => {
  it('returns the newest page oldest-first, and says there is more above', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    await seed(c.id, 'channel', u.id, seconds(60))

    const res = await app().get(channelUrl(server.id, c.id)).set(auth(u))
    expect(res.status).toBe(200)
    expect(contents(res)).toEqual(Array.from({ length: 50 }, (_, i) => `m${i + 10}`))
    expect(res.body.hasOlder).toBe(true)
    expect(res.body.hasNewer).toBe(false)
  })

  it('pages older by message id, to the very first message', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const docs = await seed(c.id, 'channel', u.id, seconds(60))

    const res = await app().get(channelUrl(server.id, c.id, `?before=${docs[10]._id}`)).set(auth(u))
    expect(contents(res)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`))
    expect(res.body.hasOlder).toBe(false)
  })

  it('keeps two messages from the same millisecond apart at a page boundary', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const at = new Date(Date.UTC(2026, 0, 1))
    const docs = await seed(c.id, 'channel', u.id, [at, at, at])

    const first = await app().get(channelUrl(server.id, c.id, '?limit=2')).set(auth(u))
    expect(contents(first)).toEqual(['m1', 'm2'])
    expect(first.body.hasOlder).toBe(true)

    const next = await app().get(channelUrl(server.id, c.id, `?limit=2&before=${docs[1]._id}`)).set(auth(u))
    expect(contents(next)).toEqual(['m0'])
    expect(next.body.hasOlder).toBe(false)
  })

  it('loads around a message with the target in the middle', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const docs = await seed(c.id, 'channel', u.id, seconds(21))

    const res = await app().get(channelUrl(server.id, c.id, `?limit=5&around=${docs[10]._id}`)).set(auth(u))
    expect(contents(res)).toEqual(['m8', 'm9', 'm10', 'm11', 'm12'])
    expect(res.body.hasOlder).toBe(true)
    expect(res.body.hasNewer).toBe(true)
  })

  it('pages newer by message id, and says when it has reached the end', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const docs = await seed(c.id, 'channel', u.id, seconds(21))

    const mid = await app().get(channelUrl(server.id, c.id, `?limit=5&after=${docs[10]._id}`)).set(auth(u))
    expect(contents(mid)).toEqual(['m11', 'm12', 'm13', 'm14', 'm15'])
    expect(mid.body.hasNewer).toBe(true)

    const end = await app().get(channelUrl(server.id, c.id, `?limit=5&after=${docs[18]._id}`)).set(auth(u))
    expect(contents(end)).toEqual(['m19', 'm20'])
    expect(end.body.hasNewer).toBe(false)
  })

  it('treats a message from another conversation as one that does not exist', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    await seed(c.id, 'channel', u.id, seconds(3))
    const [elsewhere] = await seed(new Types.ObjectId().toString(), 'channel', u.id, seconds(1))

    const res = await app().get(channelUrl(server.id, c.id, `?around=${elsewhere._id}`)).set(auth(u))
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/no longer here/i)
  })

  it('still accepts a date for before, from clients deployed before id cursors', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const docs = await seed(c.id, 'channel', u.id, seconds(20))

    const res = await app().get(channelUrl(server.id, c.id, `?before=${docs[10].createdAt.toISOString()}`)).set(auth(u))
    expect(contents(res)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`))
  })

  it('refuses two cursors at once', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const docs = await seed(c.id, 'channel', u.id, seconds(3))

    const res = await app().get(channelUrl(server.id, c.id, `?before=${docs[2]._id}&after=${docs[0]._id}`)).set(auth(u))
    expect(res.status).toBe(400)
  })

  it('answers a member without Read Message History with an empty window', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    const c = textOf(channels)
    await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
    await app().get(`/servers/${server.id}/roles`).set(auth(a))
    const everyone = await Role.findOne({ server: server.id, isEveryone: true })
    await app().patch(`/servers/${server.id}/channels/${c.id}`).set(auth(a)).send({
      overwrites: [{ id: everyone!._id.toString(), type: 'role', allow: '0', deny: PERMISSIONS.ReadMessageHistory.toString() }],
    })
    await seed(c.id, 'channel', a.id, seconds(5))

    const res = await app().get(channelUrl(server.id, c.id)).set(auth(b))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ messages: [], hasOlder: false, hasNewer: false })
  })
})

describe('DM and group history', () => {
  it('pages a DM with the same contract', async () => {
    const a = await register(), b = await register()
    const docs = await seed(dmConvId(a.id, b.id), 'dm', a.id, seconds(5))

    const res = await app().get(`/messages/dm/${b.id}?limit=2`).set(auth(a))
    expect(contents(res)).toEqual(['m3', 'm4'])
    expect(res.body.hasOlder).toBe(true)

    const around = await app().get(`/messages/dm/${b.id}?limit=3&around=${docs[2]._id}`).set(auth(a))
    expect(contents(around)).toEqual(['m1', 'm2', 'm3'])
  })

  it('pages a group with the same contract', async () => {
    const a = await register(), b = await register()
    const group = await Conversation.create({
      type: 'group', owner: a.id, members: [a.id, b.id], lastMessageAt: new Date(),
    })
    const docs = await seed(group._id.toString(), 'group', a.id, seconds(5))

    const res = await app().get(`/conversations/groups/${group._id}/messages?limit=2&before=${docs[3]._id}`).set(auth(b))
    expect(contents(res)).toEqual(['m1', 'm2'])
    expect(res.body.hasOlder).toBe(true)
    expect(res.body.hasNewer).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/historyWindow.test.ts`
Expected: FAIL — `hasOlder`/`hasNewer` undefined, the same-millisecond page returns `[]` for `m0`, `around`/`after` ignored.

- [ ] **Step 3: Write the helper** — `server/utils/historyWindow.ts`

```ts
import { Types } from 'mongoose'
import { Message } from '../models/Message'

/**
 * One page of a conversation's history — older, newer, or around one message.
 *
 * Shared by the channel, DM and group history endpoints, which used to page by
 * `createdAt < before` alone. Two messages written in the same millisecond then
 * sat on a page boundary with nothing to tell them apart, and one was never
 * returned. Ordering by `(createdAt, _id)` and continuing strictly past the
 * cursor's pair makes every boundary exact.
 *
 * `base` is the endpoint's own filter (conversation id, and the kinds it
 * serves). Every cursor is looked up INSIDE it, so an id from another
 * conversation behaves exactly like one that does not exist.
 */

export const HISTORY_LIMIT = 50
export const HISTORY_MAX   = 100

export interface HistoryQuery { before?: unknown; after?: unknown; around?: unknown; limit?: unknown }

export type HistoryWindow =
  | { ok: true; messages: any[]; hasOlder: boolean; hasNewer: boolean }
  | { ok: false; status: 400 | 404; message: string }

interface Cursor { createdAt: Date; _id: Types.ObjectId }

const GONE = { ok: false, status: 404, message: 'That message is no longer here' } as const

const isId = (s: string) => /^[a-f0-9]{24}$/i.test(s)
const given = (v: unknown) => v != null && v !== ''

const olderThan = (c: Cursor) => ({
  $or: [{ createdAt: { $lt: c.createdAt } }, { createdAt: c.createdAt, _id: { $lt: c._id } }],
})
const newerThan = (c: Cursor) => ({
  $or: [{ createdAt: { $gt: c.createdAt } }, { createdAt: c.createdAt, _id: { $gt: c._id } }],
})

const clampLimit = (raw: unknown) => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), HISTORY_MAX) : HISTORY_LIMIT
}

/**
 * `n` rows on one side of `edge` (the newest `n` when there is none), returned
 * oldest-first, and whether more exist beyond them. One extra row is read
 * rather than a count query: it answers "is there more" for free.
 */
const page = async (base: object, side: 'older' | 'newer', edge: Cursor | null, n: number) => {
  if (n <= 0) return { rows: [] as any[], more: false }
  const filter = edge ? { $and: [base, side === 'older' ? olderThan(edge) : newerThan(edge)] } : base
  const dir = side === 'older' ? -1 : 1
  const rows = await Message.find(filter).sort({ createdAt: dir, _id: dir }).limit(n + 1).lean()
  const more = rows.length > n
  const kept = rows.slice(0, n)
  return { rows: side === 'older' ? kept.reverse() : kept, more }
}

export const loadHistoryWindow = async (
  base: Record<string, unknown>,
  q: HistoryQuery,
): Promise<HistoryWindow> => {
  const limit = clampLimit(q.limit)
  if ([q.before, q.after, q.around].filter(given).length > 1) {
    return { ok: false, status: 400, message: 'Use only one of before, after or around' }
  }

  const find = async (raw: unknown) => {
    const id = String(raw)
    if (!isId(id)) return null
    return Message.findOne({ ...base, _id: id }).lean()
  }

  if (given(q.around)) {
    const target = await find(q.around)
    if (!target) return GONE
    const olderN = Math.floor(limit / 2)
    const newerN = limit - olderN - 1
    const [older, newer] = await Promise.all([
      page(base, 'older', target as Cursor, olderN),
      page(base, 'newer', target as Cursor, newerN),
    ])
    return { ok: true, messages: [...older.rows, target, ...newer.rows], hasOlder: older.more, hasNewer: newer.more }
  }

  if (given(q.after)) {
    const edge = await find(q.after)
    if (!edge) return GONE
    const newer = await page(base, 'newer', edge as Cursor, limit)
    // Paging forward FROM a message: that message, at least, is above.
    return { ok: true, messages: newer.rows, hasOlder: true, hasNewer: newer.more }
  }

  let edge: Cursor | null = null
  if (given(q.before)) {
    const raw = String(q.before)
    if (isId(raw)) {
      const found = await find(raw)
      if (!found) return GONE
      edge = found as Cursor
    } else {
      // A date, from clients deployed before id cursors. An `_id` below every
      // real one keeps the tie-break inert, so this is exactly the old
      // `createdAt < before` they asked for.
      const at = new Date(raw)
      if (Number.isNaN(at.getTime())) {
        return { ok: false, status: 400, message: 'before must be a message id or a date' }
      }
      edge = { createdAt: at, _id: new Types.ObjectId('000000000000000000000000') }
    }
  }
  const older = await page(base, 'older', edge, limit)
  // Paging back from a cursor means something newer exists: at least the cursor.
  return { ok: true, messages: older.rows, hasOlder: older.more, hasNewer: edge !== null }
}
```

- [ ] **Step 4: Use it in the three endpoints**

`server/controllers/channelsController.ts` — in `getChannelMessages`, replace everything from the Read Message History line to the `res.json` with:

```ts
    if (!has(found.bits, 'ReadMessageHistory')) {
      res.json({ messages: [], hasOlder: false, hasNewer: false }); return
    }

    const channelId = found.channel._id.toString()
    const win = await loadHistoryWindow({ conversationId: channelId }, req.query as HistoryQuery)
    if (!win.ok) { res.status(win.status).json({ message: win.message }); return }
    const resolved = await resolveMessages(win.messages, channelId)
    res.json({ messages: resolved, hasOlder: win.hasOlder, hasNewer: win.hasNewer })
```

and add `import { loadHistoryWindow, type HistoryQuery } from '../utils/historyWindow'`.

`server/controllers/messagesController.ts` — `getDMMessages` body after `convId`:

```ts
    // Include 'system' (call logs like "X started a call" / "Call ended") the
    // same way group history does — they were being written but never loaded,
    // so DM call logs vanished on refresh.
    const win = await loadHistoryWindow(
      { conversationId: convId, kind: { $in: ['dm', 'system'] } }, req.query as HistoryQuery,
    )
    if (!win.ok) { res.status(win.status).json({ message: win.message }); return }
    const resolved = await resolveMessages(win.messages, convId)
    res.json({ messages: resolved, hasOlder: win.hasOlder, hasNewer: win.hasNewer })
```

(remove the now-unused `before` / `limit` locals; add the same import).

`server/controllers/conversationsController.ts` — `getGroupMessages` body after the membership check:

```ts
    const win = await loadHistoryWindow(
      { conversationId: groupId, kind: { $in: ['group', 'system'] } }, req.query as HistoryQuery,
    )
    if (!win.ok) { res.status(win.status).json({ message: win.message }); return }
    const resolved = await resolveMessages(win.messages, groupId)
    res.json({ messages: resolved, hasOlder: win.hasOlder, hasNewer: win.hasNewer })
```

(remove `before` / `limit`; add the import).

- [ ] **Step 5: Run the new test, then every existing message test**

Run: `npx vitest run server/__tests__/historyWindow.test.ts server/__tests__/channelMessages.test.ts server/__tests__/dmMessages.test.ts server/__tests__/groupMessages.test.ts server/__tests__/messagePermissions.test.ts server/__tests__/channelAccess.test.ts`
Expected: all PASS.

---

### Task 2: Client API — cursors and the page shape

**Files:**
- Modify: `src/composables/useApi.ts` (`getDMMessages`, `getGroupMessages`, `getChannelMessagesApi`, new `HistoryCursor` / `HistoryPage` types)

**Interfaces:**
- Produces: `HistoryCursor = { before?: string; after?: string; around?: string; limit?: number }`; `HistoryPage = { messages: ApiMessage[]; hasOlder: boolean; hasNewer: boolean }`; `getDMMessages(partnerId, cursor?)`, `getGroupMessages(groupId, cursor?)`, `getChannelMessagesApi(sid, cid, cursor?)` all returning `Promise<HistoryPage>`.

- [ ] **Step 1: Replace the three fetchers**

```ts
  /**
   * One page of a conversation's history. At most one cursor; with none, the
   * newest page. Cursors are message ids — see server/utils/historyWindow.ts.
   */
  const historyQuery = (c: HistoryCursor = {}) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(c)) if (v != null && v !== '') p.set(k, String(v))
    const s = p.toString()
    return s ? `?${s}` : ''
  }

  const getDMMessages = (partnerId: string, cursor: HistoryCursor = {}) =>
    get<HistoryPage>(`/messages/dm/${partnerId}${historyQuery(cursor)}`)

  const getGroupMessages = (groupId: string, cursor: HistoryCursor = {}) =>
    get<HistoryPage>(`/conversations/groups/${groupId}/messages${historyQuery(cursor)}`)

  const getChannelMessagesApi = (sid: string, cid: string, cursor: HistoryCursor = {}) =>
    get<HistoryPage>(`/servers/${sid}/channels/${cid}/messages${historyQuery(cursor)}`)
```

and export the types beside the other API types:

```ts
/** Which page of history to fetch. Message ids, never dates. */
export interface HistoryCursor { before?: string; after?: string; around?: string; limit?: number }

/** A page of history, and where it sits: is there more above, more below. */
export interface HistoryPage { messages: ApiMessage[]; hasOlder: boolean; hasNewer: boolean }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (existing callers pass only the ids).

---

### Task 3: Client store — where each window sits

**Files:**
- Modify: `src/composables/useMessages.ts`
- Test: `src/composables/__tests__/useMessages.window.test.ts`

**Interfaces:**
- Produces: `type ConvKind = 'dm' | 'group' | 'channel'`; `interface HistoryWindowMeta { hasOlder: boolean; live: boolean; awayCount: number }`; from `useMessages()`: `windowOf(kind, id): HistoryWindowMeta`, `setWindow(kind, id, msgs, { hasOlder, hasNewer })`, `prependOlder(kind, id, msgs, hasOlder)`, `appendNewer(kind, id, msgs, hasNewer)`, `holdIfAway(kind, id): boolean`, `windowMeta` (ref, for tests).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useMessages } from '../useMessages'
import type { Message } from '@/types'

const msg = (dbId: string, content = dbId): Message => ({
  id: parseInt(dbId.slice(-6), 16), dbId, author: 'a', authorId: 'u1', content,
  time: '', timestamp: 0, avatar: '', avatarColor: '#5865f2', reactions: [],
})
const ids = (list: Message[]) => list.map(m => m.dbId)

describe('history windows', () => {
  const s = useMessages()
  beforeEach(() => {
    s.dmMessages.value = {}; s.serverMessages.value = {}; s.groupMessages.value = {}
    s.windowMeta.value = {}
  })

  it('reads a conversation never paged as live and complete', () => {
    expect(s.windowOf('channel', 'c1')).toEqual({ hasOlder: false, live: true, awayCount: 0 })
  })

  it('records a newest page as live, with history above it', () => {
    s.setWindow('channel', 'c1', [msg('a0000000000000000000000b')], { hasOlder: true, hasNewer: false })
    expect(s.windowOf('channel', 'c1')).toEqual({ hasOlder: true, live: true, awayCount: 0 })
  })

  it('records a jump as not live', () => {
    s.setWindow('dm', 'u2', [msg('a0000000000000000000000b')], { hasOlder: true, hasNewer: true })
    expect(s.windowOf('dm', 'u2').live).toBe(false)
  })

  it('puts an older page above the window, without repeating a message', () => {
    s.setWindow('channel', 'c1', [msg('a0000000000000000000000c'), msg('a0000000000000000000000d')], { hasOlder: true, hasNewer: false })
    s.prependOlder('channel', 'c1', [msg('a0000000000000000000000b'), msg('a0000000000000000000000c')], false)
    expect(ids(s.getChannelMessages('c1'))).toEqual(['a0000000000000000000000b', 'a0000000000000000000000c', 'a0000000000000000000000d'])
    expect(s.windowOf('channel', 'c1').hasOlder).toBe(false)
  })

  it('puts a newer page below, and turns live again at the end', () => {
    s.setWindow('group', 'g1', [msg('a0000000000000000000000b')], { hasOlder: true, hasNewer: true })
    s.holdIfAway('group', 'g1')
    s.appendNewer('group', 'g1', [msg('a0000000000000000000000c')], true)
    expect(s.windowOf('group', 'g1')).toMatchObject({ live: false, awayCount: 1 })
    s.appendNewer('group', 'g1', [msg('a0000000000000000000000d')], false)
    expect(ids(s.getGroupMessages('g1'))).toEqual(['a0000000000000000000000b', 'a0000000000000000000000c', 'a0000000000000000000000d'])
    expect(s.windowOf('group', 'g1')).toMatchObject({ live: true, awayCount: 0 })
  })

  it('holds a live arrival only while the window is not live', () => {
    s.setWindow('channel', 'c1', [], { hasOlder: false, hasNewer: false })
    expect(s.holdIfAway('channel', 'c1')).toBe(false)
    s.setWindow('channel', 'c1', [], { hasOlder: true, hasNewer: true })
    expect(s.holdIfAway('channel', 'c1')).toBe(true)
    expect(s.holdIfAway('channel', 'c1')).toBe(true)
    expect(s.windowOf('channel', 'c1').awayCount).toBe(2)
  })

  it('never holds for a conversation with no window yet', () => {
    expect(s.holdIfAway('dm', 'nobody')).toBe(false)
  })

  it('treats a plain init as a fresh, live window', () => {
    s.setWindow('channel', 'c1', [], { hasOlder: true, hasNewer: true })
    s.initChannel('c1', [])
    expect(s.windowOf('channel', 'c1')).toEqual({ hasOlder: false, live: true, awayCount: 0 })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/composables/__tests__/useMessages.window.test.ts`
Expected: FAIL — `s.windowOf is not a function`.

- [ ] **Step 3: Implement in `useMessages.ts`**

Module level, after the three message refs:

```ts
/** Which conversation a window belongs to — the store keeps three lists. */
export type ConvKind = 'dm' | 'group' | 'channel'

/**
 * Where a conversation's loaded messages sit in its history.
 *
 * Before this, every list was "the newest 50" and nothing else could be
 * loaded, so nothing needed saying. Now a list can be any stretch of history:
 * one reached by scrolling up, or one loaded around a message someone jumped
 * to, which is not the present and must not have live messages appended to it.
 */
export interface HistoryWindowMeta {
  /** There is history above the first loaded message. */
  hasOlder: boolean
  /** The window reaches the newest message, so live arrivals append to it. */
  live: boolean
  /** Messages that arrived while the window was not live — counted, not shown. */
  awayCount: number
}

const windowMeta = ref<Record<string, HistoryWindowMeta>>({})
const metaKey = (kind: ConvKind, id: string) => `${kind}:${id}`
const FRESH: HistoryWindowMeta = Object.freeze({ hasOlder: false, live: true, awayCount: 0 })
```

Inside `useMessages()`, make the three `init*` functions forget the window (so a plain re-seed is a fresh, live window):

```ts
  const initDM = (id: string, seed: Message[] = []) => {
    dmMessages.value[id] = seed
    delete windowMeta.value[metaKey('dm', id)]
  }
  const initChannel = (id: string, seed: Message[] = []) => {
    serverMessages.value[id] = seed
    delete windowMeta.value[metaKey('channel', id)]
  }
  const initGroup = (id: string, seed: Message[] = []) => {
    groupMessages.value[id] = seed
    delete windowMeta.value[metaKey('group', id)]
  }
```

(keep the existing comment above `initChannel`), and add:

```ts
  const listFor = (kind: ConvKind) =>
    kind === 'dm' ? dmMessages : kind === 'group' ? groupMessages : serverMessages

  /** The window's position; a conversation never paged reads as live and complete. */
  const windowOf = (kind: ConvKind, id: string): HistoryWindowMeta =>
    windowMeta.value[metaKey(kind, id)] ?? { ...FRESH }

  /** Replace a conversation's window: a first load (live) or a jump (usually not). */
  const setWindow = (
    kind: ConvKind, id: string, msgs: Message[], page: { hasOlder: boolean; hasNewer: boolean },
  ) => {
    listFor(kind).value[id] = msgs
    windowMeta.value[metaKey(kind, id)] = { hasOlder: page.hasOlder, live: !page.hasNewer, awayCount: 0 }
  }

  /**
   * Keyed on dbId, like pushChannelMessage: a page boundary can overlap a
   * message that arrived live after the window was loaded.
   */
  const withoutKnown = (list: Message[], incoming: Message[]) => {
    const known = new Set(list.map(m => m.dbId).filter(Boolean))
    return incoming.filter(m => !m.dbId || !known.has(m.dbId))
  }

  /** An older page, above the window. */
  const prependOlder = (kind: ConvKind, id: string, msgs: Message[], hasOlder: boolean) => {
    const list = listFor(kind).value[id] ?? []
    listFor(kind).value[id] = [...withoutKnown(list, msgs), ...list]
    windowMeta.value[metaKey(kind, id)] = { ...windowOf(kind, id), hasOlder }
  }

  /** A newer page, below the window. Reaching the end makes it live again. */
  const appendNewer = (kind: ConvKind, id: string, msgs: Message[], hasNewer: boolean) => {
    const list = listFor(kind).value[id] ?? []
    listFor(kind).value[id] = [...list, ...withoutKnown(list, msgs)]
    const was = windowOf(kind, id)
    windowMeta.value[metaKey(kind, id)] = {
      ...was, live: !hasNewer, awayCount: hasNewer ? was.awayCount : 0,
    }
  }

  /**
   * A live arrival for a conversation whose window is back in history: counted
   * for the "Jump to present" bar rather than appended below messages it does
   * not follow. Returns whether it was held.
   */
  const holdIfAway = (kind: ConvKind, id: string): boolean => {
    const m = windowMeta.value[metaKey(kind, id)]
    if (!m || m.live) return false
    m.awayCount += 1
    return true
  }
```

and add to the returned object: `windowMeta, windowOf, setWindow, prependOlder, appendNewer, holdIfAway`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/composables/__tests__/useMessages.window.test.ts src/composables/__tests__/useMessages.channel.test.ts`
Expected: PASS.

---

### Task 4: MessageList — edges, the bar, and revealing a message

**Files:**
- Modify: `src/components/chat/MessageList.vue`

**Interfaces:**
- Consumes: `HistoryWindowMeta` fields passed as props.
- Produces: props `hasOlder?: boolean`, `live?: boolean`, `awayCount?: number`, `loadingOlder?: boolean`, `loadingNewer?: boolean`; emits `loadOlder`, `loadNewer`, `jumpToPresent`; exposed `revealMessage(dbId: string): Promise<boolean>`.

- [ ] **Step 1: Props and emits**

Extend `defineProps` with `hasOlder?: boolean; live?: boolean; awayCount?: number; loadingOlder?: boolean; loadingNewer?: boolean` and `defineEmits` with `loadOlder: []`, `loadNewer: []`, `jumpToPresent: []`.

- [ ] **Step 2: Edges and anchoring** — replace `onScroll`, the `messages.length` watcher and the `channelName` watcher:

```ts
/** Within this of the top, the next older page is asked for. */
const NEAR_TOP_PX = 300

/**
 * Distance from the bottom captured when an older page was asked for, so the
 * rows already on screen stay put when it lands above them. Without it the
 * browser keeps scrollTop, the new rows push everything down, and you are
 * thrown a page further back than you were reading.
 */
let anchorFromBottom: number | null = null

const onScroll = () => {
  const wasAtBottom = atBottom.value
  atBottom.value = distanceFromBottom() <= NEAR_BOTTOM_PX
  // Scrolling back down to the bottom clears the badge — you've seen them.
  if (atBottom.value && !wasAtBottom) missed.value = 0
  const n = el.value
  if (n && n.scrollTop <= NEAR_TOP_PX && props.hasOlder && !props.loadingOlder && anchorFromBottom === null) {
    anchorFromBottom = n.scrollHeight - n.scrollTop
    emit('loadOlder')
  }
  if (atBottom.value && props.live === false && !props.loadingNewer) emit('loadNewer')
}

// An older page has landed above: restore the reading position.
watch(() => props.messages[0]?.id, async () => {
  if (anchorFromBottom === null) return
  await nextTick()
  const n = el.value
  if (n) n.scrollTop = n.scrollHeight - anchorFromBottom
  anchorFromBottom = null
})
// The request finished without anything landing (an error, or nothing older).
watch(() => props.loadingOlder, loading => { if (!loading) anchorFromBottom = null })

/**
 * Follow new messages only at the bottom of a LIVE window, and count only what
 * arrives at the bottom. An older page prepended above, or a newer page
 * appended to a window back in history, is not news.
 */
watch(
  () => [props.messages.length, props.messages[props.messages.length - 1]?.id] as const,
  async ([len, lastId], [prevLen, prevLastId]) => {
    if (lastId === prevLastId) return
    if (props.live === false) return
    if (atBottom.value) { await scrollToBottom(); return }
    if (len > (prevLen ?? 0)) missed.value += len - (prevLen ?? 0)
  },
)

// Switching conversation lands at the newest message — unless the switch was a
// jump into history, which reveals its own target instead.
watch(() => props.channelName, () => { missed.value = 0; if (props.live !== false) void scrollToBottom() })
```

- [ ] **Step 3: Reveal** — add, and add it to `defineExpose`:

```ts
/**
 * Scroll a loaded message into the middle of the view and flash it. Returns
 * false when it is not in the list, so the caller can load around it first.
 */
const revealMessage = async (dbId: string): Promise<boolean> => {
  const target = props.messages.find(m => m.dbId === dbId)
  if (!target) return false
  await nextTick()
  const node = el.value?.querySelector<HTMLElement>(`[data-msg-id="${target.id}"]`)
  if (!node) return false
  node.scrollIntoView({ block: 'center' })
  node.classList.add('msg-flash')
  setTimeout(() => node.classList.remove('msg-flash'), 1200)
  return true
}
defineExpose({ scrollToBottom, startEditExternal, revealMessage })
```

- [ ] **Step 4: Template** — the welcome block only at the real beginning, a row while an older page loads, and the bar while not live:

```html
    <div v-if="!loadingMsgs && !hasOlder" class="welcome">
```

```html
    <div v-if="loadingOlder" class="ml-older" role="status">Loading older messages…</div>
```

(first child inside `.ml`, above the welcome block), and replace the jump-pill `<Transition>` with:

```html
    <Transition name="jump">
      <div v-if="live === false" class="ml-away" role="status">
        <span class="ml-away-text">
          You're viewing older messages<template v-if="awayCount"> · {{ awayCount }} new</template>
        </span>
        <button class="ml-away-btn" @click="emit('jumpToPresent')">
          Jump to present <ChevronDown :size="14" :stroke-width="2.25" />
        </button>
      </div>
      <button v-else-if="!atBottom" class="ml-jump" @click="scrollToBottom()">
        <span v-if="missed">{{ missed }} new message{{ missed === 1 ? '' : 's' }}</span>
        <span v-else>Jump to present</span>
        <ChevronDown :size="14" :stroke-width="2.25" />
      </button>
    </Transition>
```

- [ ] **Step 5: Styles** (scoped, beside `.ml-jump`):

```css
.ml-older{padding: 10px 16px;font-size:13px;color:var(--text-3);text-align:center}
/* A bar, not a pill: while you are back in history it stays for as long as you
   are there, so it sits across the foot of the list instead of floating. */
.ml-away{
  position:absolute;left:16px;right:16px;bottom:10px;z-index:5;
  display:flex;align-items:center;justify-content:space-between;gap: 12px;
  padding: 8px 8px 8px 14px;border-radius: 8px;
  background:var(--bg-floor);box-shadow:0 4px 16px rgba(0,0,0,.45);
  font-size:13px;color:var(--text-1);
}
.ml-away-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ml-away-btn{
  display:flex;align-items:center;gap: 6px;flex:none;
  padding: 6px 12px;border-radius: 6px;border:none;cursor:pointer;
  background:var(--accent);color:var(--text-on-accent);font:inherit;font-weight:600;
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

---

### Task 5: ChatApp — fetching pages, the jump, and holding live arrivals

**Files:**
- Modify: `src/views/ChatApp.vue`

**Interfaces:**
- Consumes: Task 2's fetchers and `HistoryPage`/`HistoryCursor`; Task 3's store functions; Task 4's props, events and `revealMessage`.
- Produces: `jumpToMessage(dbId: string): Promise<void>` (the one entry point Plan B's search results call after switching channel), `jumpToPresent()`.

- [ ] **Step 1: Imports and state**

Destructure `windowOf, setWindow, prependOlder, appendNewer, holdIfAway` from `useMessages()` beside the existing names; import `type HistoryCursor, type HistoryPage` from `@/composables/useApi` and `type ConvKind` from `@/composables/useMessages`. Add near `loadingMsgs`:

```ts
const loadingOlder = ref(false)
const loadingNewer = ref(false)

/** The conversation on screen, as the store and the history API name it. */
const activeConv = computed<{ kind: ConvKind; id: string } | null>(() => {
  if (view.value === 'dm'     && activeDM.value)        return { kind: 'dm',      id: activeDM.value.id }
  if (view.value === 'group'  && activeGroup.value)     return { kind: 'group',   id: activeGroup.value.id }
  if (view.value === 'server' && activeChannelId.value) return { kind: 'channel', id: activeChannelId.value }
  return null
})
const activeWindow = computed(() => activeConv.value ? windowOf(activeConv.value.kind, activeConv.value.id) : null)
const sameConv = (c: { kind: ConvKind; id: string }) =>
  activeConv.value?.kind === c.kind && activeConv.value.id === c.id

const fetchHistory = (c: { kind: ConvKind; id: string }, cursor: HistoryCursor): Promise<HistoryPage> =>
  c.kind === 'dm'    ? fetchDMMessages(c.id, cursor)
  : c.kind === 'group' ? fetchGroupMessages(c.id, cursor)
  : getChannelMessagesApi(activeServerId.value!, c.id, cursor)
const toClient = (p: HistoryPage) => p.messages.map(m => toClientMessage(m, authUser.value?.id))
```

- [ ] **Step 2: The three loaders record the window** — in `loadDMHistory`, `loadGroupHistory`, `loadChannelHistory`, replace `initDM(partnerId, msgs)` / `initGroup(groupId, msgs)` / `initChannel(channelId, …)` in the success path with:

```ts
    setWindow('dm', partnerId, msgs, { hasOlder: !!data.hasOlder, hasNewer: false })
```

```ts
    setWindow('group', groupId, msgs, { hasOlder: !!data.hasOlder, hasNewer: false })
```

```ts
    setWindow('channel', channelId, data.messages.map(m => toClientMessage(m, authUser.value?.id)),
      { hasOlder: !!data.hasOlder, hasNewer: false })
```

(error paths keep `initDM(…, [])` etc.).

- [ ] **Step 3: Older, newer, present** — add after `loadChannelHistory`:

```ts
/** The next older page, above what is on screen. MessageList asks near the top. */
const loadOlderMessages = async () => {
  const c = activeConv.value
  if (!c || loadingOlder.value || !windowOf(c.kind, c.id).hasOlder) return
  const first = getMsgList().find(m => m.dbId)
  if (!first?.dbId) return
  loadingOlder.value = true
  try {
    const page = await fetchHistory(c, { before: first.dbId })
    // The view may have moved on while the page was in flight.
    if (sameConv(c)) prependOlder(c.kind, c.id, toClient(page), page.hasOlder)
  } catch (e) { console.error('[loadOlderMessages]', e) }
  finally { loadingOlder.value = false }
}

/** The next newer page, below a window that is back in history. */
const loadNewerMessages = async () => {
  const c = activeConv.value
  if (!c || loadingNewer.value || windowOf(c.kind, c.id).live) return
  const last = [...getMsgList()].reverse().find(m => m.dbId)
  if (!last?.dbId) return
  loadingNewer.value = true
  try {
    const page = await fetchHistory(c, { after: last.dbId })
    if (sameConv(c)) appendNewer(c.kind, c.id, toClient(page), page.hasNewer)
  } catch (e) { console.error('[loadNewerMessages]', e) }
  finally { loadingNewer.value = false }
}

/** Back to the newest messages: reload the conversation as if just opened. */
const jumpToPresent = async () => {
  const c = activeConv.value
  if (!c) return
  if (c.kind === 'dm') await loadDMHistory(c.id)
  else if (c.kind === 'group') await loadGroupHistory(c.id)
  else await loadChannelHistory(c.id)
}
```

- [ ] **Step 4: The jump loads around a message it does not have** — replace `jumpToMessage`:

```ts
/**
 * Scroll to and briefly highlight a message by its dbId, loading the history
 * around it first when it is not in the window. The one entry point for reply
 * quotes, and for search results once they have switched to the channel.
 */
const jumpToMessage = async (dbId: string) => {
  if (await msgListRef.value?.revealMessage(dbId)) return
  const c = activeConv.value
  if (!c) return
  try {
    const page = await fetchHistory(c, { around: dbId })
    if (!sameConv(c)) return
    setWindow(c.kind, c.id, toClient(page), page)
  } catch (e: any) {
    showToast(e?.message || 'Couldn’t find that message')
    return
  }
  await msgListRef.value?.revealMessage(dbId)
}
```

- [ ] **Step 5: Hold live arrivals while back in history** — in `onMessage` replace `pushDMMessage(partnerId, msg)` with `if (!holdIfAway('dm', partnerId)) pushDMMessage(partnerId, msg)`; in `onGroupMessage` replace `pushGroupMessage(groupId, msg)` with `if (!holdIfAway('group', groupId)) pushGroupMessage(groupId, msg)`; in `onChannelMessage` replace the `pushChannelMessage(...)` line with `if (!holdIfAway('channel', channelId)) pushChannelMessage(channelId, toClientMessage(payload, authUser.value?.id))`. The unread and sidebar updates below each stay as they are.

- [ ] **Step 6: Sending from history lands at the present first** — at the top of `doSend`, after the `if (!text || sendingMsg.value) return` line:

```ts
  // A sent message goes on the newest end, which is not what is on screen while
  // you are back in history — so go there first, then send.
  const here = activeConv.value
  if (here && !windowOf(here.kind, here.id).live) await jumpToPresent()
```

- [ ] **Step 7: Wire MessageList** — add to the `<MessageList>` element:

```html
            :hasOlder="activeWindow?.hasOlder ?? false"
            :live="activeWindow?.live ?? true"
            :awayCount="activeWindow?.awayCount ?? 0"
            :loadingOlder="loadingOlder"
            :loadingNewer="loadingNewer"
            @loadOlder="loadOlderMessages"
            @loadNewer="loadNewerMessages"
            @jumpToPresent="jumpToPresent"
```

- [ ] **Step 8: Typecheck and the client suite**

Run: `npm run typecheck` then `npx vitest run src/`
Expected: PASS.

---

### Task 6: Verification

- [ ] **Step 1:** Full server suite in the background, grep its summary: `npx vitest run server/__tests__` → `Test Files … passed`, `EXIT 0`.
- [ ] **Step 2:** `npm run build` → `✓ built`.
- [ ] **Step 3: Browser (Playwright MCP, account A signed in, dev servers running).** Seed 150 messages into one channel of the test server with a one-off script in the scratchpad (Mongoose, the project's `.env`, never printing the connection string), then: open the channel → 50 shown; scroll to the top → older page loads and the rows on screen stay put; keep going → the welcome line appears only at the first message; reply to an old message, jump to present, click the reply quote → the chat loads around it, the bar shows; post from another tab or the API → the bar counts it, nothing is appended; scroll down → newer pages load until live; Jump to present → newest page. Screenshot the bar.
