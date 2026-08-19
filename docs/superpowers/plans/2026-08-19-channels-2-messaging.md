# Channel Messaging and Realtime Implementation Plan (2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make channels actually carry conversation — post and read messages in a text channel, receive them live over sockets, and see server members' presence.

**Architecture:** Channel messages are ordinary `Message` documents with `conversationId = channelId` and `kind: 'channel'`, resolved through the existing `resolveMessages()` so replies, reactions, pins, edits and live author avatars all work unchanged. Sockets gain one room per channel, `chan:<id>`, joined on connect. Presence fan-out widens from friends-only to friends plus anyone sharing a server.

**Tech Stack:** Express 4, Mongoose, Socket.IO, TypeScript, vitest + supertest, socket.io-client (new, tests only).

Spec: `docs/superpowers/specs/2026-08-17-channels-design.md`
Plan 1 (merged): `docs/superpowers/plans/2026-08-17-channels-1-api.md`

## Global Constraints

- **Never serialise a raw `status` column.** Presence goes through `effectiveStatus(stored, userId)` from `server/state/presence.ts`. Shipping the column caused a production bug where every user read offline.
- **One authorisation rule:** you may read or write a channel if you are a member of its server. Use `loadChannel` from `server/controllers/channelsController.ts` — do not re-derive it.
- Channel messages are `conversationId = channel._id.toString()`, `kind: 'channel'`. The `Message` model does not change.
- **Author name and avatar always come from the User document, never the request body.** This was a fixed spoofing vulnerability; every send path must keep honouring it.
- Socket rooms are **per channel** (`chan:<id>`), not per server, so that per-channel permissions in a later cycle need no re-architecture.
- Event names follow the existing convention: `channel:receive`, `channel:created`, `channel:updated`, `channel:deleted`, `server:updated`, `server:memberJoined`, `server:memberLeft`.
- **MongoDB transactions are unavailable** — standalone `mongo:4.4`, no replica set (`rs.status().ok` = 0). `withTransaction` fails at runtime. Prefer atomic single-document updates; an in-process lock is the fallback and must be documented as per-process.
- Tests run against the Docker Mongo on database `sykord_test`. Rate limiters skip when `process.env.VITEST` is set — **never** key such a guard off `NODE_ENV`, because production genuinely runs `NODE_ENV=development`.
- Do not run `npm run typecheck` — it has pre-existing client failures and its `&&` chain means the server check never runs. Use `npx tsc --noEmit -p tsconfig.server.json`, which must exit 0.

---

### Task 1: Channel messages

**Files:**
- Modify: `server/controllers/channelsController.ts`
- Modify: `server/routes/servers.ts`
- Test: `server/__tests__/channelMessages.test.ts`

**Interfaces:**
- Consumes: `loadChannel(req, res)` → `{ server, channel } | null` from `channelsController`; `resolveMessages(messages)` from `server/controllers/messagesController.ts`.
- Produces: `GET`/`POST /servers/:sid/channels/:cid/messages`.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/channelMessages.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body
const joinAsMember = async (sid: string, u: TestUser) =>
  Server.updateOne({ _id: sid }, { $push: { members: u.id } })
const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')

describe('POST /servers/:sid/channels/:cid/messages', () => {
  it('posts a message and returns it resolved', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const res = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(u)).send({ content: 'hello channel' })
    expect(res.status).toBe(201)
    expect(res.body.message.content).toBe('hello channel')
    expect(res.body.message.conversationId).toBe(c.id)
    expect(res.body.message.kind).toBe('channel')
    expect(res.body.message.authorId).toBe(u.id)
  })

  it('takes the author name from the account, never the body', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const res = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(u)).send({ content: 'x', authorName: 'Skycord System' })
    expect(res.status).toBe(201)
    expect(res.body.message.authorName).toBe(u.username)
  })

  it('rejects empty content', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(u)).send({ content: '   ' })
    expect(res.status).toBe(400)
  })

  it('refuses to post into a voice channel', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const voice = channels.find((c: any) => c.type === 'voice')
    const res = await app().post(`/servers/${server.id}/channels/${voice.id}/messages`)
      .set(auth(u)).send({ content: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/voice/i)
  })

  it('403s someone who is not a member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(b)).send({ content: 'x' })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/not a member/i)
  })

  it('lets any member post, not only the owner', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b)
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(b)).send({ content: 'from a member' })
    expect(res.status).toBe(201)
  })
})

