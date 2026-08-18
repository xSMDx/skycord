# Servers and Channels API Implementation Plan (1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working servers-and-channels API — create a server with seeded channels, manage channels, mint invite links, and join through one.

**Architecture:** Three new Mongo collections (`Server`, `Channel`, `ServerInvite`) alongside the untouched `Conversation`. One authorisation helper gates every route: you may act on a channel if you are a member of its server. Owner-only actions are a second, narrower check.

**Tech Stack:** Express 4, Mongoose, TypeScript, vitest + supertest (new).

Spec: `docs/superpowers/specs/2026-08-17-channels-design.md`

## Global Constraints

- `MAX_SERVER_MEMBERS = 100`. The 101st join is rejected.
- Channel and server names: free unicode, 1–100 characters. **No slug validation, no lowercasing, no hyphenating** — reference channel names carry emoji.
- A server always has at least one text channel. Deleting the last one is refused.
- The owner cannot leave their own server. Ownership transfer is out of scope.
- Invite `expiresAt` is a Date **or null**, where null means never. There is no `maxUses`.
- Every route requires auth. Owner-only: create/rename/delete channel, rename server, change icon, delete server, create/revoke invites, remove a member.
- Never serialise a raw `status` field. Presence goes through `effectiveStatus()` from `server/state/presence.ts`.
- Tests run against the **Docker Mongo already used for dev**, on database `sykord_test`. `mongodb-memory-server` is deliberately not used: it downloads a modern Mongo binary, and this project pins 4.4 for CPU compatibility.

---

### Task 1: Test infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `server/__tests__/helpers.ts`
- Test: `server/__tests__/health.test.ts`

**Interfaces:**
- Consumes: `createApp()` from `server/app.ts` (already exported).
- Produces: `app()` returning a supertest agent over `createApp()`; `register(name?)` returning `TestUser { token, id, username }`; `auth(user)` returning the Authorization header; `connectDb()`, `disconnectDb()`, `resetDb()`. Every later task uses these.

- [ ] **Step 1: Install the test dependencies**

```bash
npm install -D vitest supertest @types/supertest
```

- [ ] **Step 2: Add the test script**

In `package.json`, inside `"scripts"`, after the `"typecheck"` line:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The API is the unit under test; jsdom would only slow this down.
    environment: 'node',
    include: ['server/__tests__/**/*.test.ts'],
    // Mongoose connections and Express apps are shared process-wide, so
    // parallel files would fight over the same test database.
    fileParallelism: false,
    hookTimeout: 20000,
    testTimeout: 20000,
  },
})
```

- [ ] **Step 4: Create `server/__tests__/helpers.ts`**

```ts
/**
 * Test harness. Talks to the Docker Mongo used for development, on a separate
 * `sykord_test` database, so nothing here can touch real data.
 */
import mongoose from 'mongoose'
import request from 'supertest'
import { createApp } from '../app'

const TEST_URI =
  process.env.TEST_MONGO_URI ??
  'mongodb://localhost:27017/sykord_test?authSource=admin'

export const connectDb = async (): Promise<void> => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(TEST_URI)
}

export const disconnectDb = async (): Promise<void> => {
  await mongoose.connection.close()
}

/** Wipe every collection between tests so ordering can never matter. */
export const resetDb = async (): Promise<void> => {
  const cols = await mongoose.connection.db!.collections()
  await Promise.all(cols.map(c => c.deleteMany({})))
}

export const app = () => request(createApp())

let seq = 0
export interface TestUser { token: string; id: string; username: string }

/** Registers a real account through the real endpoint and returns its token. */
export const register = async (name?: string): Promise<TestUser> => {
  const username = name ?? `t${Date.now()}${seq++}`
  const res = await app()
    .post('/auth/register')
    .send({
      username,
      email: `${username}@test.local`,
      password: 'TestPass123!',
      displayName: username,
    })
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`)
  return { token: res.body.accessToken, id: res.body.user.id, username }
}

/** Authorization header for a test user. */
export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` })
```

- [ ] **Step 5: Write the failing test**

Create `server/__tests__/health.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth } from './helpers'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

describe('test harness', () => {
  it('serves /health', async () => {
    const res = await app().get('/health')
    expect(res.status).toBe(200)
  })

  it('registers a user and authenticates with the token', async () => {
    const u = await register()
    const res = await app().get('/users/friends').set(auth(u))
    expect(res.status).toBe(200)
    expect(res.body.friends).toEqual([])
  })
})
```

- [ ] **Step 6: Run it**

Run: `npx vitest run server/__tests__/health.test.ts`
Expected: both tests PASS. If Mongo is not running, start it first — `docker start mongodb`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts server/__tests__/
git commit -m "test: vitest + supertest harness against a separate test database"
```

---

### Task 2: Shared invite-code util and the Server model

**Files:**
- Create: `server/utils/inviteCode.ts`
- Modify: `server/models/GroupInvite.ts`
- Create: `server/models/Server.ts`
- Test: `server/__tests__/serverModel.test.ts`

