# Message Search B1 — Server and Query Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested message-search API for servers, groups and DMs, and the client-side query model, API call, per-scope history and `useSearch` state that the search UI (plan B2) will sit on. Part 2 of `docs/superpowers/specs/2026-09-11-message-search-design.md`, minus the screens.

**Architecture:** Messages gain `has` and `mentions`, derived from the text in one model hook (plus a one-off startup backfill). A text index on `content` (language `none`) serves words and phrases. `server/utils/messageSearch.ts` turns a query string into a Mongo filter; `searchController.ts` resolves each scope's readable conversations and answers `{ results, total, hasMore }`. The client keeps a search as chips + free text (`searchQuery.ts`), converts it to API params in one place, and holds results in a singleton `useSearch`.

**Tech Stack:** Express + Mongoose 8 on MongoDB 4.4 (`$text`), Vue 3 composables, Vitest.

## Global Constraints

- No commits unless the user asks. Branch `fix/channel-findings`.
- Text index: `{ content: 'text' }`, `default_language: 'none'`, name `content_text`.
- 25 results per page; `total` capped at 1,000; the existing `searchLimit` (30/min/user; skipped under Vitest).
- `after` is inclusive (`$gte`), `before` exclusive (`$lt`); the client sends local-midnight instants.
- Words are all required (each sent to `$text` as a quoted term); `"phrases"` stay phrases; `-word` excludes. A search needs a positive word or a filter.
- Server scope: text channels whose view is `full` AND with Read Message History. `in:` narrows inside that set; an unreadable id yields no results, never an error. System messages are never results.
- `has` values the server can store: `link`, `image`, `video`, `embed`. `file`, `sound`, `poll`, `sticker`, `forward` exist only in the UI, as Soon.

---

### Task 1: Search fields — classification and mention names (pure)

**Files:**
- Create: `server/utils/searchFields.ts`
- Test: `server/__tests__/searchFields.test.ts`
- Test: `src/composables/__tests__/searchFieldsParity.test.ts`

**Interfaces:**
- Produces: `type SearchHas = 'link' | 'image' | 'video' | 'embed'`; `SEARCH_HAS`; `THEME_CODE_RE`; `classifyHas(content: string): SearchHas[]`; `mentionNames(content: string): string[]`; `interface MentionCandidate { _id: { toString(): string }; username: string; displayName?: string | null }`; `resolveMentions(names: string[], people: MentionCandidate[]): string[]`.

- [ ] **Step 1: Write the failing tests**

`server/__tests__/searchFields.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { classifyHas, mentionNames, resolveMentions } from '../utils/searchFields'

describe('classifyHas', () => {
  it('finds nothing in plain text', () => {
    expect(classifyHas('just words here')).toEqual([])
  })
  it('marks any link', () => {
    expect(classifyHas('see https://example.com/page')).toEqual(['link'])
  })
  it('marks an image link, GIF-picker messages included', () => {
    expect(classifyHas('https://media.klipy.com/abc/cat.gif')).toEqual(['link', 'image'])
    expect(classifyHas('look https://x.io/a.PNG?size=2')).toEqual(['link', 'image'])
  })
  it('ignores sentence punctuation after a link', () => {
    expect(classifyHas('here: https://x.io/a.png.')).toEqual(['link', 'image'])
  })
  it('marks a video link', () => {
    expect(classifyHas('clip https://x.io/v.webm')).toEqual(['link', 'video'])
  })
  it('marks the links the client renders as cards as embeds', () => {
    expect(classifyHas('come https://app.skycord.xyz/join/Ab12Cd34')).toEqual(['link', 'embed'])
    expect(classifyHas('https://app.skycord.xyz/invite/Ab12Cd34')).toEqual(['link', 'embed'])
    expect(classifyHas('https://app.skycord.xyz/theme/Ab12Cd34')).toEqual(['link', 'embed'])
  })
  it('marks a pasted theme code as an embed without a link', () => {
    expect(classifyHas('try skycord-theme:eyJhIjoxfQ')).toEqual(['embed'])
  })
})

describe('mentionNames', () => {
  it('reads the names inside mention tokens, each once, trimmed', () => {
    expect(mentionNames('hi <@Ada> and <@ Bob > and <@Ada>')).toEqual(['Ada', 'Bob'])
  })
  it('ignores an empty token and plain @words', () => {
    expect(mentionNames('<@> @everyone @ada')).toEqual([])
  })
})

describe('resolveMentions', () => {
  const people = [
    { _id: 'u1', username: 'ada_l', displayName: 'Ada' },
    { _id: 'u2', username: 'bob', displayName: 'Bobby' },
    { _id: 'u3', username: 'ada2', displayName: 'ada' },
  ]
  it('matches a display name or a username, ignoring case', () => {
    expect(resolveMentions(['BOB'], people)).toEqual(['u2'])
    expect(resolveMentions(['bobby'], people)).toEqual(['u2'])
  })
  it('resolves a name two people share to both', () => {
    expect(resolveMentions(['Ada'], people)).toEqual(['u1', 'u3'])
  })
  it('resolves nobody for a name nobody here has', () => {
    expect(resolveMentions(['Zed'], people)).toEqual([])
  })
})
```

`src/composables/__tests__/searchFieldsParity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import appearanceSource from '../useAppearance.ts?raw'
import { THEME_CODE_RE } from '../../../server/utils/searchFields'

/**
 * The server decides what counts as an embed, but the client decides what is
 * drawn as a card. If the theme-code pattern changes on one side only, `has:
 * embed` starts disagreeing with what people see. Read as source, not imported:
 * useAppearance touches storage and the document at import time.
 */
describe('has: embed parity', () => {
  it('uses the same theme-code pattern the client renders cards for', () => {
    expect(appearanceSource).toContain(`export const THEME_CODE_RE = ${THEME_CODE_RE.toString()}`)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run server/__tests__/searchFields.test.ts src/composables/__tests__/searchFieldsParity.test.ts`
Expected: FAIL — cannot find module `../utils/searchFields`.

- [ ] **Step 3: Implement** — `server/utils/searchFields.ts`

```ts
/**
 * What a message contains and whom it mentions, worked out from its text.
 *
 * Pure — no database — so the model hook, the startup backfill and the tests
 * run exactly the same rules, and a client test can import it to check the
 * embed patterns still match what the client draws as cards.
 */

export type SearchHas = 'link' | 'image' | 'video' | 'embed'
export const SEARCH_HAS: readonly SearchHas[] = ['link', 'image', 'video', 'embed']

const URL_RE    = /https?:\/\/[^\s<>"']+/gi
const IMAGE_EXT = /\.(?:gif|png|jpe?g|webp|avif)(?:\?\S*)?$/i
const VIDEO_EXT = /\.(?:mp4|webm|mov)(?:\?\S*)?$/i
/** The links MessageItem draws as cards: server invite, group invite, theme. */
const CARD_LINK_RE = /https?:\/\/[^/\s]+\/(?:join|invite|theme)\/[A-Za-z0-9_-]{6,16}\/?/i
/** Mirrors THEME_CODE_RE in src/composables/useAppearance.ts — pinned by a parity test. */
export const THEME_CODE_RE = /(?:skycord|sykord)-theme:[A-Za-z0-9_-]+/
const MENTION_RE = /<@([^>\n]+)>/g

/** Sentence punctuation after a link is not part of it. */
const trimUrl = (u: string) => u.replace(/[).,!?:;]+$/, '')

export const classifyHas = (content: string): SearchHas[] => {
  const found = new Set<SearchHas>()
  const urls = (content.match(URL_RE) ?? []).map(trimUrl)
  if (urls.length) found.add('link')
  for (const u of urls) {
    if (IMAGE_EXT.test(u)) found.add('image')
    if (VIDEO_EXT.test(u)) found.add('video')
  }
  if (CARD_LINK_RE.test(content) || THEME_CODE_RE.test(content)) found.add('embed')
  return SEARCH_HAS.filter(h => found.has(h))
}

/**
 * The names inside `<@…>` mention tokens, trimmed, each once. The composer
 * writes a member's display name there, not an id — see MessageInput.vue.
 */
export const mentionNames = (content: string): string[] => {
  const out = new Set<string>()
  for (const m of content.matchAll(MENTION_RE)) {
    const name = m[1].trim()
    if (name) out.add(name)
  }
  return [...out]
}

export interface MentionCandidate { _id: { toString(): string }; username: string; displayName?: string | null }

/**
 * Which of `people` the names refer to: display name or username, ignoring
 * case. A name two people share resolves to both — a search for either of
 * them should find the message.
 */
export const resolveMentions = (names: string[], people: MentionCandidate[]): string[] => {
  const wanted = new Set(names.map(n => n.toLowerCase()))
  return people
    .filter(p => wanted.has(p.username.toLowerCase())
      || (!!p.displayName && wanted.has(p.displayName.toLowerCase())))
    .map(p => p._id.toString())
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run server/__tests__/searchFields.test.ts src/composables/__tests__/searchFieldsParity.test.ts`
Expected: PASS.