describe('GET /servers/:sid/channels/:cid/messages', () => {
  it('returns messages oldest-first with live author data', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    await app().post(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(u)).send({ content: 'one' })
    await app().post(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(u)).send({ content: 'two' })

    const res = await app().get(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(u))
    expect(res.status).toBe(200)
    expect(res.body.messages.map((m: any) => m.content)).toEqual(['one', 'two'])
    // resolveMessages attaches live author data rather than the frozen snapshot.
    expect(res.body.messages[0]).toHaveProperty('authorAvatarCrop')
  })

  it('does not leak another channel\'s messages', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const other = (await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'second', type: 'text' })).body.channel
    await app().post(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(u)).send({ content: 'in first' })

    const res = await app().get(`/servers/${server.id}/channels/${other.id}/messages`).set(auth(u))
    expect(res.body.messages).toHaveLength(0)
  })

  it('403s a non-member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    const res = await app().get(`/servers/${server.id}/channels/${textOf(channels).id}/messages`).set(auth(b))
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/channelMessages.test.ts`
Expected: FAIL — the message routes 404.

- [ ] **Step 3: Add the handlers to `server/controllers/channelsController.ts`**

Add these imports at the top:

```ts
import { Message } from '../models/Message'
import { User } from '../models/User'
import { resolveMessages } from './messagesController'
import { getIO } from '../sockets/chatSocket'
```

Append the handlers:

```ts
/** Oldest-first, resolved so author data is live rather than the frozen snapshot. */
export const getChannelMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadChannel(req, res); if (!found) return
    const raw = await Message.find({ conversationId: found.channel._id.toString() })
      .sort({ createdAt: 1 }).lean()
    res.json({ messages: await resolveMessages(raw) })
  } catch (err) { next(err) }
}

export const sendChannelMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadChannel(req, res); if (!found) return
    const userId = req.user!.sub

    // A voice channel is one thing. Text-in-voice is deliberately out of scope.
    if (found.channel.type !== 'text') {
      res.status(400).json({ message: 'You can only post in a text channel' }); return
    }

    const { content, replyToIds } = req.body as { content?: string; replyToIds?: string[] }
    if (!content?.trim()) { res.status(400).json({ message: 'Content required' }); return }

    // Name and avatar come from the User document, never the request body —
    // accepting them from the client is how an author-spoofing hole was opened
    // on the other send paths.
    const sender = await User.findById(userId)
      .select('avatar avatarCrop displayName username').lean()

    const ids = Array.isArray(replyToIds) ? replyToIds : []
    const targets = ids.length
      ? await Message.find({ _id: { $in: ids } }).select('authorName content').lean()
      : []
    const byId = new Map(targets.map(t => [t._id.toString(), t]))
    const replyTo = ids
      .map(id => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map(t => ({ id: t._id.toString(), author: t.authorName, content: t.content.slice(0, 80) }))

    const channelId = found.channel._id.toString()
    const msg = await Message.create({
      conversationId:   channelId,
      kind:             'channel',
      authorId:         userId,
      authorName:       sender?.displayName || sender?.username || 'Unknown',
      authorAvatar:     sender?.avatar ?? null,
      authorAvatarCrop: (sender as any)?.avatarCrop ?? null,
      content:          content.trim(),
      replyToIds:       ids,
    })

    const payload = {
      _id:              msg._id.toString(),
      conversationId:   channelId,
      kind:             'channel',
      authorId:         userId,
      authorName:       msg.authorName,
      authorAvatar:     sender?.avatar ?? null,
      authorAvatarCrop: (sender as any)?.avatarCrop ?? null,
      content:          msg.content,
      reactions:        [],
      pinned:           false,
      edited:           false,
      replyTo,
      createdAt:        msg.createdAt.toISOString(),
    }

    // Reach connected members live. The sender used REST because their own
    // socket is down, so they will not echo this back to themselves.
    getIO()?.to(`chan:${channelId}`).emit('channel:receive', payload)

    res.status(201).json({ message: payload })
  } catch (err) { next(err) }
}
```

- [ ] **Step 4: Add the routes in `server/routes/servers.ts`**

Extend the channels-controller import with the two new handlers, then add:

```ts
router.get('/:sid/channels/:cid/messages',              getChannelMessages)
router.post('/:sid/channels/:cid/messages', writeLimit, sendChannelMessage)
```

`writeLimit` is already imported in this file from Task 5 of plan 1.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run server/__tests__/channelMessages.test.ts`
Expected: all 9 PASS.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run` then `npx tsc --noEmit -p tsconfig.server.json`
Expected: everything green in one run (61 + 9 = 70); typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
git add server/controllers/channelsController.ts server/routes/servers.ts server/__tests__/channelMessages.test.ts
git commit -m "feat(server): channel messages, reusing resolveMessages"
```