**Interfaces:**
- Produces: `generateInviteCode(): string`, `inviteExpiry(): Date` from `utils/inviteCode`. `Server` model with `IServer`; `MAX_SERVER_MEMBERS = 100`.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/serverModel.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { connectDb, disconnectDb, resetDb } from './helpers'
import { Server, MAX_SERVER_MEMBERS } from '../models/Server'
import { generateInviteCode, inviteExpiry } from '../utils/inviteCode'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

describe('Server model', () => {
  it('caps members at 100', () => {
    expect(MAX_SERVER_MEMBERS).toBe(100)
  })

  it('stores a server with its optional decoration fields', async () => {
    const owner = new mongoose.Types.ObjectId()
    const s = await Server.create({
      name: 'EA', owner, members: [owner],
      bannerColor: '#e74c3c', description: 'a test server',
    })
    expect(s.name).toBe('EA')
    expect(s.icon).toBeNull()
    expect(s.iconCrop).toBeNull()
    expect(s.members).toHaveLength(1)
  })

  it('accepts an emoji name', async () => {
    const owner = new mongoose.Types.ObjectId()
    const s = await Server.create({ name: '🎮 gaming', owner, members: [owner] })
    expect(s.name).toBe('🎮 gaming')
  })
})

describe('inviteCode util', () => {
  it('generates url-safe codes that differ', () => {
    const a = generateInviteCode(), b = generateInviteCode()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('expires 24 hours out', () => {
    const ms = inviteExpiry().getTime() - Date.now()
    expect(ms).toBeGreaterThan(23 * 3600_000)
    expect(ms).toBeLessThanOrEqual(24 * 3600_000)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/serverModel.test.ts`
Expected: FAIL — cannot find module `../models/Server`.

- [ ] **Step 3: Create `server/utils/inviteCode.ts`**

Moved out of `GroupInvite.ts` so `ServerInvite` can share it without importing a group model.

```ts
import { randomBytes } from 'crypto'

const INVITE_TTL_MS = 24 * 60 * 60 * 1000

/** Short, URL-safe invite code. Collision-checked by the caller. */
export const generateInviteCode = (): string => randomBytes(6).toString('base64url')

/** Default expiry for a group invite: 24 hours. */
export const inviteExpiry = (): Date => new Date(Date.now() + INVITE_TTL_MS)
```

- [ ] **Step 4: Re-export from `GroupInvite.ts` so existing imports keep working**

In `server/models/GroupInvite.ts`, delete the `randomBytes` import, the `INVITE_TTL_MS` constant, and the `generateInviteCode` / `inviteExpiry` definitions, then add near the top:

```ts
import { generateInviteCode, inviteExpiry } from '../utils/inviteCode'
export { generateInviteCode, inviteExpiry }
```

- [ ] **Step 5: Create `server/models/Server.ts`**

```ts
import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * A server: a named place with members and channels. Deliberately separate
 * from Conversation — group DMs keep working untouched, and unifying them
 * would be a live-data migration across every DM and group path.
 */
export const MAX_SERVER_MEMBERS = 100

export interface ICrop { zoom: number; x: number; y: number }

export interface IServer extends Document {
  _id:         Types.ObjectId
  name:        string
  icon:        string | null
  iconCrop:    ICrop | null
  bannerColor: string | null
  description: string | null
  owner:       Types.ObjectId
  members:     Types.ObjectId[]
  createdAt:   Date
  updatedAt:   Date
}

const ServerSchema = new Schema<IServer>(
  {
    // Free unicode: reference channel and server names carry emoji, so there
    // is no slug validation here on purpose.
    name:        { type: String, required: true, maxlength: 100 },
    icon:        { type: String, default: null },
    iconCrop:    { type: { zoom: Number, x: Number, y: Number }, default: null, _id: false },
    bannerColor: { type: String, default: null },
    description: { type: String, default: null, maxlength: 300 },
    owner:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members:     [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true, versionKey: false }
)

ServerSchema.index({ members: 1 })

export const Server = mongoose.model<IServer>('Server', ServerSchema)
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run server/__tests__/serverModel.test.ts`
Expected: all 5 PASS.

- [ ] **Step 7: Check nothing else broke**

Run: `npm run typecheck`
Expected: no new errors. Pre-existing unused-declaration warnings in `ChatApp.vue` are expected.

- [ ] **Step 8: Commit**

```bash
git add server/utils/inviteCode.ts server/models/GroupInvite.ts server/models/Server.ts server/__tests__/serverModel.test.ts
git commit -m "feat(server): Server model and shared invite-code util"
```

---

### Task 3: Channel model

**Files:**
- Create: `server/models/Channel.ts`
- Test: `server/__tests__/channelModel.test.ts`

**Interfaces:**
- Consumes: `Server` from Task 2.
- Produces: `Channel` model with `IChannel`; `ChannelType = 'text' | 'voice'`.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/channelModel.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { connectDb, disconnectDb, resetDb } from './helpers'
import { Channel } from '../models/Channel'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

describe('Channel model', () => {
  const server = () => new mongoose.Types.ObjectId()

  it('defaults to a text channel at position 0', async () => {
    const c = await Channel.create({ server: server(), name: 'general' })
    expect(c.type).toBe('text')
    expect(c.position).toBe(0)
  })

  it('stores voice channels', async () => {
    const c = await Channel.create({ server: server(), name: 'General', type: 'voice' })
    expect(c.type).toBe('voice')
  })

  it('rejects an unknown type', async () => {
    await expect(
      Channel.create({ server: server(), name: 'x', type: 'forum' as never })
    ).rejects.toThrow()
  })

  it('keeps emoji in names', async () => {
    const c = await Channel.create({ server: server(), name: '💬general-chat' })
    expect(c.name).toBe('💬general-chat')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/channelModel.test.ts`
Expected: FAIL — cannot find module `../models/Channel`.

- [ ] **Step 3: Create `server/models/Channel.ts`**

```ts
import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * A place to talk inside a server. No members array — membership belongs to
 * the Server, and this cycle has no per-channel permissions.
 */
export type ChannelType = 'text' | 'voice'

export interface IChannel extends Document {
  _id:      Types.ObjectId
  server:   Types.ObjectId
  name:     string
  type:     ChannelType
  /** Order within its type group. Assigned by appending; no reorder UI yet. */
  position: number
  createdAt: Date
  updatedAt: Date
}

const ChannelSchema = new Schema<IChannel>(
  {
    server:   { type: Schema.Types.ObjectId, ref: 'Server', required: true },
    name:     { type: String, required: true, maxlength: 100 },
    type:     { type: String, enum: ['text', 'voice'], required: true, default: 'text' },
    position: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
)

ChannelSchema.index({ server: 1, position: 1 })

export const Channel = mongoose.model<IChannel>('Channel', ChannelSchema)
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/__tests__/channelModel.test.ts`
Expected: all 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/models/Channel.ts server/__tests__/channelModel.test.ts
git commit -m "feat(server): Channel model, text and voice"
```

---

### Task 4: Server routes and the membership guard

**Files:**
- Create: `server/controllers/serversController.ts`
- Create: `server/routes/servers.ts`
- Modify: `server/app.ts:14` (import) and `server/app.ts:74` (mount)
- Modify: `vite.config.ts` (proxy list)
- Test: `server/__tests__/servers.test.ts`

**Interfaces:**
- Consumes: `Server`, `MAX_SERVER_MEMBERS`, `Channel`, `requireAuth`, `effectiveStatus`.
- Produces: `loadServer(req, res)` returning `IServer | null` (member check, responds 403/404 itself); `requireOwner(server, userId, res)` returning boolean; `shapeServer(server, channels)`.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/servers.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser, name = 'EA') =>
  (await app().post('/servers').set(auth(u)).send({ name })).body.server

describe('POST /servers', () => {
  it('creates a server seeded with #general and General voice', async () => {
    const u = await register()
    const res = await app().post('/servers').set(auth(u)).send({ name: 'EA' })
    expect(res.status).toBe(201)
    expect(res.body.server.name).toBe('EA')
    expect(res.body.server.owner).toBe(u.id)
    expect(res.body.server.memberCount).toBe(1)

    const names = res.body.channels.map((c: any) => `${c.type}:${c.name}`)
    expect(names).toEqual(['text:general', 'voice:General'])
  })

  it('rejects an empty name', async () => {
    const u = await register()
    const res = await app().post('/servers').set(auth(u)).send({ name: '   ' })
    expect(res.status).toBe(400)
  })

  it('requires auth', async () => {
    const res = await app().post('/servers').send({ name: 'EA' })
    expect(res.status).toBe(401)
  })
})

describe('GET /servers', () => {
  it('lists only servers you belong to', async () => {
    const a = await register(), b = await register()
    await mkServer(a, 'Mine')
    await mkServer(b, 'Theirs')
    const res = await app().get('/servers').set(auth(a))
    expect(res.status).toBe(200)
    expect(res.body.servers.map((s: any) => s.name)).toEqual(['Mine'])
  })
})

describe('GET /servers/:sid', () => {
  it('returns the server with its channels', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().get(`/servers/${s.id}`).set(auth(u))
    expect(res.status).toBe(200)
    expect(res.body.channels).toHaveLength(2)
  })

  it('403s a non-member', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const res = await app().get(`/servers/${s.id}`).set(auth(b))
    expect(res.status).toBe(403)
  })

  it('404s an unknown id', async () => {
    const u = await register()
    const res = await app().get('/servers/6a82759756877263fa4805aa').set(auth(u))
    expect(res.status).toBe(404)
  })
})

describe('PATCH /servers/:sid', () => {
  it('lets the owner rename', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().patch(`/servers/${s.id}`).set(auth(u)).send({ name: 'Renamed' })
    expect(res.status).toBe(200)
    expect(res.body.server.name).toBe('Renamed')
  })

  it('403s someone who is not a member', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const res = await app().patch(`/servers/${s.id}`).set(auth(b)).send({ name: 'x' })
    expect(res.status).toBe(403)
  })
})

describe('GET /servers/:sid/members', () => {
  it('returns members with computed presence, never the raw column', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().get(`/servers/${s.id}/members`).set(auth(u))
    expect(res.status).toBe(200)
    expect(res.body.members).toHaveLength(1)
    // No socket in a test process, so everyone is offline regardless of the
    // stored value. This is the bug that made everyone read offline in prod.
    expect(res.body.members[0].status).toBe('offline')
  })
})

describe('DELETE /servers/:sid', () => {
  it('lets the owner delete and takes the channels with it', async () => {
    const u = await register()
    const s = await mkServer(u)
    expect((await app().delete(`/servers/${s.id}`).set(auth(u))).status).toBe(200)
    expect((await app().get(`/servers/${s.id}`).set(auth(u))).status).toBe(404)
  })
})

describe('DELETE /servers/:sid/members/:uid', () => {
  it('refuses to let the owner leave', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().delete(`/servers/${s.id}/members/${u.id}`).set(auth(u))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/owner/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/servers.test.ts`
Expected: FAIL — every request 404s, because `/servers` is not mounted.

- [ ] **Step 3: Create `server/controllers/serversController.ts`**

```ts
import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Server, MAX_SERVER_MEMBERS } from '../models/Server'
import { Channel } from '../models/Channel'
import { User } from '../models/User'
import { effectiveStatus } from '../state/presence'

/** Client shape for a server row. `memberCount` rather than the id array. */
export const shapeServer = (s: any) => ({
  id:          s._id.toString(),
  name:        s.name,
  icon:        s.icon ?? null,
  iconCrop:    s.iconCrop ?? null,
  bannerColor: s.bannerColor ?? null,
  description: s.description ?? null,
  owner:       s.owner.toString(),
  memberCount: s.members.length,
  createdAt:   s.createdAt,
})

export const shapeChannel = (c: any) => ({
  id:       c._id.toString(),
  server:   c.server.toString(),
  name:     c.name,
  type:     c.type,
  position: c.position,
})

/**
 * The one authorisation rule this cycle: you may act on a server if you are a
 * member of it. Responds 404/403 itself and returns null so callers can bail
 * with a single `if`.
 */
export const loadServer = async (req: Request, res: Response) => {
  const { sid } = req.params
  if (!Types.ObjectId.isValid(sid)) { res.status(404).json({ message: 'Server not found' }); return null }
  const server = await Server.findById(sid)
  if (!server) { res.status(404).json({ message: 'Server not found' }); return null }
  const me = req.user!.sub
  if (!server.members.some(m => m.toString() === me)) {
    res.status(403).json({ message: 'You are not a member of this server' }); return null
  }
  return server
}

/** Narrower check for destructive and structural actions. */
export const requireOwner = (server: any, userId: string, res: Response): boolean => {
  if (server.owner.toString() !== userId) {
    res.status(403).json({ message: 'Only the server owner can do that' })
    return false
  }
  return true
}

export const createServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub
    const name = String(req.body.name ?? '').trim()
    if (!name || name.length > 100) { res.status(400).json({ message: 'Give the server a name' }); return }

    const server = await Server.create({ name, owner: userId, members: [userId] })
    // A new server is never an empty screen.
    const channels = await Channel.insertMany([
      { server: server._id, name: 'general', type: 'text',  position: 0 },
      { server: server._id, name: 'General', type: 'voice', position: 0 },
    ])
    res.status(201).json({ server: shapeServer(server), channels: channels.map(shapeChannel) })
  } catch (err) { next(err) }
}

export const getMyServers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const servers = await Server.find({ members: req.user!.sub }).sort({ createdAt: 1 }).lean()
    res.json({ servers: servers.map(shapeServer) })
  } catch (err) { next(err) }
}

export const getServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const channels = await Channel.find({ server: server._id }).sort({ type: 1, position: 1 }).lean()
    res.json({ server: shapeServer(server), channels: channels.map(shapeChannel) })
  } catch (err) { next(err) }
}

export const updateServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    const { name, icon, iconCrop, bannerColor, description } = req.body
    if (name !== undefined) {
      const n = String(name).trim()
      if (!n || n.length > 100) { res.status(400).json({ message: 'Give the server a name' }); return }
      server.name = n
    }
    if (icon !== undefined)        server.icon = icon === null ? null : String(icon)
    if (bannerColor !== undefined) server.bannerColor = bannerColor === null ? null : String(bannerColor)
    if (description !== undefined) server.description = description === null ? null : String(description).slice(0, 300)
    if (iconCrop !== undefined) {
      const c = iconCrop
      server.iconCrop = c && typeof c === 'object'
        ? { zoom: Number(c.zoom) || 1, x: Number(c.x) || 0, y: Number(c.y) || 0 }
        : null
    }
    await server.save()
    res.json({ server: shapeServer(server) })
  } catch (err) { next(err) }
}

export const deleteServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return
    await Channel.deleteMany({ server: server._id })
    await server.deleteOne()
    res.json({ ok: true })
  } catch (err) { next(err) }
}

export const getServerMembers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const users = await User.find({ _id: { $in: server.members } })
      .select('username displayName discriminator avatar avatarCrop status').lean()
    res.json({
      members: users.map((u: any) => ({
        id:          u._id.toString(),
        username:    u.username,
        displayName: u.displayName,
        avatar:      u.avatar ?? null,
        avatarCrop:  u.avatarCrop ?? null,
        // Computed, never the stored column — that column is only ever the
        // user's chosen status, not whether they are reachable.
        status:      effectiveStatus(u.status, u._id.toString()),
        isOwner:     server.owner.toString() === u._id.toString(),
      })),
    })
  } catch (err) { next(err) }
}

/** Kick when someone else, leave when yourself. The owner may do neither. */
export const removeMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const me = req.user!.sub
    const target = req.params.uid
    const isSelf = target === me

    if (target === server.owner.toString()) {
      res.status(400).json({ message: 'The owner cannot leave their own server' }); return
    }
    if (!isSelf && !requireOwner(server, me, res)) return

    server.members = server.members.filter(m => m.toString() !== target)
    await server.save()
    res.json({ ok: true })
  } catch (err) { next(err) }
}

export { MAX_SERVER_MEMBERS }
```

- [ ] **Step 4: Create `server/routes/servers.ts`**

```ts
import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import {
  createServer, getMyServers, getServer, updateServer, deleteServer,
  getServerMembers, removeMember,
} from '../controllers/serversController'

const router = Router()
router.use(requireAuth)

router.post('/',                       createServer)
router.get('/',                        getMyServers)
router.get('/:sid',                    getServer)
router.patch('/:sid',                  updateServer)
router.delete('/:sid',                 deleteServer)
router.get('/:sid/members',            getServerMembers)
router.delete('/:sid/members/:uid',    removeMember)

export default router
```

- [ ] **Step 5: Mount it in `server/app.ts`**

Add to the imports beside the other route imports (after line 14):

```ts
import serversRoutes  from './routes/servers'
```

Add to the mounts, after the `gifsRoutes` line:

```ts
  app.use('/servers',       serversRoutes)
```

- [ ] **Step 6: Add the proxy entry in `vite.config.ts`**

A new prefix needs three edits. This is the second. Missing it fails **silently** — the request falls through to the SPA and returns 200 with `index.html`.

In the `proxy` object, beside `'/conversations'`:

```ts
        '/servers':       { target: api, changeOrigin: true },
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run server/__tests__/servers.test.ts`
Expected: all 11 PASS.

- [ ] **Step 8: Confirm nothing else broke**

Run: `npx vitest run` then `npm run typecheck`
Expected: all test files pass; no new type errors.

- [ ] **Step 9: Commit**

```bash
git add server/controllers/serversController.ts server/routes/servers.ts server/app.ts vite.config.ts server/__tests__/servers.test.ts
git commit -m "feat(server): server CRUD, members and the membership guard"
```

---

### Task 5: Channel routes

**Files:**
- Create: `server/controllers/channelsController.ts`
- Modify: `server/routes/servers.ts`
- Test: `server/__tests__/channels.test.ts`

**Interfaces:**
- Consumes: `loadServer`, `requireOwner`, `shapeChannel` from Task 4.
- Produces: `loadChannel(req, res)` returning `{ server, channel } | null`, used by the messaging plan.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/channels.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

describe('POST /servers/:sid/channels', () => {
  it('appends a text channel after the existing one', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: '💬memes', type: 'text' })
    expect(res.status).toBe(201)
    expect(res.body.channel.name).toBe('💬memes')
    expect(res.body.channel.position).toBe(1)
  })

  it('positions voice channels within their own group', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'Chill', type: 'voice' })
    expect(res.body.channel.position).toBe(1)
  })

  it('rejects an unknown type', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'x', type: 'forum' })
    expect(res.status).toBe(400)
  })

  it('rejects an empty name', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: '  ', type: 'text' })
    expect(res.status).toBe(400)
  })

  it('403s a non-member', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    const res = await app().post(`/servers/${server.id}/channels`)
      .set(auth(b)).send({ name: 'x', type: 'text' })
    expect(res.status).toBe(403)
  })
})