---

### Task 2: Message model — fields, hook, indexes

**Files:**
- Create: `server/utils/searchMembers.ts`
- Modify: `server/models/Message.ts`
- Test: `server/__tests__/searchFieldsHook.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `IMessage.has: SearchHas[]`, `IMessage.mentions: Types.ObjectId[]`; `mentionCandidates(kind, conversationId, names): Promise<MentionCandidate[]>`; text index `content_text`.

- [ ] **Step 1: Write the failing test** — `server/__tests__/searchFieldsHook.test.ts`

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth } from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { Friendship } from '../models/Friendship'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: any) => (await app().post('/servers').set(auth(u)).send({ name: 'SF' })).body
const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')
const stored = (id: string) => Message.findById(id).lean()

describe('search fields on save', () => {
  it('records links, images and cards on a channel message', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(u)).send({ content: 'pic https://x.io/cat.png and https://app.skycord.xyz/join/Ab12Cd34' })
    const m = await stored(res.body.message._id)
    expect(m!.has).toEqual(['link', 'image', 'embed'])
  })

  it('resolves a mention to the member it names', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(a)).send({ content: `hey <@${b.username}>` })
    const m = await stored(res.body.message._id)
    expect(m!.mentions.map(String)).toEqual([b.id])
  })

  it('resolves nobody for a name that is not a member here', async () => {
    const a = await register(), outsider = await register()
    const { server, channels } = await mkServer(a)
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(a)).send({ content: `hey <@${outsider.username}>` })
    expect((await stored(res.body.message._id))!.mentions).toEqual([])
  })

  it('updates both when a message is edited', async () => {
    const a = await register(), b = await register()
    await Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })
    const sent = await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'plain' })
    const id = sent.body.message._id
    expect((await stored(id))!.has).toEqual([])
    await app().patch(`/messages/${id}`).set(auth(a)).send({ content: `now https://x.io/v.mp4 <@${b.username}>` })
    const m = await stored(id)
    expect(m!.has).toEqual(['link', 'video'])
    expect(m!.mentions.map(String)).toEqual([b.id])
  })

  it('records nothing for a system message', async () => {
    const u = await register()
    const m = await Message.create({
      conversationId: 'x_y', kind: 'system', authorId: u.id, authorName: 'sys',
      content: 'https://x.io/a.png <@someone>', systemType: 'call',
    })
    expect(m.has).toEqual([])
    expect(m.mentions).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/searchFieldsHook.test.ts`
Expected: FAIL — `has` / `mentions` undefined.

- [ ] **Step 3: Member lookup** — `server/utils/searchMembers.ts`

```ts
import mongoose from 'mongoose'
import type { MentionCandidate } from './searchFields'

const isId = (s: string) => /^[a-f0-9]{24}$/i.test(s)

/**
 * Who could be mentioned in a conversation: server members for a channel,
 * group members for a group, the two participants of a DM.
 *
 * Models are looked up by name when called rather than imported: the Message
 * model calls this from a hook, and importing Channel/Server/Conversation/User
 * into it would tie the model files into a cycle for one lookup.
 */
const memberIdsOf = async (kind: string, conversationId: string): Promise<unknown[]> => {
  if (kind === 'dm') return conversationId.split('_').filter(isId)
  if (kind === 'group') {
    const g = await mongoose.model('Conversation').findById(conversationId).select('members').lean<{ members: unknown[] }>()
    return g?.members ?? []
  }
  if (kind === 'channel') {
    const ch = await mongoose.model('Channel').findById(conversationId).select('server').lean<{ server: unknown }>()
    if (!ch) return []
    const s = await mongoose.model('Server').findById(ch.server).select('members').lean<{ members: unknown[] }>()
    return s?.members ?? []
  }
  return []
}

/**
 * The members of the conversation whose username or display name is one of
 * `names`, ignoring case. A strength-2 collation makes `$in` case-insensitive,
 * so this is one query rather than a regex per name.
 */
export const mentionCandidates = async (
  kind: string, conversationId: string, names: string[],
): Promise<MentionCandidate[]> => {
  if (!names.length) return []
  const memberIds = await memberIdsOf(kind, conversationId)
  if (!memberIds.length) return []
  return mongoose.model('User')
    .find({ _id: { $in: memberIds }, $or: [{ username: { $in: names } }, { displayName: { $in: names } }] })
    .collation({ locale: 'en', strength: 2 })
    .select('_id username displayName')
    .lean<MentionCandidate[]>()
}
```

- [ ] **Step 4: The model** — in `server/models/Message.ts`:

Add imports:

```ts
import { classifyHas, mentionNames, resolveMentions, SEARCH_HAS, type SearchHas } from '../utils/searchFields'
import { mentionCandidates } from '../utils/searchMembers'
```

Add to `IMessage` (after `mentionsEveryone`):

```ts
  /** What the message contains, for `has:` search. Derived from `content`. */
  has:        SearchHas[]
  /** Whom it mentions, for `mentions:` search. Resolved from `<@Name>` tokens. */
  mentions:   Types.ObjectId[]
```

Add to the schema fields (after `mentionsEveryone`):

```ts
    has:            [{ type: String, enum: SEARCH_HAS }],
    mentions:       [{ type: Schema.Types.ObjectId, ref: 'User' }],
```

After the existing indexes:

```ts
/**
 * Keep `has` and `mentions` in step with the text on every path that saves a
 * message — channel, DM and group sends, both edit paths — without each of
 * them having to remember. `validate` runs for create(), insertMany() and
 * doc.save() alike. A member lookup happens only when the text has a mention.
 */
MessageSchema.pre('validate', async function () {
  if (!this.isNew && !this.isModified('content')) return
  if (this.kind === 'system') { this.has = []; this.mentions = []; return }
  this.has = classifyHas(this.content)
  const names = mentionNames(this.content)
  const people = names.length ? await mentionCandidates(this.kind, this.conversationId, names) : []
  this.mentions = resolveMentions(names, people).map(id => new Types.ObjectId(id))
})

/**
 * Search. `none` tokenises on whitespace and punctuation in any language
 * instead of stemming everything as English: "running" does not find "run",
 * but Arabic, Persian and every other script are searchable at all.
 */
MessageSchema.index({ content: 'text' }, { default_language: 'none', name: 'content_text' })
MessageSchema.index({ conversationId: 1, mentions: 1, createdAt: -1 })
MessageSchema.index({ conversationId: 1, has: 1, createdAt: -1 })
```

- [ ] **Step 5: Run the hook test and every message test**

Run: `npx vitest run server/__tests__/searchFieldsHook.test.ts server/__tests__/channelMessages.test.ts server/__tests__/dmMessages.test.ts server/__tests__/groupMessages.test.ts server/__tests__/channelMessageActions.test.ts`
Expected: PASS.

---

### Task 3: Startup backfill

**Files:**
- Create: `server/utils/searchBackfill.ts`
- Modify: `server/index.ts`
- Test: `server/__tests__/searchBackfill.test.ts`

**Interfaces:**
- Produces: `backfillSearchFields(batchSize?: number): Promise<number>`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { app, connectDb, disconnectDb, resetDb, register, auth } from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { backfillSearchFields } from '../utils/searchBackfill'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

/** A message as one written before search existed: no `has`, no `mentions`. */
const legacy = (conversationId: string, kind: string, authorId: string, content: string) => ({
  _id: new Types.ObjectId(), conversationId, kind, authorId: new Types.ObjectId(authorId),
  authorName: 'old', content, reactions: [], pinned: false, edited: false, replyToIds: [],
  createdAt: new Date(), updatedAt: new Date(),
})

describe('backfillSearchFields', () => {
  it('fills both fields on messages that predate them, and only once', async () => {
    const a = await register(), b = await register()
    const { server, channels } = (await app().post('/servers').set(auth(a)).send({ name: 'BF' })).body
    await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
    const cid = channels.find((c: any) => c.type === 'text').id
    const docs = [
      legacy(cid, 'channel', a.id, 'see https://x.io/a.gif'),
      legacy(cid, 'channel', a.id, `ping <@${b.username}>`),
      legacy(cid, 'system', a.id, 'https://x.io/b.png'),
    ]
    await Message.collection.insertMany(docs)

    expect(await backfillSearchFields(2)).toBe(3)
    const [gif, ping, sys] = await Promise.all(docs.map(d => Message.findById(d._id).lean()))
    expect(gif!.has).toEqual(['link', 'image'])
    expect(ping!.mentions.map(String)).toEqual([b.id])
    expect(sys!.has).toEqual([])

    expect(await backfillSearchFields()).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/searchBackfill.test.ts`
Expected: FAIL — cannot find module `../utils/searchBackfill`.

- [ ] **Step 3: Implement** — `server/utils/searchBackfill.ts`

```ts
import { Types } from 'mongoose'
import { Message } from '../models/Message'
import { classifyHas, mentionNames, resolveMentions } from './searchFields'
import { mentionCandidates } from './searchMembers'

/**
 * Fill `has` and `mentions` on messages written before search existed.
 *
 * Idempotent: it only touches messages with no `has` at all, so after the
 * first run every later boot costs one empty query. Written through the raw
 * collection, not the model, so it neither re-runs the hook nor bumps
 * `updatedAt` on a message nobody edited. Old mentions resolve against
 * members' CURRENT names — a mention made before someone renamed can miss.
 */
export const backfillSearchFields = async (batchSize = 500): Promise<number> => {
  let done = 0
  for (;;) {
    const batch = await Message.collection
      .find({ has: { $exists: false } }, { projection: { _id: 1, kind: 1, conversationId: 1, content: 1 } })
      .limit(batchSize)
      .toArray()
    if (!batch.length) return done

    const ops = []
    for (const m of batch) {
      const content = String(m.content ?? '')
      const system  = m.kind === 'system'
      const names   = system ? [] : mentionNames(content)
      const people  = names.length ? await mentionCandidates(String(m.kind), String(m.conversationId), names) : []
      ops.push({
        updateOne: {
          filter: { _id: m._id },
          update: { $set: {
            has:      system ? [] : classifyHas(content),
            mentions: resolveMentions(names, people).map(id => new Types.ObjectId(id)),
          } },
        },
      })
    }
    await Message.collection.bulkWrite(ops)
    done += batch.length
  }
}
```

- [ ] **Step 4: Run it at startup** — in `server/index.ts`, import `backfillSearchFields` from `./utils/searchBackfill` and, right after the `connectDB()` try/catch:

```ts
  // Search fields for messages written before search existed. Not awaited:
  // the server comes up at once, and old links and mentions become searchable
  // a few seconds later on the first boot. Harmless on every boot after.
  backfillSearchFields()
    .then(n => { if (n) console.log(`✓ Search fields filled on ${n} message(s)`) })
    .catch(err => console.error('❌ Search backfill failed:', err))
```

- [ ] **Step 5: Run it**

Run: `npx vitest run server/__tests__/searchBackfill.test.ts`
Expected: PASS.

---

### Task 4: The search API

**Files:**
- Create: `server/utils/messageSearch.ts`
- Create: `server/controllers/searchController.ts`
- Modify: `server/routes/servers.ts`, `server/routes/conversations.ts`, `server/routes/messages.ts`
- Test: `server/__tests__/search.test.ts`

**Interfaces:**
- Produces: `GET /servers/:sid/search`, `GET /conversations/groups/:groupId/search`, `GET /messages/dm/:partnerId/search` → `{ results: (WireMessage & { channelId?: string })[], total: number, hasMore: boolean }`; 400 `{ message }` for an empty or exclusion-only search.

- [ ] **Step 1: Write the failing test** — `server/__tests__/search.test.ts`

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { Role } from '../models/Role'
import { Conversation } from '../models/Conversation'
import { Friendship } from '../models/Friendship'
import { PERMISSIONS } from '../permissions'

// $text needs the index built before the first query.
beforeAll(async () => { await connectDb(); await Message.init() })
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) => (await app().post('/servers').set(auth(u)).send({ name: 'SR' })).body
const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')
const say = (u: TestUser, sid: string, cid: string, content: string) =>
  app().post(`/servers/${sid}/channels/${cid}/messages`).set(auth(u)).send({ content })
const mkText = async (u: TestUser, sid: string, name: string) =>
  (await app().post(`/servers/${sid}/channels`).set(auth(u)).send({ name, type: 'text' })).body.channel
const search = (u: TestUser, sid: string, qs: string) => app().get(`/servers/${sid}/search?${qs}`).set(auth(u))
const texts = (res: any) => res.body.results.map((m: any) => m.content)
const everyoneId = async (u: TestUser, sid: string) => {
  await app().get(`/servers/${sid}/roles`).set(auth(u))
  return (await Role.findOne({ server: sid, isEveryone: true }))!._id.toString()
}
const deny = async (owner: TestUser, sid: string, cid: string, bits: bigint) =>
  app().patch(`/servers/${sid}/channels/${cid}`).set(auth(owner)).send({
    overwrites: [{ id: await everyoneId(owner, sid), type: 'role', allow: '0', deny: bits.toString() }],
  })

/** A server where `a` owns it and `b` is a plain member, with one text channel. */
const world = async () => {
  const a = await register(), b = await register()
  const { server, channels } = await mkServer(a)
  await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
  return { a, b, sid: server.id as string, cid: textOf(channels).id as string }
}

describe('server search: words', () => {
  it('finds a message by a word, newest first, with its channel', async () => {
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'the release plan')
    await say(a, sid, cid, 'nothing to see')
    await say(a, sid, cid, 'new plan agreed')
    const res = await search(a, sid, 'q=plan')
    expect(res.status).toBe(200)
    expect(texts(res)).toEqual(['new plan agreed', 'the release plan'])
    expect(res.body.results[0].channelId).toBe(cid)
    expect(res.body.total).toBe(2)
  })

  it('requires every word', async () => {
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'release plan')
    await say(a, sid, cid, 'release party')
    expect(texts(await search(a, sid, 'q=release%20plan'))).toEqual(['release plan'])
  })

  it('keeps a quoted phrase together and leaves out an excluded word', async () => {
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'plan the release')
    await say(a, sid, cid, 'release the plan')
    await say(a, sid, cid, 'release the plan tomorrow')
    expect(texts(await search(a, sid, `q=${encodeURIComponent('"the plan" -tomorrow')}`))).toEqual(['release the plan'])
  })

  it('ignores case and accents', async () => {
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'Café meeting')
    expect(texts(await search(a, sid, 'q=cafe'))).toEqual(['Café meeting'])
  })

  it('refuses an empty search, and one that only excludes', async () => {
    const { a, sid } = await world()
    expect((await search(a, sid, 'q=')).status).toBe(400)
    expect((await search(a, sid, 'q=-noise')).status).toBe(400)
  })
})