---

### Task 2: Invite preview

**Files:**
- Modify: `server/controllers/invitesController.ts`
- Modify: `server/routes/invites.ts`
- Test: `server/__tests__/invitePreview.test.ts`

**Interfaces:**
- Produces: `GET /invites/:code`, returning enough to render a join screen without joining.

This route exists nowhere in plan 1 and was missed in the spec's route table, but the spec justifies `description` and `bannerColor` as existing *for the invite preview*. Without it the only way to see a server is to join it irreversibly.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/invitePreview.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { ServerInvite } from '../models/ServerInvite'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body.server
const mkInvite = async (u: TestUser, sid: string, expiry = '24h') =>
  (await app().post(`/servers/${sid}/invites`).set(auth(u)).send({ expiry })).body.invite

describe('GET /invites/:code', () => {
  it('previews a server without joining it', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await app().patch(`/servers/${s.id}`).set(auth(a))
      .send({ description: 'a nice place', bannerColor: '#5865f2' })
    const inv = await mkInvite(a, s.id)

    const res = await app().get(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(200)
    expect(res.body.server.name).toBe('EA')
    expect(res.body.server.description).toBe('a nice place')
    expect(res.body.server.bannerColor).toBe('#5865f2')
    expect(res.body.server.memberCount).toBe(1)
    expect(res.body.alreadyMember).toBe(false)

    // Previewing must not join.
    const after = await app().get(`/servers/${s.id}`).set(auth(b))
    expect(after.status).toBe(403)
  })

  it('does not leak the member list or the channels', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    const res = await app().get(`/invites/${inv.code}`).set(auth(b))
    expect(res.body.server).not.toHaveProperty('members')
    expect(res.body).not.toHaveProperty('channels')
  })

  it('tells an existing member they are already in', async () => {
    const a = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    const res = await app().get(`/invites/${inv.code}`).set(auth(a))
    expect(res.status).toBe(200)
    expect(res.body.alreadyMember).toBe(true)
  })

  it('404s an unknown code', async () => {
    const u = await register()
    expect((await app().get('/invites/nope').set(auth(u))).status).toBe(404)
  })

  it('410s an expired code, distinctly from unknown', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    await ServerInvite.updateOne({ code: inv.code }, { expiresAt: new Date(Date.now() - 1000) })
    const res = await app().get(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(410)
    expect(res.body.message).toMatch(/expired/i)
  })

  it('reports a full server without joining', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    const filler = Array.from({ length: 99 }, () => new Types.ObjectId())
    await Server.updateOne({ _id: s.id }, { $push: { members: { $each: filler } } })

    const res = await app().get(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(200)
    expect(res.body.full).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/invitePreview.test.ts`
Expected: FAIL — `GET /invites/:code` 404s, because only `POST` is mounted.

- [ ] **Step 3: Add the handler to `server/controllers/invitesController.ts`**

```ts
/**
 * What a join screen needs, and nothing more. Deliberately omits the member
 * list and the channel list: the caller is not a member yet, and a preview
 * that leaked either would make an invite code a directory of who is inside.
 */
export const previewInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invite = await ServerInvite.findOne({ code: req.params.code })
    if (!invite) { res.status(404).json({ message: 'That invite does not exist' }); return }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ message: 'This invite has expired' }); return
    }
    const server = await Server.findById(invite.server)
    if (!server) { res.status(404).json({ message: 'That server no longer exists' }); return }

    const userId = req.user!.sub
    res.json({
      server: {
        id:          server._id.toString(),
        name:        server.name,
        icon:        server.icon ?? null,
        iconCrop:    server.iconCrop ?? null,
        bannerColor: server.bannerColor ?? null,
        description: server.description ?? null,
        memberCount: server.members.length,
      },
      alreadyMember: server.members.some(m => m.toString() === userId),
      full:          server.members.length >= MAX_SERVER_MEMBERS,
    })
  } catch (err) { next(err) }
}
```

Note this returns its own trimmed shape rather than `shapeServer`, because `shapeServer` includes `owner` and this must not expose it to a non-member.

- [ ] **Step 4: Add the route in `server/routes/invites.ts`**

```ts
router.get('/:code', previewInvite)
```

Place it above the existing `POST /:code`. No limiter on the GET — it is a read, and `apiLimit` already backstops it.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run server/__tests__/invitePreview.test.ts`
Expected: all 6 PASS.