describe('PATCH /servers/:sid/channels/:cid', () => {
  it('renames', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const text = channels.find((c: any) => c.type === 'text')
    const res = await app().patch(`/servers/${server.id}/channels/${text.id}`)
      .set(auth(u)).send({ name: 'renamed' })
    expect(res.status).toBe(200)
    expect(res.body.channel.name).toBe('renamed')
  })
})

describe('DELETE /servers/:sid/channels/:cid', () => {
  it('refuses to delete the last text channel', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const text = channels.find((c: any) => c.type === 'text')
    const res = await app().delete(`/servers/${server.id}/channels/${text.id}`).set(auth(u))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/last text channel/i)
  })

  it('deletes a text channel when another remains', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const extra = (await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'second', type: 'text' })).body.channel
    const res = await app().delete(`/servers/${server.id}/channels/${extra.id}`).set(auth(u))
    expect(res.status).toBe(200)
    const after = (await app().get(`/servers/${server.id}`).set(auth(u))).body.channels
    expect(after.map((c: any) => c.id)).not.toContain(extra.id)
    expect(after).toHaveLength(2)
    // The seeded text channel survives.
    expect(channels.find((c: any) => c.type === 'text')).toBeTruthy()
  })

  it('deletes the only voice channel happily', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const voice = channels.find((c: any) => c.type === 'voice')
    const res = await app().delete(`/servers/${server.id}/channels/${voice.id}`).set(auth(u))
    expect(res.status).toBe(200)
  })

  it('404s a channel from another server', async () => {
    const u = await register()
    const one = await mkServer(u), two = await mkServer(u)
    const other = two.channels[0]
    const res = await app().delete(`/servers/${one.server.id}/channels/${other.id}`).set(auth(u))
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/channels.test.ts`
Expected: FAIL — the channel routes 404.

- [ ] **Step 3: Create `server/controllers/channelsController.ts`**

```ts
import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Channel } from '../models/Channel'
import { loadServer, requireOwner, shapeChannel } from './serversController'

/**
 * Resolve a channel and prove the caller may touch it. The channel must belong
 * to the server in the path — otherwise a member of any server could address a
 * channel in any other by id.
 */
export const loadChannel = async (req: Request, res: Response) => {
  const server = await loadServer(req, res)
  if (!server) return null
  const { cid } = req.params
  if (!Types.ObjectId.isValid(cid)) { res.status(404).json({ message: 'Channel not found' }); return null }
  const channel = await Channel.findById(cid)
  if (!channel || channel.server.toString() !== server._id.toString()) {
    res.status(404).json({ message: 'Channel not found' }); return null
  }
  return { server, channel }
}

export const createChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    const name = String(req.body.name ?? '').trim()
    const type = req.body.type === 'voice' ? 'voice' : req.body.type === 'text' ? 'text' : null
    if (!name || name.length > 100) { res.status(400).json({ message: 'Give the channel a name' }); return }
    if (!type) { res.status(400).json({ message: 'A channel is either text or voice' }); return }

    // Appended to the end of its own type group.
    const last = await Channel.find({ server: server._id, type }).sort({ position: -1 }).limit(1).lean()
    const position = last.length ? last[0].position + 1 : 0

    const channel = await Channel.create({ server: server._id, name, type, position })
    res.status(201).json({ channel: shapeChannel(channel) })
  } catch (err) { next(err) }
}