describe('server search: who may find what', () => {
  it('never returns a private channel to a member who cannot see it', async () => {
    const { a, b, sid } = await world()
    const secret = await mkText(a, sid, 'secret')
    await say(a, sid, secret.id, 'hidden plan')
    await deny(a, sid, secret.id, PERMISSIONS.ViewChannels)
    expect(texts(await search(b, sid, 'q=plan'))).toEqual([])
    expect(texts(await search(a, sid, 'q=plan'))).toEqual(['hidden plan'])
  })

  it('never returns a channel whose history the member may not read', async () => {
    const { a, b, sid, cid } = await world()
    await say(a, sid, cid, 'old plan')
    await deny(a, sid, cid, PERMISSIONS.ReadMessageHistory)
    expect(texts(await search(b, sid, 'q=plan'))).toEqual([])
  })

  it('narrows with in:, and answers nothing — not an error — for a channel you cannot read', async () => {
    const { a, b, sid, cid } = await world()
    const other = await mkText(a, sid, 'other')
    await say(a, sid, cid, 'plan here')
    await say(a, sid, other.id, 'plan there')
    expect(texts(await search(a, sid, `q=plan&in=${other.id}`))).toEqual(['plan there'])
    await deny(a, sid, other.id, PERMISSIONS.ViewChannels)
    const res = await search(b, sid, `q=plan&in=${other.id}`)
    expect(res.status).toBe(200)
    expect(texts(res)).toEqual([])
  })

  it('refuses someone who is not a member of the server', async () => {
    const { sid } = await world()
    const stranger = await register()
    expect((await search(stranger, sid, 'q=plan')).status).toBe(403)
  })

  it('never returns a system message', async () => {
    const { a, sid, cid } = await world()
    await Message.create({ conversationId: cid, kind: 'system', authorId: a.id, authorName: 'sys', content: 'plan system', systemType: 'call' })
    expect(texts(await search(a, sid, 'q=plan'))).toEqual([])
  })
})