- [ ] **Step 6: Full suite and typecheck**

Run: `npx vitest run` then `npx tsc --noEmit -p tsconfig.server.json`
Expected: 76 green in one run; typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
git add server/controllers/invitesController.ts server/routes/invites.ts server/__tests__/invitePreview.test.ts
git commit -m "feat(server): invite preview, so joining is not the only way to see a server"
```

---

### Task 3: Socket test harness and channel rooms

**Files:**
- Modify: `package.json` (add `socket.io-client` to devDependencies)
- Modify: `server/__tests__/helpers.ts`
- Modify: `server/sockets/chatSocket.ts`
- Test: `server/__tests__/channelSockets.test.ts`

**Interfaces:**
- Produces: `withSocketServer()` returning `{ url, close }`; `connectSocket(url, token)` returning a connected client socket; `nextEvent(socket, name, ms?)` returning a promise for the next payload. Tasks 4 and 5 use all three.

Until now nothing has tested a socket. This task builds that ability and proves it on the simplest case.

- [ ] **Step 1: Install the client**

```bash
npm install -D socket.io-client
```

- [ ] **Step 2: Add the socket helpers to `server/__tests__/helpers.ts`**

```ts
import http from 'http'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { initSocket } from '../sockets/chatSocket'

/**
 * A real HTTP server with the real socket layer attached, on an OS-assigned
 * port. Tests drive actual websockets rather than asserting on mocks.
 */
export const withSocketServer = async (): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = http.createServer(createApp())
  initSocket(server)
  await new Promise<void>(r => server.listen(0, r))
  const { port } = server.address() as import('net').AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(r => { server.close(() => r()) }),
  }
}

/** Connects an authenticated client and resolves once it is actually connected. */
export const connectSocket = (url: string, token: string): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const s = ioClient(url, { auth: { token }, transports: ['websocket'], forceNew: true })
    s.on('connect', () => resolve(s))
    s.on('connect_error', reject)
  })

/** Resolves with the next payload for `name`, or rejects if it never arrives. */
export const nextEvent = <T = any>(s: ClientSocket, name: string, ms = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${name}" within ${ms}ms`)), ms)
    s.once(name, (p: T) => { clearTimeout(timer); resolve(p) })
  })
```

`initSocket(httpServer)` is the real export at `server/sockets/chatSocket.ts:69` and returns the IO server. Do not add a new export.

- [ ] **Step 3: Write the failing test**

Create `server/__tests__/channelSockets.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }
const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

describe('channel sockets', () => {
  it('delivers a posted message to another connected member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
    const c = channels.find((x: any) => x.type === 'text')

    // b must connect AFTER joining, since rooms are joined at connect time.
    const bSock = track(await connectSocket(sockets.url, b.token))
    const received = nextEvent(bSock, 'channel:receive')

    await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(a)).send({ content: 'live hello' })

    const payload = await received
    expect(payload.content).toBe('live hello')
    expect(payload.conversationId).toBe(c.id)
    expect(payload.authorName).toBe(a.username)
  })

  it('does not deliver to someone who is not a member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    const c = channels.find((x: any) => x.type === 'text')

    const bSock = track(await connectSocket(sockets.url, b.token))
    let seen = false
    bSock.on('channel:receive', () => { seen = true })

    await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(a)).send({ content: 'private' })

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run server/__tests__/channelSockets.test.ts`
Expected: the first test FAILS with `no "channel:receive" within 3000ms`, because nothing joins `chan:` rooms yet. The second passes trivially — that is expected and it becomes meaningful once the first passes.

- [ ] **Step 5: Join channel rooms on connect in `server/sockets/chatSocket.ts`**

In the async setup block, immediately after the line that joins group rooms (`myGroups.forEach(g => socket.join(...))`), add:

```ts
      // One room per channel, not per server: a member receives only the
      // channels they can see, which is the shape per-channel permissions
      // will need in a later cycle.
      const myServers = await Server.find({ members: userId }).select('_id').lean()
      if (myServers.length) {
        const myChannels = await Channel.find({ server: { $in: myServers.map(s => s._id) } })
          .select('_id').lean()
        myChannels.forEach(c => socket.join(`chan:${c._id.toString()}`))
      }