export const updateChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadChannel(req, res); if (!found) return
    if (!requireOwner(found.server, req.user!.sub, res)) return

    const name = String(req.body.name ?? '').trim()
    if (!name || name.length > 100) { res.status(400).json({ message: 'Give the channel a name' }); return }
    found.channel.name = name
    await found.channel.save()
    res.json({ channel: shapeChannel(found.channel) })
  } catch (err) { next(err) }
}

export const deleteChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadChannel(req, res); if (!found) return
    if (!requireOwner(found.server, req.user!.sub, res)) return

    // A server always has somewhere to talk.
    if (found.channel.type === 'text') {
      const texts = await Channel.countDocuments({ server: found.server._id, type: 'text' })
      if (texts <= 1) {
        res.status(400).json({ message: 'You cannot delete the last text channel' }); return
      }
    }
    await found.channel.deleteOne()
    res.json({ ok: true })
  } catch (err) { next(err) }
}
```

- [ ] **Step 4: Add the routes in `server/routes/servers.ts`**

Extend the import from the channels controller and add three routes after the members routes:

```ts
import { createChannel, updateChannel, deleteChannel } from '../controllers/channelsController'

router.post('/:sid/channels',          createChannel)
router.patch('/:sid/channels/:cid',    updateChannel)
router.delete('/:sid/channels/:cid',   deleteChannel)
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run server/__tests__/channels.test.ts`
Expected: all 10 PASS.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/channelsController.ts server/routes/servers.ts server/__tests__/channels.test.ts
git commit -m "feat(server): channel create, rename and delete with a last-text-channel guard"
```