describe('server search: filters', () => {
  it('filters by author, any of several', async () => {
    const { a, b, sid, cid } = await world()
    const c = await register()
    await Server.updateOne({ _id: sid }, { $push: { members: c.id } })
    await say(a, sid, cid, 'plan from a')
    await say(b, sid, cid, 'plan from b')
    await say(c, sid, cid, 'plan from c')
    expect(texts(await search(a, sid, `q=plan&from=${a.id},${b.id}`))).toEqual(['plan from b', 'plan from a'])
  })

  it('filters by mention and by content type, and ANDs different filters', async () => {
    const { a, b, sid, cid } = await world()
    await say(a, sid, cid, `look <@${b.username}> https://x.io/a.png`)
    await say(a, sid, cid, `look <@${b.username}>`)
    await say(a, sid, cid, 'look https://x.io/b.png')
    expect(texts(await search(a, sid, `mentions=${b.id}`))).toHaveLength(2)
    expect(texts(await search(a, sid, 'has=image'))).toHaveLength(2)
    expect(texts(await search(a, sid, `mentions=${b.id}&has=image`))).toEqual([`look <@${b.username}> https://x.io/a.png`])
  })

  it('filters by pinned', async () => {
    const { a, sid, cid } = await world()
    const pinned = await say(a, sid, cid, 'keep this plan')
    await say(a, sid, cid, 'loose plan')
    await Message.updateOne({ _id: pinned.body.message._id }, { $set: { pinned: true } })
    expect(texts(await search(a, sid, 'q=plan&pinned=true'))).toEqual(['keep this plan'])
    expect(texts(await search(a, sid, 'q=plan&pinned=false'))).toEqual(['loose plan'])
  })

  it('filters by date: after inclusive, before exclusive', async () => {
    const { a, sid, cid } = await world()
    const old = await say(a, sid, cid, 'plan old')
    await say(a, sid, cid, 'plan new')
    await Message.updateOne({ _id: old.body.message._id }, { $set: { createdAt: new Date('2026-01-01T12:00:00Z') } })
    expect(texts(await search(a, sid, 'q=plan&before=2026-06-01T00:00:00.000Z'))).toEqual(['plan old'])
    expect(texts(await search(a, sid, 'q=plan&after=2026-06-01T00:00:00.000Z'))).toEqual(['plan new'])
    expect(texts(await search(a, sid, 'q=plan&after=2026-01-01T12:00:00.000Z&before=2026-01-01T12:00:00.001Z'))).toEqual(['plan old'])
  })

  it('searches with filters and no words at all', async () => {
    const { a, b, sid, cid } = await world()
    await say(b, sid, cid, 'anything')
    expect(texts(await search(a, sid, `from=${b.id}`))).toEqual(['anything'])
  })
})

describe('server search: order and paging', () => {
  it('ranks by relevance when asked, and newest first otherwise', async () => {
    // Same length, so only how often the word appears separates them; the
    // weaker match is the NEWER one, so newest-first puts it on top and only
    // a real relevance sort can reverse that.
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'plan plan plan plan')
    await say(a, sid, cid, 'plan roadmap release schedule')
    expect(texts(await search(a, sid, 'q=plan'))[0]).toBe('plan roadmap release schedule')
    expect(texts(await search(a, sid, 'q=plan&sort=relevant'))[0]).toBe('plan plan plan plan')
  })

  it('pages 25 at a time and says whether there is more', async () => {
    const { a, sid, cid } = await world()
    const docs = Array.from({ length: 30 }, (_, i) => ({
      conversationId: cid, kind: 'channel', authorId: new Types.ObjectId(a.id), authorName: 'x',
      content: `needle ${i}`, has: [], mentions: [], reactions: [], replyToIds: [],
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)), updatedAt: new Date(),
    }))
    await Message.collection.insertMany(docs)
    const first = await search(a, sid, 'q=needle')
    expect(first.body.results).toHaveLength(25)
    expect(first.body.hasMore).toBe(true)
    const second = await search(a, sid, 'q=needle&page=2')
    expect(second.body.results).toHaveLength(5)
    expect(second.body.hasMore).toBe(false)
    expect(first.body.total).toBe(30)
  })

  it('caps the total at 1,000', async () => {
    const { a, sid, cid } = await world()
    const docs = Array.from({ length: 1005 }, (_, i) => ({
      conversationId: cid, kind: 'channel', authorId: new Types.ObjectId(a.id), authorName: 'x',
      content: `haystack ${i}`, has: [], mentions: [], reactions: [], replyToIds: [],
      createdAt: new Date(), updatedAt: new Date(),
    }))
    await Message.collection.insertMany(docs)
    expect((await search(a, sid, 'q=haystack')).body.total).toBe(1000)
  })
})