```

Add the imports at the top of the file:

```ts
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run server/__tests__/channelSockets.test.ts`
Expected: both PASS.

- [ ] **Step 7: Full suite and typecheck**

Run: `npx vitest run` then `npx tsc --noEmit -p tsconfig.server.json`
Expected: 78 green in one run; typecheck exit 0. Sockets must be closed cleanly — a hanging suite is a finding.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json server/__tests__/helpers.ts server/sockets/chatSocket.ts server/__tests__/channelSockets.test.ts
git commit -m "feat(server): per-channel socket rooms, plus a socket test harness"
```

---

### Task 4: Lifecycle events

**Files:**
- Modify: `server/controllers/channelsController.ts`
- Modify: `server/controllers/serversController.ts`
- Modify: `server/controllers/invitesController.ts`
- Test: `server/__tests__/serverEvents.test.ts`

**Interfaces:**
- Produces: `channel:created`, `channel:updated`, `channel:deleted`, `server:updated`, `server:memberJoined`, `server:memberLeft`.

A member whose client is open must see a new channel appear without reloading, and must stop receiving a channel that was deleted.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/serverEvents.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }
const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

/** A second member, connected, ready to observe. */
const memberSocket = async (sid: string) => {
  const b = await register()
  await Server.updateOne({ _id: sid }, { $push: { members: b.id } })
  return { b, sock: track(await connectSocket(sockets.url, b.token)) }
}