---

### Task 6: Invites and joining

**Files:**
- Create: `server/models/ServerInvite.ts`
- Create: `server/controllers/invitesController.ts`
- Create: `server/routes/invites.ts`
- Modify: `server/routes/servers.ts`
- Modify: `server/app.ts` (import and mount `/invites`)
- Modify: `vite.config.ts` (proxy `/invites`)
- Test: `server/__tests__/invites.test.ts`

**Interfaces:**
- Consumes: `generateInviteCode` from Task 2, `loadServer`/`requireOwner` from Task 4.
- Produces: `ServerInvite` model. Join returns `{ server, channels }` in the same shape as `GET /servers/:sid`.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/invites.test.ts`:

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
const mkInvite = async (u: TestUser, sid: string, expiry: '24h' | '7d' | 'never' = '24h') =>
  (await app().post(`/servers/${sid}/invites`).set(auth(u)).send({ expiry })).body.invite

describe('POST /servers/:sid/invites', () => {
  it('mints a 24h invite by default', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().post(`/servers/${s.id}/invites`).set(auth(u)).send({ expiry: '24h' })
    expect(res.status).toBe(201)
    expect(res.body.invite.code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(res.body.invite.uses).toBe(0)
    const ms = new Date(res.body.invite.expiresAt).getTime() - Date.now()
    expect(ms).toBeGreaterThan(23 * 3600_000)
  })

  it('mints a never-expiring invite with a null expiry', async () => {
    const u = await register()
    const s = await mkServer(u)
    const inv = await mkInvite(u, s.id, 'never')
    expect(inv.expiresAt).toBeNull()
  })

  it('403s a non-owner', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const res = await app().post(`/servers/${s.id}/invites`).set(auth(b)).send({ expiry: '24h' })
    expect(res.status).toBe(403)
  })
})

describe('POST /invites/:code', () => {
  it('joins the server and increments uses', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)

    const res = await app().post(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(200)
    expect(res.body.server.id).toBe(s.id)
    expect(res.body.channels).toHaveLength(2)

    const after = (await app().get(`/servers/${s.id}/members`).set(auth(b))).body.members
    expect(after).toHaveLength(2)
    const stored = await ServerInvite.findOne({ code: inv.code })
    expect(stored!.uses).toBe(1)
  })

  it('is idempotent for someone already in', async () => {
    const a = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    const res = await app().post(`/invites/${inv.code}`).set(auth(a))
    expect(res.status).toBe(200)
    const members = (await app().get(`/servers/${s.id}/members`).set(auth(a))).body.members
    expect(members).toHaveLength(1)
  })

  it('404s an unknown code', async () => {
    const u = await register()
    const res = await app().post('/invites/nope').set(auth(u))
    expect(res.status).toBe(404)
  })

  it('410s an expired invite, distinctly from unknown', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    await ServerInvite.updateOne({ code: inv.code }, { expiresAt: new Date(Date.now() - 1000) })
    const res = await app().post(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(410)
    expect(res.body.message).toMatch(/expired/i)
  })

  it('409s when the server is full', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    // Pad to the cap without registering 99 accounts.
    const filler = Array.from({ length: 99 }, () => new Types.ObjectId())
    await Server.updateOne({ _id: s.id }, { $push: { members: { $each: filler } } })
    const res = await app().post(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/full/i)
  })
})

describe('DELETE /servers/:sid/invites/:code', () => {
  it('revokes, and the code stops working', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    expect((await app().delete(`/servers/${s.id}/invites/${inv.code}`).set(auth(a))).status).toBe(200)
    expect((await app().post(`/invites/${inv.code}`).set(auth(b))).status).toBe(404)
  })
})

describe('GET /servers/:sid/invites', () => {
  it('lists active invites for the owner', async () => {
    const u = await register()
    const s = await mkServer(u)
    await mkInvite(u, s.id)
    const res = await app().get(`/servers/${s.id}/invites`).set(auth(u))
    expect(res.status).toBe(200)
    expect(res.body.invites).toHaveLength(1)
    expect(res.body.invites[0].inviter.username).toBe(u.username)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/invites.test.ts`