describe('group and DM search', () => {
  it('searches a group for its members only', async () => {
    const a = await register(), b = await register(), c = await register()
    const g = await Conversation.create({ type: 'group', owner: a.id, members: [a.id, b.id], lastMessageAt: new Date() })
    await app().post(`/conversations/groups/${g._id}/messages`).set(auth(a)).send({ content: 'group plan' })
    const res = await app().get(`/conversations/groups/${g._id}/search?q=plan`).set(auth(b))
    expect(texts(res)).toEqual(['group plan'])
    expect(res.body.results[0].channelId).toBeUndefined()
    expect((await app().get(`/conversations/groups/${g._id}/search?q=plan`).set(auth(c))).status).toBe(403)
  })

  it('searches a DM between exactly its two people', async () => {
    const a = await register(), b = await register(), c = await register()
    await Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })
    await Friendship.create({ requester: a.id, receiver: c.id, status: 'accepted' })
    await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'dm plan with b' })
    await app().post(`/messages/dm/${c.id}`).set(auth(a)).send({ content: 'dm plan with c' })
    expect(texts(await app().get(`/messages/dm/${a.id}/search?q=plan`).set(auth(b)))).toEqual(['dm plan with b'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/__tests__/search.test.ts`
Expected: FAIL — 404s (routes do not exist).

- [ ] **Step 3: Query building** — `server/utils/messageSearch.ts`

```ts
import { Types } from 'mongoose'
import { Message } from '../models/Message'
import { SEARCH_HAS, type SearchHas } from './searchFields'

export const SEARCH_PAGE      = 25
export const SEARCH_TOTAL_CAP = 1000
const MAX_PAGE = 40

export interface SearchParams {
  /** The `$text` string, '' when the search has no words. */
  terms:    string
  from:     Types.ObjectId[]
  mentions: Types.ObjectId[]
  /** Channel ids; the controller intersects them with what the searcher may read. */
  in:       string[]
  has:      SearchHas[]
  pinned:   boolean | null
  after:    Date | null
  before:   Date | null
  sort:     'newest' | 'relevant'
  page:     number
}

const isId = (s: string) => /^[a-f0-9]{24}$/i.test(s)
const list = (raw: unknown): string[] =>
  String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean)

/**
 * `q` as a `$text` string in which every word is required.
 *
 * `$text` ORs bare words together — "release plan" matches every message with
 * either — so each word is sent quoted, which makes it required. A quoted
 * phrase stays a phrase. `-word` stays an exclusion; an excluded phrase
 * excludes each of its words. `$text` cannot answer an exclusion on its own,
 * so the caller refuses a search with no positive term and no filter.
 */
export const toTextSearch = (q: string): { terms: string; positive: number } => {
  const parts: string[] = []
  let positive = 0
  for (const m of q.matchAll(/(-?)"([^"]*)"|(-?)(\S+)/g)) {
    const negative = !!(m[1] || m[3])
    const body = (m[2] ?? m[4] ?? '').replace(/"/g, '').trim()
    if (!body || body === '-') continue
    if (negative) parts.push(...body.split(/\s+/).map(w => `-${w}`))
    else { parts.push(`"${body}"`); positive++ }
  }
  return { terms: positive ? parts.join(' ') : '', positive }
}

const date = (raw: unknown): Date | null | 'bad' => {
  if (raw == null || raw === '') return null
  const d = new Date(String(raw))
  return Number.isNaN(d.getTime()) ? 'bad' : d
}

export type ParsedSearch = { ok: true; params: SearchParams } | { ok: false; message: string }

export const parseSearch = (q: Record<string, unknown>): ParsedSearch => {
  const text = String(q.q ?? '').slice(0, 500)
  const { terms, positive } = toTextSearch(text)
  const after = date(q.after), before = date(q.before)
  if (after === 'bad' || before === 'bad') return { ok: false, message: 'Dates must be ISO instants' }
  const params: SearchParams = {
    terms,
    from:     list(q.from).filter(isId).map(id => new Types.ObjectId(id)),
    mentions: list(q.mentions).filter(isId).map(id => new Types.ObjectId(id)),
    in:       list(q.in).filter(isId),
    has:      list(q.has).filter((h): h is SearchHas => (SEARCH_HAS as readonly string[]).includes(h)),
    pinned:   q.pinned === 'true' ? true : q.pinned === 'false' ? false : null,
    after, before,
    sort:     q.sort === 'relevant' ? 'relevant' : 'newest',
    page:     Math.min(Math.max(Math.floor(Number(q.page)) || 1, 1), MAX_PAGE),
  }
  const filtered = params.from.length || params.mentions.length || params.in.length || params.has.length
    || params.pinned !== null || params.after || params.before
  if (!positive && !filtered) {
    return { ok: false, message: text.trim()
      ? 'Add a word to look for, not only ones to leave out'
      : 'Type something to search for, or pick a filter' }
  }
  return { ok: true, params }
}

/** The Mongo filter for a search over these conversations. */
export const searchFilter = (conversationIds: string[], p: SearchParams): Record<string, unknown> => {
  const f: Record<string, unknown> = { conversationId: { $in: conversationIds }, kind: { $ne: 'system' } }
  if (p.terms) f.$text = { $search: p.terms, $caseSensitive: false, $diacriticSensitive: false }
  if (p.from.length)     f.authorId = { $in: p.from }
  if (p.mentions.length) f.mentions = { $in: p.mentions }
  if (p.has.length)      f.has = { $in: p.has }
  if (p.pinned !== null) f.pinned = p.pinned
  if (p.after || p.before) {
    f.createdAt = { ...(p.after ? { $gte: p.after } : {}), ...(p.before ? { $lt: p.before } : {}) }
  }
  return f
}

/** One page of matches, the capped total, and whether another page exists. */
export const runSearch = async (filter: Record<string, unknown>, p: SearchParams) => {
  const relevant = p.sort === 'relevant' && !!p.terms
  const sort = relevant
    ? { score: { $meta: 'textScore' }, createdAt: -1, _id: -1 }
    : { createdAt: -1, _id: -1 }
  const [rows, total] = await Promise.all([
    Message.find(filter, relevant ? { score: { $meta: 'textScore' } } : {})
      .sort(sort as never)
      .skip((p.page - 1) * SEARCH_PAGE)
      .limit(SEARCH_PAGE + 1)
      .lean(),
    Message.countDocuments(filter, { limit: SEARCH_TOTAL_CAP }),
  ])
  return { rows: rows.slice(0, SEARCH_PAGE) as any[], hasMore: rows.length > SEARCH_PAGE, total }
}
```

- [ ] **Step 4: The controller** — `server/controllers/searchController.ts`

```ts
import type { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { Conversation } from '../models/Conversation'
import { loadServer } from './serversController'
import { resolveMessages, dmConvId } from './messagesController'
import { loadAccess, categoryOverwriteMap, channelViewOf, channelBits, has } from '../utils/access'
import { parseOverwrites } from '../permissions'
import { parseSearch, searchFilter, runSearch, type SearchParams } from '../utils/messageSearch'

/**
 * The text channels of a server a member may search: fully visible AND
 * readable. View alone is not enough — Read Message History is what shows a
 * channel's past, and search is nothing but its past.
 */
const searchableChannelIds = async (server: any, userId: string): Promise<string[]> => {
  const [channels, categories, access] = await Promise.all([
    Channel.find({ server: server._id, type: 'text' }).select('_id category overwrites hideWhenDenied').lean(),
    Category.find({ server: server._id }).select('_id overwrites').lean(),
    loadAccess(server, userId),
  ])
  const catOverwrites = await categoryOverwriteMap(categories as never)
  return channels
    .filter(c => {
      if (channelViewOf(access, c, catOverwrites) !== 'full') return false
      const bits = channelBits(
        access,
        catOverwrites.get(c.category ? String(c.category) : '') ?? [],
        parseOverwrites(c.overwrites as never),
      )
      return has(bits, 'ReadMessageHistory')
    })
    .map(c => c._id.toString())
}

/**
 * Run the search and shape the answer. Results are resolved per conversation
 * because reply previews are scoped to the conversation a message is in.
 */
const answer = async (res: Response, conversationIds: string[], p: SearchParams, withChannel: boolean) => {
  const { rows, total, hasMore } = await runSearch(searchFilter(conversationIds, p), p)
  const byConv = new Map<string, any[]>()
  for (const r of rows) {
    delete r.score
    const list = byConv.get(r.conversationId) ?? []
    list.push(r)
    byConv.set(r.conversationId, list)
  }
  const resolved = new Map<string, any>()
  for (const [conv, list] of byConv) {
    for (const m of await resolveMessages(list, conv)) resolved.set(String(m._id), m)
  }
  const results = rows.map(r => {
    const m = resolved.get(String(r._id))
    return withChannel ? { ...m, channelId: r.conversationId } : m
  })
  res.json({ results, total, hasMore })
}

const parsedOr400 = (req: Request, res: Response): SearchParams | null => {
  const parsed = parseSearch(req.query as Record<string, unknown>)
  if (!parsed.ok) { res.status(400).json({ message: parsed.message }); return null }
  return parsed.params
}

export const searchServerMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const p = parsedOr400(req, res); if (!p) return
    let ids = await searchableChannelIds(server, req.user!.sub)
    // A channel the searcher cannot read narrows to nothing rather than
    // erroring: an error would confirm the channel exists.
    if (p.in.length) ids = ids.filter(id => p.in.includes(id))
    if (!ids.length) { res.json({ results: [], total: 0, hasMore: false }); return }
    await answer(res, ids, p, true)
  } catch (err) { next(err) }
}