describe('server and channel lifecycle events', () => {
  it('announces a new channel to members', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { sock } = await memberSocket(server.id)
    const got = nextEvent(sock, 'channel:created')

    await app().post(`/servers/${server.id}/channels`).set(auth(a))
      .send({ name: 'announcements', type: 'text' })

    const p = await got
    expect(p.channel.name).toBe('announcements')
    expect(p.serverId).toBe(server.id)
  })

  it('announces a rename', async () => {
    const a = await register()
    const { server, channels } = await mkServer(a)
    const c = channels.find((x: any) => x.type === 'text')
    const { sock } = await memberSocket(server.id)
    const got = nextEvent(sock, 'channel:updated')

    await app().patch(`/servers/${server.id}/channels/${c.id}`).set(auth(a)).send({ name: 'renamed' })
    expect((await got).channel.name).toBe('renamed')
  })

  it('announces a deletion', async () => {
    const a = await register()
    const { server, channels } = await mkServer(a)
    const voice = channels.find((x: any) => x.type === 'voice')
    const { sock } = await memberSocket(server.id)
    const got = nextEvent(sock, 'channel:deleted')

    await app().delete(`/servers/${server.id}/channels/${voice.id}`).set(auth(a))
    const p = await got
    expect(p.channelId).toBe(voice.id)
    expect(p.serverId).toBe(server.id)
  })

  it('announces a server rename', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { sock } = await memberSocket(server.id)
    const got = nextEvent(sock, 'server:updated')

    await app().patch(`/servers/${server.id}`).set(auth(a)).send({ name: 'Renamed' })
    expect((await got).server.name).toBe('Renamed')
  })

  it('announces a join to the members already inside', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const aSock = track(await connectSocket(sockets.url, a.token))
    const got = nextEvent(aSock, 'server:memberJoined')

    const inv = (await app().post(`/servers/${server.id}/invites`)
      .set(auth(a)).send({ expiry: '24h' })).body.invite
    const c = await register()
    await app().post(`/invites/${inv.code}`).set(auth(c))

    const p = await got
    expect(p.serverId).toBe(server.id)
    expect(p.member.id).toBe(c.id)
    // Presence is computed, never the stored column.
    expect(['online', 'idle', 'dnd', 'offline']).toContain(p.member.status)
  })

  it('announces a departure', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { b } = await memberSocket(server.id)
    const aSock = track(await connectSocket(sockets.url, a.token))
    const got = nextEvent(aSock, 'server:memberLeft')

    await app().delete(`/servers/${server.id}/members/${b.id}`).set(auth(b))
    const p = await got
    expect(p.serverId).toBe(server.id)
    expect(p.userId).toBe(b.id)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/serverEvents.test.ts`
Expected: all six FAIL with `no "..." within 3000ms` — nothing emits these yet.

- [ ] **Step 3: Add a small emit helper in `server/controllers/serversController.ts`**

Export it so the other two controllers can use it:

```ts
import { getIO } from '../sockets/chatSocket'
import { Channel } from '../models/Channel'

/**
 * Reach every connected member of a server. There is no `server:<id>` room —
 * rooms are per channel — so this fans out over the personal `user:<id>`
 * rooms the socket layer already maintains.
 */
export const emitToServer = (server: { members: unknown[] }, event: string, payload: unknown): void => {
  const io = getIO(); if (!io) return
  for (const m of server.members) io.to(`user:${m!.toString()}`).emit(event, payload)
}
```

- [ ] **Step 4: Emit from the channel handlers**

In `server/controllers/channelsController.ts`, import `emitToServer` from `./serversController` and add one emit before each success response:

In `createChannel`, after `Channel.create(...)`:

```ts
    const shaped = shapeChannel(channel)
    emitToServer(server, 'channel:created', { serverId: server._id.toString(), channel: shaped })

    // Members with the app open must also start RECEIVING the new channel, not
    // merely see it appear. Their sockets joined rooms at connect time, and
    // this channel did not exist then.
    const io = getIO()
    if (io) {
      const room = `chan:${channel._id.toString()}`
      for (const m of server.members) {
        const socks = await io.in(`user:${m.toString()}`).fetchSockets()
        socks.forEach(sock => sock.join(room))
      }
    }
    res.status(201).json({ channel: shaped })
```

In `updateChannel`, after `save()`:

```ts
    emitToServer(found.server, 'channel:updated', {
      serverId: found.server._id.toString(), channel: shapeChannel(found.channel),
    })
```

In `deleteChannel`, after the delete succeeds:

```ts
    const channelId = found.channel._id.toString()
    emitToServer(found.server, 'channel:deleted', {
      serverId: found.server._id.toString(), channelId,
    })
    getIO()?.in(`chan:${channelId}`).socketsLeave(`chan:${channelId}`)
```

- [ ] **Step 5: Emit from the server handlers**

In `updateServer`, after `save()`:

```ts
    emitToServer(server, 'server:updated', { server: shapeServer(server) })
```

In `removeMember`, after the `$pull`:

```ts
    emitToServer(server, 'server:memberLeft', {
      serverId: server._id.toString(), userId: target,
    })
```

`server` here is the pre-update document, so the departing member still receives their own removal — which is what lets their client drop the server from the rail.

- [ ] **Step 6: Emit the join in `server/controllers/invitesController.ts`**

After a genuine join (`modifiedCount === 1`), and after re-reading `fresh`:

```ts
      const joiner = await User.findById(userId)
        .select('username displayName avatar avatarCrop status').lean()
      if (joiner) {
        emitToServer(fresh, 'server:memberJoined', {
          serverId: fresh._id.toString(),
          member: {
            id:          userId,
            username:    (joiner as any).username,
            displayName: (joiner as any).displayName,
            avatar:      (joiner as any).avatar ?? null,
            avatarCrop:  (joiner as any).avatarCrop ?? null,
            // Computed, never the stored column.
            status:      effectiveStatus((joiner as any).status, userId),
            isOwner:     false,
          },
        })
      }
```

Import `emitToServer` from `./serversController` and `effectiveStatus` from `../state/presence`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run server/__tests__/serverEvents.test.ts`
Expected: all 6 PASS.

- [ ] **Step 8: Full suite and typecheck**

Run: `npx vitest run` then `npx tsc --noEmit -p tsconfig.server.json`
Expected: 84 green in one run; typecheck exit 0.

- [ ] **Step 9: Commit**

```bash
git add server/controllers/ server/__tests__/serverEvents.test.ts
git commit -m "feat(server): channel and server lifecycle events over sockets"
```

---

### Task 5: Presence fan-out to server members

**Files:**
- Modify: `server/sockets/chatSocket.ts`
- Test: `server/__tests__/serverPresence.test.ts`

**Interfaces:**
- Consumes: `presence.effectiveStatus`, the existing `myFriendIds` fan-out.
- Produces: presence reaching co-members, recomputed when membership changes.

The spec widened presence from friends-only to friends plus anyone sharing a server. This is the last piece.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/serverPresence.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }
const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body.server