Expected: FAIL — cannot find module `../models/ServerInvite`.

- [ ] **Step 3: Create `server/models/ServerInvite.ts`**

```ts
import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * Separate from GroupInvite rather than a generalisation of it: a server link
 * may never expire, which needs a nullable expiresAt. Mongo's TTL index skips
 * documents whose field is not a date, so "never" needs no special-casing.
 */
export interface IServerInvite extends Document {
  _id:       Types.ObjectId
  code:      string
  server:    Types.ObjectId
  createdBy: Types.ObjectId
  expiresAt: Date | null
  uses:      number
  createdAt: Date
}

const ServerInviteSchema = new Schema<IServerInvite>(
  {
    code:      { type: String, required: true, unique: true, index: true },
    server:    { type: Schema.Types.ObjectId, ref: 'Server', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, default: null },
    // Reported, not enforced. There is deliberately no maxUses.
    uses:      { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
)

ServerInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
ServerInviteSchema.index({ server: 1 })

export const ServerInvite = mongoose.model<IServerInvite>('ServerInvite', ServerInviteSchema)
```

- [ ] **Step 4: Create `server/controllers/invitesController.ts`**

```ts
import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Server, MAX_SERVER_MEMBERS } from '../models/Server'
import { Channel } from '../models/Channel'
import { ServerInvite } from '../models/ServerInvite'
import { User } from '../models/User'
import { generateInviteCode } from '../utils/inviteCode'
import { loadServer, requireOwner, shapeServer, shapeChannel } from './serversController'

const DAY = 24 * 60 * 60 * 1000
const expiryFor = (v: unknown): Date | null =>
  v === 'never' ? null : v === '7d' ? new Date(Date.now() + 7 * DAY) : new Date(Date.now() + DAY)

const shapeInvite = (i: any, inviter?: any) => ({
  code:      i.code,
  uses:      i.uses,
  expiresAt: i.expiresAt ?? null,
  createdAt: i.createdAt,
  inviter:   inviter ? { id: inviter._id.toString(), username: inviter.username } : null,
})

export const createInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    // base64url of 6 bytes; retry on the vanishingly rare collision.
    let code = generateInviteCode()
    for (let i = 0; i < 5 && await ServerInvite.exists({ code }); i++) code = generateInviteCode()

    const invite = await ServerInvite.create({
      code, server: server._id, createdBy: req.user!.sub, expiresAt: expiryFor(req.body.expiry),
    })
    res.status(201).json({ invite: shapeInvite(invite, { _id: req.user!.sub, username: req.user!.username }) })
  } catch (err) { next(err) }
}

export const listInvites = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    const invites = await ServerInvite.find({ server: server._id }).sort({ createdAt: -1 }).lean()
    const users = await User.find({ _id: { $in: invites.map(i => i.createdBy) } })
      .select('username').lean()
    const byId = new Map(users.map((u: any) => [u._id.toString(), u]))
    res.json({ invites: invites.map(i => shapeInvite(i, byId.get(i.createdBy.toString()))) })
  } catch (err) { next(err) }
}

export const revokeInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return
    await ServerInvite.deleteOne({ server: server._id, code: req.params.code })
    res.json({ ok: true })
  } catch (err) { next(err) }
}

/**
 * Join. Expired, revoked and full are three different problems and get three
 * different answers — a single generic failure would leave the user guessing.
 */
export const joinViaInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub
    const invite = await ServerInvite.findOne({ code: req.params.code })
    if (!invite) { res.status(404).json({ message: 'That invite does not exist' }); return }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ message: 'This invite has expired' }); return
    }

    const server = await Server.findById(invite.server)
    if (!server) { res.status(404).json({ message: 'That server no longer exists' }); return }

    const already = server.members.some(m => m.toString() === userId)
    if (!already) {
      if (server.members.length >= MAX_SERVER_MEMBERS) {
        res.status(409).json({ message: 'This server is full' }); return
      }
      server.members.push(new Types.ObjectId(userId))
      await server.save()
      invite.uses += 1
      await invite.save()
    }

    const channels = await Channel.find({ server: server._id }).sort({ type: 1, position: 1 }).lean()
    res.json({ server: shapeServer(server), channels: channels.map(shapeChannel), joined: !already })
  } catch (err) { next(err) }
}
```