export const searchGroupMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { groupId } = req.params
    if (!mongoose.isValidObjectId(groupId)) { res.status(400).json({ message: 'Invalid group' }); return }
    const group = await Conversation.findById(groupId).select('members').lean()
    if (!group) { res.status(404).json({ message: 'Group not found' }); return }
    if (!group.members.some(m => m.toString() === req.user!.sub)) {
      res.status(403).json({ message: 'You are not a member of this group' }); return
    }
    const p = parsedOr400(req, res); if (!p) return
    await answer(res, [groupId], p, false)
  } catch (err) { next(err) }
}

export const searchDMMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params
    if (!mongoose.isValidObjectId(partnerId)) { res.status(400).json({ message: 'Invalid user' }); return }
    const p = parsedOr400(req, res); if (!p) return
    // The conversation id is built from the caller's own id, so this can only
    // ever search a DM the caller is in.
    await answer(res, [dmConvId(req.user!.sub, partnerId)], p, false)
  } catch (err) { next(err) }
}
```

- [ ] **Step 5: Routes**

`server/routes/servers.ts`: add `searchLimit` to the rate-limit import, `import { searchServerMessages } from '../controllers/searchController'`, and `router.get('/:sid/search', searchLimit, searchServerMessages)` beside the other `/:sid/...` reads.

`server/routes/conversations.ts`: `import { searchLimit } from '../middleware/rateLimit'`, `import { searchGroupMessages } from '../controllers/searchController'`, `router.get('/groups/:groupId/search', searchLimit, searchGroupMessages)`.

`server/routes/messages.ts`: the same two imports (with `searchDMMessages`), `router.get('/dm/:partnerId/search', searchLimit, searchDMMessages)`.

- [ ] **Step 6: Run it**

Run: `npx vitest run server/__tests__/search.test.ts`
Expected: PASS.

---

### Task 5: Client — query model, API call, history, `useSearch`

**Files:**
- Create: `src/composables/searchQuery.ts`, `src/composables/useSearchHistory.ts`, `src/composables/useSearch.ts`
- Modify: `src/composables/useApi.ts` (`searchMessagesApi`, `SearchScope`, `SearchResponse`)
- Test: `src/composables/__tests__/searchQuery.test.ts`, `src/composables/__tests__/useSearchHistory.test.ts`, `src/composables/__tests__/useSearch.test.ts`

**Interfaces:**
- Produces (searchQuery): `ChipKind`, `SearchChip { kind; value; label }`, `SearchQuery { chips; text }`, `SearchSort`, `HAS_TYPES`, `FilterKey`, `tokenAtEnd(text)`, `withoutTokenAtEnd(text)`, `dayBounds(day)`, `addChip(q, chip)`, `isEmpty(q)`, `describeQuery(q)`, `toSearchParams(q, sort, page)`.
- Produces (useApi): `type SearchScope = { kind: 'server' | 'group' | 'dm'; id: string }`, `SearchResponse { results: (ApiMessage & { channelId?: string })[]; total: number; hasMore: boolean }`, `searchMessagesApi(scope, params)`.
- Produces (history): `useSearchHistory() → { entries(scope), remember(scope, query), clear(scope), revision }`.
- Produces (useSearch): singleton `useSearch() → { scope, query, sort, results, total, hasMore, loading, error, open, setScope(s), run(), loadMore(), setSort(s), close() }`.

- [ ] **Step 1: Write the failing tests**

`src/composables/__tests__/searchQuery.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  tokenAtEnd, withoutTokenAtEnd, dayBounds, addChip, isEmpty, describeQuery, toSearchParams, HAS_TYPES,
  type SearchQuery,
} from '../searchQuery'

const q = (over: Partial<SearchQuery> = {}): SearchQuery => ({ chips: [], text: '', ...over })

describe('the token being typed', () => {
  it('finds a filter key at the end of the text', () => {
    expect(tokenAtEnd('plan from:ad')).toEqual({ key: 'from', partial: 'ad' })
    expect(tokenAtEnd('in:')).toEqual({ key: 'in', partial: '' })
    expect(tokenAtEnd('has:li')).toEqual({ key: 'has', partial: 'li' })
    expect(tokenAtEnd('MENTIONS:bo')).toEqual({ key: 'mentions', partial: 'bo' })
  })
  it('finds nothing mid-word or after a space', () => {
    expect(tokenAtEnd('plan')).toBeNull()
    expect(tokenAtEnd('from:ada ')).toBeNull()
    expect(tokenAtEnd('xfrom:a')).toBeNull()
  })
  it('drops the token once it has become a chip', () => {
    expect(withoutTokenAtEnd('plan from:ad')).toBe('plan')
    expect(withoutTokenAtEnd('in:gen')).toBe('')
  })
})

describe('chips', () => {
  it('does not add the same chip twice', () => {
    const one = addChip(q(), { kind: 'from', value: 'u1', label: 'Ada' })
    expect(addChip(one, { kind: 'from', value: 'u1', label: 'Ada' }).chips).toHaveLength(1)
    expect(addChip(one, { kind: 'from', value: 'u2', label: 'Bob' }).chips).toHaveLength(2)
  })
  it('keeps one of each single-valued kind, the newest', () => {
    const a = addChip(q(), { kind: 'during', value: '2026-09-01', label: 'Sep 1' })
    const b = addChip(a, { kind: 'during', value: '2026-09-02', label: 'Sep 2' })
    expect(b.chips).toEqual([{ kind: 'during', value: '2026-09-02', label: 'Sep 2' }])
  })
  it('knows an empty search', () => {
    expect(isEmpty(q({ text: '  ' }))).toBe(true)
    expect(isEmpty(q({ text: 'x' }))).toBe(false)
  })
  it('describes a search for the history list', () => {
    expect(describeQuery(q({ text: 'plan', chips: [{ kind: 'from', value: 'u1', label: 'Ada' }] }))).toBe('from: Ada plan')
  })
})

describe('dates', () => {
  it('bounds a day at local midnights', () => {
    const { start, end } = dayBounds('2026-09-10')
    expect(start.getFullYear()).toBe(2026)
    expect([start.getMonth(), start.getDate(), start.getHours()]).toEqual([8, 10, 0])
    expect([end.getMonth(), end.getDate(), end.getHours()]).toEqual([8, 11, 0])
  })
})

describe('toSearchParams', () => {
  it('sends words, lists and sort', () => {
    const p = toSearchParams(q({
      text: ' plan ',
      chips: [
        { kind: 'from', value: 'u1', label: 'Ada' }, { kind: 'from', value: 'u2', label: 'Bob' },
        { kind: 'in', value: 'c1', label: 'general' }, { kind: 'has', value: 'image', label: 'image' },
        { kind: 'mentions', value: 'u3', label: 'Cy' }, { kind: 'pinned', value: 'true', label: 'Pinned' },
      ],
    }), 'relevant', 1)
    expect(p.get('q')).toBe('plan')
    expect(p.get('from')).toBe('u1,u2')
    expect(p.get('in')).toBe('c1')
    expect(p.get('has')).toBe('image')
    expect(p.get('mentions')).toBe('u3')
    expect(p.get('pinned')).toBe('true')
    expect(p.get('sort')).toBe('relevant')
    expect(p.has('page')).toBe(false)
  })
  it('turns days into local instants: before its start, after its end, during both', () => {
    const d = dayBounds('2026-09-10')
    expect(toSearchParams(q({ chips: [{ kind: 'before', value: '2026-09-10', label: '' }] }), 'newest', 1).get('before'))
      .toBe(d.start.toISOString())
    expect(toSearchParams(q({ chips: [{ kind: 'after', value: '2026-09-10', label: '' }] }), 'newest', 1).get('after'))
      .toBe(d.end.toISOString())
    const during = toSearchParams(q({ chips: [{ kind: 'during', value: '2026-09-10', label: '' }] }), 'newest', 2)
    expect([during.get('after'), during.get('before'), during.get('page')]).toEqual([d.start.toISOString(), d.end.toISOString(), '2'])
  })
})