describe('presence across a server', () => {
  it('reaches a co-member who is not a friend', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await Server.updateOne({ _id: s.id }, { $push: { members: b.id } })

    const aSock = track(await connectSocket(sockets.url, a.token))
    const got = nextEvent(aSock, 'presence')

    // b comes online after a is already watching. They are not friends.
    track(await connectSocket(sockets.url, b.token))

    const p = await got
    expect(p.userId).toBe(b.id)
    expect(p.status).not.toBe('offline')
  })

  it('reports a co-member going offline', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await Server.updateOne({ _id: s.id }, { $push: { members: b.id } })

    const bSock = track(await connectSocket(sockets.url, b.token))
    const aSock = track(await connectSocket(sockets.url, a.token))
    const got = nextEvent(aSock, 'presence');

    bSock.disconnect()
    const p = await got
    expect(p.userId).toBe(b.id)
    expect(p.status).toBe('offline')
  })

  it('does not reach a stranger who shares nothing', async () => {
    const a = await register(), b = await register()
    await mkServer(a)   // b is NOT a member

    const aSock = track(await connectSocket(sockets.url, a.token))
    let seen = false
    aSock.on('presence', () => { seen = true })

    track(await connectSocket(sockets.url, b.token))
    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/serverPresence.test.ts`
Expected: the first two FAIL with `no "presence" within 3000ms` — the fan-out is friends-only. The third passes and must keep passing.

- [ ] **Step 3: Widen the audience in `server/sockets/chatSocket.ts`**

Replace the block that assigns `myFriendIds` with:

```ts
      const fr = await Friendship.find({
        status: 'accepted',
        $or: [{ requester: userId }, { receiver: userId }],
      }).select('requester receiver').lean()
      const friendIds = fr.map(f =>
        f.requester.toString() === userId ? f.receiver.toString() : f.requester.toString())

      // Presence reaches friends PLUS anyone sharing a server. A member list
      // without live status is most of the point of a member list, and the
      // audience only widens to rooms the user chose to join. Invisible is
      // still a full opt-out, because effectiveStatus maps it to offline.
      const coMemberIds = (await Server.find({ members: userId }).select('members').lean())
        .flatMap(s => s.members.map(m => m.toString()))

      myFriendIds = [...new Set([...friendIds, ...coMemberIds])].filter(id => id !== userId)
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/__tests__/serverPresence.test.ts`
Expected: all 3 PASS.

- [ ] **Step 5: Full suite and typecheck**

Run: `npx vitest run` then `npx tsc --noEmit -p tsconfig.server.json`
Expected: 87 green in one run; typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/sockets/chatSocket.ts server/__tests__/serverPresence.test.ts
git commit -m "feat(server): presence reaches server co-members, not only friends"
```

---

## Known limitation to raise at the final review

The audience list is built once at connect. Someone who joins a server **after** you connected will not see you go idle until one of you reconnects, and the spec explicitly calls for it to be recomputed on join and leave. Task 4 emits `server:memberJoined` and `server:memberLeft`, so the hook exists — but wiring the recompute needs the socket layer to react to those events for already-connected sockets, which is a larger change than this plan's last task should carry.

Decide at the final review whether to add a sixth task here or defer it to plan 3, where the client is being built and the reconnect behaviour can be judged against real usage.

## Before deploying any of this

No new route prefixes are added by this plan — `/servers` and `/invites` already exist from plan 1. The nginx alternation still needs `|servers|invites` before plan 3 reaches users:

```
location ~ ^/(auth|users|messages|stickers|themes|voice|health|conversations|gifs|servers|invites)(/|$)
```

Verify with `curl -s https://app.skycord.xyz/servers | head -c 60` — `<!DOCTYPE html` means broken, `401` means correct.

## What plan 3 covers

`useServers`, `ServerRail`, `ChannelSidebar`, member list grouping, voice channel join (instant on desktop, bottom sheet on touch), create and invite modals, Server Settings, and the phone layout.