- [ ] **Step 5: Create `server/routes/invites.ts`**

```ts
import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { joinViaInvite } from '../controllers/invitesController'

const router = Router()
router.use(requireAuth)

router.post('/:code', joinViaInvite)

export default router
```

- [ ] **Step 6: Add the owner-side invite routes in `server/routes/servers.ts`**

```ts
import { createInvite, listInvites, revokeInvite } from '../controllers/invitesController'

router.post('/:sid/invites',           createInvite)
router.get('/:sid/invites',            listInvites)
router.delete('/:sid/invites/:code',   revokeInvite)
```

- [ ] **Step 7: Mount `/invites` in `server/app.ts`**

Import beside the other routes:

```ts
import invitesRoutes  from './routes/invites'
```

Mount after `/servers`:

```ts
  app.use('/invites',       invitesRoutes)
```

- [ ] **Step 8: Add the proxy entry in `vite.config.ts`**

```ts
        '/invites':       { target: api, changeOrigin: true },
```

- [ ] **Step 9: Run the tests**

Run: `npx vitest run server/__tests__/invites.test.ts`
Expected: all 9 PASS.

- [ ] **Step 10: Run everything**

Run: `npx vitest run` then `npm run typecheck`
Expected: all suites pass, no new type errors.

- [ ] **Step 11: Commit**