describe('has types', () => {
  it('lists the nine, with the ones Skycord lacks marked soon', () => {
    expect(HAS_TYPES.map(h => h.value)).toEqual(['image', 'video', 'link', 'file', 'embed', 'sound', 'poll', 'sticker', 'forward'])
    expect(HAS_TYPES.filter(h => h.soon).map(h => h.value)).toEqual(['file', 'sound', 'poll', 'sticker', 'forward'])
  })
})
```

`src/composables/__tests__/useSearchHistory.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'

class FakeStorage {
  private s: Record<string, string> = {}
  getItem(k: string) { return k in this.s ? this.s[k] : null }
  setItem(k: string, v: string) { this.s[k] = v }
  removeItem(k: string) { delete this.s[k] }
  clear() { this.s = {} }
}
;(globalThis as any).localStorage = new FakeStorage()

const { useSearchHistory } = await import('../useSearchHistory')

const server = { kind: 'server' as const, id: 's1' }
const other  = { kind: 'server' as const, id: 's2' }
const text = (t: string) => ({ chips: [], text: t })

describe('search history', () => {
  const h = useSearchHistory()
  beforeEach(() => (globalThis as any).localStorage.clear())

  it('keeps the last five searches in a scope, newest first, without repeats', () => {
    for (const t of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) h.remember(server, text(t))
    expect(h.entries(server).map(e => e.label)).toEqual(['b', 'f', 'e', 'd', 'c'])
  })
  it('keeps scopes apart', () => {
    h.remember(server, text('here'))
    expect(h.entries(other)).toEqual([])
  })
  it('clears one scope', () => {
    h.remember(server, text('x')); h.remember(other, text('y'))
    h.clear(server)
    expect(h.entries(server)).toEqual([])
    expect(h.entries(other).map(e => e.label)).toEqual(['y'])
  })
  it('ignores an empty search', () => {
    h.remember(server, text('  '))
    expect(h.entries(server)).toEqual([])
  })
})
```

`src/composables/__tests__/useSearch.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const api = vi.hoisted(() => ({ searchMessagesApi: vi.fn() }))
vi.mock('../useApi', () => ({ useApi: () => api }))

const { useSearch } = await import('../useSearch')

const page = (contents: string[], extra = {}) => ({
  results: contents.map((content, i) => ({ _id: `m${i}`, content, conversationId: 'c1', channelId: 'c1' })),
  total: contents.length, hasMore: false, ...extra,
})