```bash
git add server/models/ServerInvite.ts server/controllers/invitesController.ts server/routes/invites.ts server/routes/servers.ts server/app.ts vite.config.ts server/__tests__/invites.test.ts
git commit -m "feat(server): server invites with 24h/7d/never expiry, revoke and join"
```

---

## Before deploying any of this

`/servers` and `/invites` are new route prefixes, which need **three** edits.
Two are in this plan; the third is on the VPS and is not:

```
/etc/nginx/sites-available/skycord line 8
location ~ ^/(auth|users|messages|stickers|themes|voice|health|conversations|gifs|servers|invites)(/|$)
```

Miss it and the failure is silent and deceptive: the request falls through to
`try_files $uri $uri/ /index.html`, the client gets **200 plus the SPA's
index.html**, `res.json()` throws, the catch swallows it, and servers simply
never appear. Test with:

```bash
curl -s https://app.skycord.xyz/servers | head -c 60
```

`<!DOCTYPE html` means broken. `401` means correct.

## What plan 2 covers

Channel messages (`GET`/`POST /servers/:sid/channels/:cid/messages` reusing
`resolveMessages`), socket rooms `chan:<id>`, the `channel:*` and `server:*`
events, and extending the presence fan-out to server members.

## What plan 3 covers

`useServers`, `ServerRail`, `ChannelSidebar`, the member list grouping, voice
channel join (instant on desktop, bottom sheet on touch), create/invite modals,
Server Settings, and the phone layout.