describe('useSearch', () => {
  const s = useSearch()
  beforeEach(() => {
    api.searchMessagesApi.mockReset()
    s.close()
    s.setScope({ kind: 'server', id: 's1' })
    s.query.value = { chips: [], text: 'plan' }
  })

  it('runs against the scope and opens the results', async () => {
    api.searchMessagesApi.mockResolvedValue(page(['a plan']))
    await s.run()
    expect(api.searchMessagesApi).toHaveBeenCalledWith({ kind: 'server', id: 's1' }, expect.any(URLSearchParams))
    expect(api.searchMessagesApi.mock.calls[0][1].get('q')).toBe('plan')
    expect(s.results.value.map(r => r.message.content)).toEqual(['a plan'])
    expect(s.open.value).toBe(true)
  })

  it('does nothing for an empty search', async () => {
    s.query.value = { chips: [], text: '' }
    await s.run()
    expect(api.searchMessagesApi).not.toHaveBeenCalled()
  })

  it('appends the next page', async () => {
    api.searchMessagesApi.mockResolvedValueOnce(page(['one'], { hasMore: true }))
    api.searchMessagesApi.mockResolvedValueOnce(page(['two']))
    await s.run()
    await s.loadMore()
    expect(api.searchMessagesApi.mock.calls[1][1].get('page')).toBe('2')
    expect(s.results.value.map(r => r.message.content)).toEqual(['one', 'two'])
  })

  it('ignores an answer to a search that has since been replaced', async () => {
    let release!: (v: unknown) => void
    api.searchMessagesApi.mockImplementationOnce(() => new Promise(r => { release = r }))
    api.searchMessagesApi.mockResolvedValueOnce(page(['newer']))
    const first = s.run()
    s.query.value = { chips: [], text: 'other' }
    await s.run()
    release(page(['stale']))
    await first
    expect(s.results.value.map(r => r.message.content)).toEqual(['newer'])
  })

  it('shows the server’s own error text', async () => {
    api.searchMessagesApi.mockRejectedValue(new Error('Too many searches — wait a moment'))
    await s.run()
    expect(s.error.value).toBe('Too many searches — wait a moment')
  })

  it('reruns when the sort changes, and forgets results when the scope changes', async () => {
    api.searchMessagesApi.mockResolvedValue(page(['a']))
    await s.run()
    await s.setSort('relevant')
    expect(api.searchMessagesApi.mock.calls[1][1].get('sort')).toBe('relevant')
    s.setScope({ kind: 'dm', id: 'u2' })
    expect(s.results.value).toEqual([])
    expect(s.open.value).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/composables/__tests__/searchQuery.test.ts src/composables/__tests__/useSearchHistory.test.ts src/composables/__tests__/useSearch.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: `src/composables/searchQuery.ts`**

```ts
/**
 * A search as the field holds it — chips for filters, free text for words —
 * and the one place it is turned into the API's query string.
 */

export type ChipKind = 'from' | 'in' | 'mentions' | 'has' | 'before' | 'after' | 'during' | 'pinned'
export interface SearchChip { kind: ChipKind; value: string; label: string }
export interface SearchQuery { chips: SearchChip[]; text: string }
export type SearchSort = 'newest' | 'relevant'

export interface HasType { value: string; label: string; soon?: boolean }
/** The nine the reference shows. Five are features Skycord does not have yet. */
export const HAS_TYPES: readonly HasType[] = [
  { value: 'image',   label: 'image' },
  { value: 'video',   label: 'video' },
  { value: 'link',    label: 'link' },
  { value: 'file',    label: 'file',    soon: true },
  { value: 'embed',   label: 'embed' },
  { value: 'sound',   label: 'sound',   soon: true },
  { value: 'poll',    label: 'poll',    soon: true },
  { value: 'sticker', label: 'sticker', soon: true },
  { value: 'forward', label: 'forward', soon: true },
]

export type FilterKey = 'from' | 'in' | 'has' | 'mentions'
const TOKEN_RE = /(?:^|\s)(from|in|has|mentions):(\S*)$/i

/** A `key:` being typed at the end of the text — what the popup suggests for. */
export const tokenAtEnd = (text: string): { key: FilterKey; partial: string } | null => {
  const m = TOKEN_RE.exec(text)
  return m ? { key: m[1].toLowerCase() as FilterKey, partial: m[2] } : null
}

/** The text without its trailing `key:partial`, once that has become a chip. */
export const withoutTokenAtEnd = (text: string) => text.replace(TOKEN_RE, '').trimEnd()

/** Kinds a search can hold only one of: a second replaces the first. */
const SINGLE: ReadonlySet<ChipKind> = new Set(['before', 'after', 'during', 'pinned'])

export const addChip = (q: SearchQuery, chip: SearchChip): SearchQuery => {
  if (q.chips.some(c => c.kind === chip.kind && c.value === chip.value)) return q
  const kept = SINGLE.has(chip.kind) ? q.chips.filter(c => c.kind !== chip.kind) : q.chips
  return { ...q, chips: [...kept, chip] }
}

export const isEmpty = (q: SearchQuery) => !q.text.trim() && !q.chips.length

/** A one-line label for the history list. */
export const describeQuery = (q: SearchQuery) =>
  [...q.chips.map(c => `${c.kind}: ${c.label}`), q.text.trim()].filter(Boolean).join(' ')

/** Local-midnight bounds of a `YYYY-MM-DD` day. */
export const dayBounds = (day: string): { start: Date; end: Date } => {
  const [y, m, d] = day.split('-').map(Number)
  return { start: new Date(y, m - 1, d), end: new Date(y, m - 1, d + 1) }
}

/**
 * The API query string. Days become instants in the viewer's own time zone:
 * "before Sep 10" means before that day began here, "after" means after it
 * ended, "during" means within it. The server treats `after` as inclusive and
 * `before` as exclusive, so the bounds line up exactly.
 */
export const toSearchParams = (q: SearchQuery, sort: SearchSort, page: number): URLSearchParams => {
  const p = new URLSearchParams()
  const text = q.text.trim()
  if (text) p.set('q', text)
  const values = (k: ChipKind) => q.chips.filter(c => c.kind === k).map(c => c.value)
  for (const k of ['from', 'in', 'mentions', 'has'] as const) {
    const v = values(k)
    if (v.length) p.set(k, v.join(','))
  }
  const pinned = values('pinned')[0]
  if (pinned) p.set('pinned', pinned)

  let after: Date | null = null
  let before: Date | null = null
  for (const c of q.chips) {
    if (c.kind === 'before') before = dayBounds(c.value).start
    if (c.kind === 'after')  after  = dayBounds(c.value).end
    if (c.kind === 'during') ({ start: after, end: before } = dayBounds(c.value))
  }
  if (after)  p.set('after', after.toISOString())
  if (before) p.set('before', before.toISOString())
  p.set('sort', sort)
  if (page > 1) p.set('page', String(page))
  return p
}
```

- [ ] **Step 4: `useApi.ts`** — inside `useApi()`:

```ts
  /** Search one scope. The params come from searchQuery.toSearchParams. */
  const searchMessagesApi = (scope: SearchScope, params: URLSearchParams) => {
    const base = scope.kind === 'server' ? `/servers/${scope.id}/search`
      : scope.kind === 'group' ? `/conversations/groups/${scope.id}/search`
      : `/messages/dm/${scope.id}/search`
    return get<SearchResponse>(`${base}?${params.toString()}`)
  }
```

add it to the returned object, and beside the other API types:

```ts
/** What a search covers: a whole server, or one group or DM. */
export interface SearchScope { kind: 'server' | 'group' | 'dm'; id: string }

/** A page of search results. `channelId` is set for server searches. */
export interface SearchResponse { results: (ApiMessage & { channelId?: string })[]; total: number; hasMore: boolean }
```

- [ ] **Step 5: `src/composables/useSearchHistory.ts`**

```ts
import { ref } from 'vue'
import type { SearchScope } from './useApi'
import { describeQuery, isEmpty, type SearchQuery } from './searchQuery'

/**
 * The last few searches, per scope, on this device only — a search you ran in
 * one server is no help in another, and none of it is the server's business.
 * Storage can be missing or full; history then simply is not kept.
 */
const KEY = 'sky.searchHistory.v1'
const MAX = 5

export interface HistoryEntry { label: string; query: SearchQuery }

const read = (): Record<string, HistoryEntry[]> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
const write = (all: Record<string, HistoryEntry[]>) => {
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* not kept */ }
}
const keyOf = (s: SearchScope) => `${s.kind}:${s.id}`

/** Bumped on every write, so a computed that reads `entries` re-runs. */
const revision = ref(0)

export const useSearchHistory = () => {
  const entries = (scope: SearchScope): HistoryEntry[] => {
    void revision.value
    return read()[keyOf(scope)] ?? []
  }
  const remember = (scope: SearchScope, query: SearchQuery) => {
    if (isEmpty(query)) return
    const all = read()
    const label = describeQuery(query)
    const kept = (all[keyOf(scope)] ?? []).filter(e => e.label !== label)
    all[keyOf(scope)] = [{ label, query }, ...kept].slice(0, MAX)
    write(all)
    revision.value++
  }
  const clear = (scope: SearchScope) => {
    const all = read()
    delete all[keyOf(scope)]
    write(all)
    revision.value++
  }
  return { entries, remember, clear, revision }
}
```

- [ ] **Step 6: `src/composables/useSearch.ts`**

```ts
import { ref } from 'vue'
import { useApi, type ApiMessage, type SearchScope } from './useApi'
import { isEmpty, toSearchParams, type SearchQuery, type SearchSort } from './searchQuery'

export interface SearchHit { message: ApiMessage; channelId?: string }

/**
 * The one search in progress. Module-level, like the other stores: the header
 * field, the results panel and the phone screen are three views of it.
 *
 * This is also the seam E2EE needs. When DMs are end-to-end encrypted the
 * server can no longer read them, and a DM search will have to run on the
 * device instead — behind `run()`, without the views noticing.
 */
const scope   = ref<SearchScope | null>(null)
const query   = ref<SearchQuery>({ chips: [], text: '' })
const sort    = ref<SearchSort>('newest')
const results = ref<SearchHit[]>([])
const total   = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const error   = ref('')
const open    = ref(false)
let page = 1
/** Bumped per request, so a slower answer to a replaced search is dropped. */
let seq = 0

export const useSearch = () => {
  const api = useApi()

  const fetchPage = async (n: number, append: boolean) => {
    if (!scope.value || isEmpty(query.value)) return
    const mine = ++seq
    loading.value = true
    error.value = ''
    try {
      const res = await api.searchMessagesApi(scope.value, toSearchParams(query.value, sort.value, n))
      if (mine !== seq) return
      const hits = res.results.map(m => ({ message: m, channelId: m.channelId }))
      results.value = append ? [...results.value, ...hits] : hits
      total.value = res.total
      hasMore.value = res.hasMore
      page = n
      open.value = true
    } catch (e: any) {
      if (mine === seq) error.value = e?.message || 'Search failed'
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  const run = () => fetchPage(1, false)
  const loadMore = () => (hasMore.value && !loading.value ? fetchPage(page + 1, true) : Promise.resolve())
  const setSort = (s: SearchSort) => { sort.value = s; return run() }

  /** Close the panel and forget the answer; the typed search stays. */
  const close = () => {
    seq++
    open.value = false
    results.value = []
    total.value = 0
    hasMore.value = false
    loading.value = false
    error.value = ''
  }

  /** A different server or conversation: its answers mean nothing here. */
  const setScope = (s: SearchScope | null) => {
    const same = s && scope.value && s.kind === scope.value.kind && s.id === scope.value.id
    if (same) return
    scope.value = s
    query.value = { chips: [], text: '' }
    close()
  }

  return { scope, query, sort, results, total, hasMore, loading, error, open, setScope, run, loadMore, setSort, close }
}
```

- [ ] **Step 7: Run the client tests, then typecheck**

Run: `npx vitest run src/composables/__tests__/searchQuery.test.ts src/composables/__tests__/useSearchHistory.test.ts src/composables/__tests__/useSearch.test.ts` then `npm run typecheck`
Expected: PASS.

---

### Task 6: Verification

- [ ] **Step 1:** Full server suite in the background; grep its summary → all passed, `EXIT 0`.
- [ ] **Step 2:** `npx vitest run src/` → all passed; `npm run typecheck`; `npm run build` → `✓ built`.
- [ ] **Step 3:** Restart the dev API (nodemon does it on save) and confirm the log shows `✓ Search fields filled on N message(s)` once, then nothing on the next restart.
- [ ] **Step 4:** Against the dev API, as the signed-in test account in the Playwright page: `fetch('/servers/<Channel Test id>/search?q=seed')` returns results with `channelId`, `total`, `hasMore`.
