# Channels Plan 3c — Categories

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group channels under collapsible categories, the way every real server organises itself — the reference screenshots have seven of them, and a flat list of 25 channels is unusable.

**Architecture:** A new `Category` model (`server`, `name`, `position`) and a nullable `category` reference on `Channel`. Unlike plans 3a and 3b this one **does** touch the server: model, CRUD endpoints, socket events. No migration is needed — `category` defaults to `null`, which reads as "uncategorised", and every existing channel is already exactly that. This is the same expand-only pattern `avatarCrop` and `Server.description` shipped under.

**Tech Stack:** Express + Mongoose + Socket.IO on the server; Vue 3 `<script setup lang="ts">` on the client; vitest + supertest.

## Global Constraints

- **No new runtime or dev dependencies.**
- **`npm run typecheck` must exit 0.** It runs `vue-tsc` over the client and `tsc` over the server, and the baseline at `560b2d9` is genuinely zero errors.
- **No `.vue` imports in any test file** — vitest runs in a node environment with no DOM.
- **All existing tests stay green.** The baseline is **175 passing across 20 files**. Run `npx vitest run` unfiltered before every commit. **Requires Docker/MongoDB** — a stopped daemon presents as `connectDb` hook timeouts across ~15 files, which is an environment failure, not a code one.
- **No migration, and no backfill script.** This repo has no migration mechanism and does not need one here: `category: null` on an existing channel already means "uncategorised". If a task appears to need a migration, stop and report — it means the schema is wrong.
- **Files have mixed CRLF/LF line endings.** Use content-based edits, never line-number edits.
- **Out of scope:** drag-to-reorder (channels and categories both keep append-order `position`, as channels do today), per-category permissions, the member list, voice-channel join, Server Settings, the phone layout.

## Three decisions and why

**A separate `Category` model, not `type: 'category'` on `Channel`.** Discord models categories as channels with a parent, and that is tempting because it reuses ordering and CRUD. It is wrong here: `Channel.type` is `'text' | 'voice'` and that enum is load-bearing in `sendChannelMessage` (which rejects non-text), `loadChannel`, the `chan:<id>` socket room joins, and the client's `textChannels` / `voiceChannels` computeds. Adding a third value means every one of those needs a new guard, and any site that missed one would treat a category as a postable channel. A separate collection cannot be posted to by construction.

**Deleting a category never deletes its channels.** They become uncategorised. Discord offers both, but the destructive variant needs a second confirmation and a clear count, and a category delete that silently takes ten channels with it is the kind of thing people do once and never forgive. Deleting channels stays an explicit per-channel action.

**Collapse state is client-only, in `localStorage`.** Which categories you have collapsed is a per-device view preference, not shared state — it does not belong in the database or on the wire, and it must not cost a round trip. `useAppearance.ts` is the existing precedent for localStorage-backed UI state.

---

### Task 1: The Category model and `Channel.category`

**Files:**
- Create: `server/models/Category.ts`
- Create: `server/__tests__/categoryModel.test.ts`
- Modify: `server/models/Channel.ts`

**Interfaces:**
- Produces: `Category` model with `{ server, name, position }`; `Channel.category: Types.ObjectId | null`; `MAX_CATEGORIES`

- [ ] **Step 1: Read the models you are mirroring**

```bash
cat server/models/Channel.ts
sed -n '1,40p' server/models/Server.ts
sed -n '1,30p' server/__tests__/channelModel.test.ts
```

`Channel` is the shape to copy — same field style, same `timestamps: true, versionKey: false`, same compound index. `Server.ts` shows where a `MAX_*` constant lives and how it is exported.

- [ ] **Step 2: Write the failing test**

Create `server/__tests__/categoryModel.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { connectDb, disconnectDb, resetDb } from './helpers'
import { Category } from '../models/Category'
import { Channel } from '../models/Channel'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const server = () => new mongoose.Types.ObjectId()

describe('Category model', () => {
  it('defaults to position 0', async () => {
    const c = await Category.create({ server: server(), name: 'Text Channels' })
    expect(c.position).toBe(0)
  })

  it('requires a name', async () => {
    await expect(Category.create({ server: server() })).rejects.toThrow()
  })

  it('requires a server', async () => {
    await expect(Category.create({ name: 'Orphan' })).rejects.toThrow()
  })

  it('caps the name length', async () => {
    await expect(Category.create({ server: server(), name: 'x'.repeat(101) })).rejects.toThrow()
  })
})

describe('Channel.category', () => {
  it('is null by default, which is what every pre-existing channel already reads as', async () => {
    const c = await Channel.create({ server: server(), name: 'general' })
    expect(c.category).toBeNull()
  })

  it('stores a category reference', async () => {
    const sid = server()
    const cat = await Category.create({ server: sid, name: 'POSTS' })
    const ch  = await Channel.create({ server: sid, name: 'posts', category: cat._id })
    expect(ch.category!.toString()).toBe(cat._id.toString())
  })

  it('can be cleared back to uncategorised', async () => {
    const sid = server()
    const cat = await Category.create({ server: sid, name: 'POSTS' })
    const ch  = await Channel.create({ server: sid, name: 'posts', category: cat._id })
    await Channel.updateOne({ _id: ch._id }, { category: null })
    const fresh = await Channel.findById(ch._id).lean()
    expect(fresh!.category).toBeNull()
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run server/__tests__/categoryModel.test.ts
```

Expected: FAIL — cannot resolve `../models/Category`.

- [ ] **Step 4: Write the model**

Create `server/models/Category.ts`:

```ts
import mongoose, { Document, Schema, Types } from 'mongoose'

/**
 * A named group of channels inside a server.
 *
 * Deliberately its own collection rather than a third `Channel.type`. Discord
 * models categories as channels with a parent, but here `Channel.type` is
 * `'text' | 'voice'` and that enum is load-bearing: sendChannelMessage rejects
 * anything non-text, loadChannel and the chan:<id> room joins assume it, and
 * the client splits on it. A third value would need a new guard at every one
 * of those sites, and a missed one would treat a category as postable. A
 * separate collection cannot be posted to by construction.
 */
export const MAX_CATEGORIES = 50

export interface ICategory extends Document {
  _id:      Types.ObjectId
  server:   Types.ObjectId
  name:     string
  /** Order within the server. Assigned by appending; no reorder UI yet. */
  position: number
  createdAt: Date
  updatedAt: Date
}

const CategorySchema = new Schema<ICategory>(
  {
    server:   { type: Schema.Types.ObjectId, ref: 'Server', required: true },
    name:     { type: String, required: true, maxlength: 100 },
    position: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
)

CategorySchema.index({ server: 1, position: 1 })

export const Category = mongoose.model<ICategory>('Category', CategorySchema)
```

And add the field to `server/models/Channel.ts` — to the `IChannel` interface:

```ts
  /**
   * The category this channel sits under, or null for uncategorised.
   *
   * Null is the default precisely so no migration is needed: every channel
   * that existed before categories reads as uncategorised, which is exactly
   * what it is.
   */
  category: Types.ObjectId | null
```

and to the schema, next to `position`:

```ts
    category: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run server/__tests__/categoryModel.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Full suite and typecheck**

```bash
npm run typecheck && npx vitest run
```

Expected: exit 0, then **182 passing** (175 + 7).

- [ ] **Step 7: Commit**

```bash
git add server/models/Category.ts server/models/Channel.ts server/__tests__/categoryModel.test.ts
git commit -m "feat(server): Category model and a nullable category on Channel"
```

---

### Task 2: Category CRUD endpoints and socket events

**Files:**
- Create: `server/controllers/categoriesController.ts`, `server/__tests__/categories.test.ts`
- Modify: `server/routes/servers.ts`, `server/controllers/serversController.ts` (`getServer`), `server/controllers/channelsController.ts` (create/update accept `category`)

**Interfaces:**
- Consumes: `Category`, `MAX_CATEGORIES` (Task 1); `loadServer`, `requireOwner`, `emitToServer` from `serversController`
- Produces: `shapeCategory(c)`; routes `POST/PATCH/DELETE /servers/:sid/categories`; events `category:created`, `category:updated`, `category:deleted`; `getServer` now returns `categories`

- [ ] **Step 1: Read the controller you are mirroring**

```bash
sed -n '1,140p' server/controllers/channelsController.ts
sed -n '1,100p' server/controllers/serversController.ts
sed -n '1,40p' server/routes/servers.ts
```

`channelsController` is the closest analogue: same `loadServer` + `requireOwner` gate, same `emitToServer` broadcast, same `shape*` helper, same `writeLimit` on writes. Match it exactly rather than inventing a new structure.

- [ ] **Step 2: Write the failing tests**

Create `server/__tests__/categories.test.ts`. Read `server/__tests__/channels.test.ts` first and mirror its harness (`app()`, `register`, `auth`, `resetDb`). Cover:

- an owner creates a category; the response is `{ category: { id, server, name, position } }`
- `position` is assigned by appending — the second category created gets a higher position than the first
- a **non-owner** gets 403 on create, on rename, and on delete
- a non-member gets 404 (not 403 — that would confirm the server exists)
- creating past `MAX_CATEGORIES` is refused with a clear message
- an empty or whitespace-only name is refused with 400
- a name over 100 characters is refused with 400
- rename changes the name and leaves `position` alone
- **deleting a category reparents its channels to `null` and does not delete them** — create a category, put two channels in it, delete it, then assert both channels still exist with `category === null`
- deleting a category that belongs to a *different* server 404s rather than deleting it
- `GET /servers/:sid` now returns `categories` alongside `channels`
- creating a channel with a `category` stores it; creating one with a category id belonging to another server is refused
- moving a channel between categories via `PATCH` works, and `category: null` moves it back to uncategorised

Write real assertions, not smoke tests — for the reparent case in particular, assert on the channels' `category` field after the delete, not merely that the request returned 200.

- [ ] **Step 3: Run them and watch them fail**

```bash
npx vitest run server/__tests__/categories.test.ts
```

Expected: FAIL — the routes do not exist yet, so most will 404.

- [ ] **Step 4: Write the controller**

Create `server/controllers/categoriesController.ts` following `channelsController`'s structure. The shape helper:

```ts
export const shapeCategory = (c: any) => ({
  id:       c._id.toString(),
  server:   c.server.toString(),
  name:     c.name,
  position: c.position,
})
```

`createCategory` appends: read the current count for the server and use it as `position`, the same way channel creation assigns its own. Guard on `MAX_CATEGORIES`.

`deleteCategory` reparents before removing, and both steps must be visible to the broadcast:

```ts
    // Channels outlive their category. Reparent first, then delete — if the
    // delete happened first, a concurrent read could see channels pointing at
    // a category that no longer exists. Deleting a category is a tidying
    // action; taking ten channels and their history with it is not something
    // a single click should be able to do.
    await Channel.updateMany({ server: server._id, category: category._id }, { category: null })
    await Category.deleteOne({ _id: category._id })

    emitToServer(server, 'category:deleted', {
      serverId:   server._id.toString(),
      categoryId: category._id.toString(),
    })
```

The `category:deleted` payload carries only ids. The client already knows which channels were in the category and can reparent them locally — sending the whole channel list would be a second source of truth for something the client can derive.

Emit `category:created` with `{ serverId, category: shapeCategory(cat) }` and `category:updated` the same way, matching how `channel:created` / `channel:updated` are shaped.

- [ ] **Step 5: Mount the routes**

In `server/routes/servers.ts`, alongside the channel routes:

```ts
router.post('/:sid/categories',        writeLimit,  createCategory)
router.patch('/:sid/categories/:cid',  writeLimit,  updateCategory)
router.delete('/:sid/categories/:cid',              deleteCategory)
```

- [ ] **Step 6: Return categories from `getServer`**

In `serversController.ts`, `getServer` currently returns `{ server, channels }`. Add categories, sorted the same way channels are:

```ts
    const categories = await Category.find({ server: server._id }).sort({ position: 1 }).lean()
    res.json({
      server:     shapeServer(server),
      channels:   channels.map(shapeChannel),
      categories: categories.map(shapeCategory),
    })
```

And add `category` to `shapeChannel` so the client can group without a second lookup:

```ts
export const shapeChannel = (c: any) => ({
  id:       c._id.toString(),
  server:   c.server.toString(),
  name:     c.name,
  type:     c.type,
  position: c.position,
  category: c.category ? c.category.toString() : null,
})
```

Adding a field to `shapeChannel` changes every payload that carries a channel — `channel:created`, `channel:updated`, `createServer`, `createChannel`. That is intended; check the existing channel tests still pass and update any that assert on an exact object shape.

- [ ] **Step 7: Accept `category` on channel create and update**

In `channelsController.ts`, `createChannel` and `updateChannel` both take a `category` from the body. Validate it: it must be a category **belonging to this server**, or `null`. A category id from another server must be refused, not silently stored — otherwise a channel disappears from both servers' sidebars.

- [ ] **Step 8: Run the tests, then everything**

```bash
npx vitest run server/__tests__/categories.test.ts
npm run typecheck && npx vitest run
```

Expected: the new file passes, then exit 0 and **182 + your new count** passing with nothing previously green now red.

- [ ] **Step 9: Commit**

```bash
git add server/controllers/categoriesController.ts server/routes/servers.ts server/controllers/serversController.ts server/controllers/channelsController.ts server/__tests__/categories.test.ts
git commit -m "feat(server): category CRUD, reparenting delete, and category on the channel wire shape"
```

---

### Task 3: Client state — categories in `useServers`

**Files:**
- Modify: `src/composables/useServers.ts`, `src/composables/useApi.ts`, `src/types/index.ts`
- Modify: `src/composables/__tests__/useServers.test.ts`

**Interfaces:**
- Produces: `categoriesByServer`, `groupedChannels` (the computed the sidebar renders), `upsertCategory`, `removeCategory`, `collapsedCategories`, `toggleCategory`

- [ ] **Step 1: Widen the types**

`WireChannel` in `useApi.ts` gains `category: string | null`. Add `WireCategory`:

```ts
/** Exactly `shapeCategory` in server/controllers/categoriesController.ts. */
export interface WireCategory {
  id:       string
  server:   string
  name:     string
  position: number
}
```

and the client `Channel` type in `src/types/index.ts` gains `category?: string | null`.

Add the three API calls next to the channel ones, verifying each response shape against the controller:

```ts
  const createCategoryApi = (sid: string, name: string) =>
    post<{ category: WireCategory }>(`/servers/${sid}/categories`, { name })

  const updateCategoryApi = (sid: string, cid: string, body: { name?: string }) =>
    patch<{ category: WireCategory }>(`/servers/${sid}/categories/${cid}`, body)

  const deleteCategoryApi = (sid: string, cid: string) =>
    del<{ ok: boolean }>(`/servers/${sid}/categories/${cid}`)
```

`getServerDetail`'s return type gains `categories: WireCategory[]`.

- [ ] **Step 2: Write the failing tests**

Add to `src/composables/__tests__/useServers.test.ts`. The existing `beforeEach` resets module-level state by assigning to the exposed refs — extend it to reset the new ones too, or the suite gains order-dependence (this exact problem was found and fixed in plan 3a; do not reintroduce it).

Cover:

- `groupedChannels` puts uncategorised channels in a leading group with no category
- channels are grouped under their category, and categories come out in `position` order
- within a group, text channels precede voice channels, each in `position` order
- a category with no channels still appears (you must be able to see it to add to it)
- `removeCategory` reparents its channels to uncategorised rather than dropping them — this mirrors the server and is the one piece of client logic that must not diverge from it
- `upsertCategory` adds a new category and updates an existing one in place, without duplicating
- a category for a server whose detail was never fetched is ignored, matching `upsertChannel`'s existing behaviour
- `toggleCategory` flips collapsed state and `collapsedCategories` persists across a simulated reload (write, re-read from the same storage key)
- collapsing a category the user is *currently viewing a channel in* does not change `activeChannelId` — collapse is a view concern, not a navigation one

- [ ] **Step 3: Run them and watch them fail, then implement**

`groupedChannels` is the heart of this task. It returns, for the active server:

```ts
export interface ChannelGroup {
  /** null for the leading uncategorised group. */
  category: Category | null
  text:     Channel[]
  voice:    Channel[]
}
```

Uncategorised first, then categories by `position`. Within each group, text then voice, each by `position`. A category with no channels still yields a group with two empty arrays.

Collapse state is `localStorage`-backed, keyed per server and category, following `useAppearance.ts`'s read/write pattern (a single JSON blob under one key, wrapped in try/catch so a corrupt value degrades to "nothing collapsed" rather than throwing on boot).

- [ ] **Step 4: Full suite and typecheck**

```bash
npm run typecheck && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/composables/useServers.ts src/composables/useApi.ts src/types/index.ts src/composables/__tests__/useServers.test.ts
git commit -m "feat: group channels by category, with per-device collapse state"
```

---

### Task 4: The sidebar renders groups

**Files:**
- Modify: `src/views/ChatApp.vue` (the channel sidebar, and its socket handlers)

- [ ] **Step 1: Replace the two hardcoded groups**

The sidebar currently renders a fixed `TEXT CHANNELS` group and a fixed `VOICE CHANNELS` group from `textChannels` / `voiceChannels`. Replace both with a `v-for` over `groupedChannels`.

Each group renders: a collapse chevron that rotates, the category name (uppercase, matching the current `.ch-group-label` styling), an owner-only `+` to create a channel *in that category*, and then its text and voice rows — reusing the existing `.ch-item` markup unchanged, including `role="button"`, `tabindex="0"`, the `.self`-guarded key handlers, and the `.ch-more` menu button.

The leading uncategorised group has **no header at all** when it has channels, and does not render when it is empty — an "Uncategorised" label above every server's `#general` would be noise.

A collapsed category still shows its unread and active channels — Discord does this, and hiding the channel you are currently in is disorienting. Collapse hides only the read, inactive rows.

- [ ] **Step 2: Wire the socket handlers**

Three new events alongside the channel ones in `useSocket.ts` and `ChatApp.vue`, following exactly the pattern `channel:created` / `:updated` / `:deleted` already use:

```ts
    _socket.on('category:created', (p: any) => _h.onCategoryCreated(p))
    _socket.on('category:updated', (p: any) => _h.onCategoryUpdated(p))
    _socket.on('category:deleted', (p: any) => _h.onCategoryDeleted(p))
```

`onCategoryDeleted` reparents locally — the payload carries only ids, so the client moves that category's channels to uncategorised itself, matching what the server just did.

Also: `channel:updated` now carries `category`, so moving a channel between categories arrives through the existing handler with no change. Verify `upsertChannel` actually re-groups rather than updating in place and leaving the old grouping cached.

- [ ] **Step 3: Typecheck, test, build**

```bash
npm run typecheck && npx vitest run && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/composables/useSocket.ts src/views/ChatApp.vue
git commit -m "feat: sidebar renders collapsible category groups"
```

---

### Task 5: Category management UI

**Files:**
- Create: `src/composables/contextMenus/categoryMenu.ts` + its test
- Modify: `src/views/ChatApp.vue`, `src/composables/contextMenus/serverMenu.ts`, `src/components/modals/CreateChannelModal.vue`

- [ ] **Step 1: The category context menu**

`buildCategoryMenu(category, isOwner, handlers)` following `channelMenu.ts` exactly — same `onSelect`, same `danger` flag, same ownership gating. Owner rows: Create Channel, Edit Category, Delete Category, Copy Category ID. Non-owner: Copy Category ID only.

Write the test first. Cover the owner and non-owner row sets exhaustively (pin the complete expected list, not just individual absences — that is what caught a regression in 3b), that delete is marked `danger`, and that Copy passes the category id rather than its name.

- [ ] **Step 2: Delete confirmation must state what happens**

Deleting a category does **not** delete its channels. The confirmation has to say so plainly, or an owner will assume the worst and never use it:

> Delete **POSTS**? The 4 channels in it will move out of the category — they won't be deleted.

Use the shared `ConfirmModal` and the existing `confirmState`, which already serves Leave Server, Delete Server and Delete Channel. Compute the channel count from `groupedChannels` so the number is real.

- [ ] **Step 3: Create Category**

Add a `Create Category` row to `serverMenu.ts` inside its existing `isOwner` branch, and update that menu's tests — they pin the complete owner row set, so they will fail until updated. That failure is correct; do not weaken the assertion to accommodate the new row, extend it.

Reuse `EditFieldModal` for both create and rename, as channel rename already does.

- [ ] **Step 4: Create a channel inside a category**

`CreateChannelModal` gains an optional `categoryId` prop, passed straight through to `createChannelApi`. The group header's `+` opens it pre-targeted at that category; the server menu's Create Channel opens it with no category, producing an uncategorised channel.

The modal should say which category it will create in when it has one, so the two entry points are visibly different.

- [ ] **Step 5: Typecheck, test, build, commit**

---

### Task 6: Browser verification

The gate for Tasks 4 and 5. Use the browser pane.

**Environment:** MongoDB up (Docker). `skycord-api` on **8990** — must match `API_PORT` in `.env` or every call 404s through the Vite proxy — and `skycord-dev` on 8090. Test accounts `slicetest_a` / `slicetest_b`, password `SliceTest!2026`, already exist. Note the Browser pane must be **displayed** for screenshots and real input; if it is not, drive the DOM with dispatched events, which do reach Vue handlers including modifier guards.

Walk these:

1. A server with no categories looks exactly as it did before — a flat list, no stray "Uncategorised" header.
2. Create a category. It appears immediately, empty, with a visible header.
3. Create a channel inside it from the group's `+`. It lands in that category, not at the top level.
4. Collapse the category. Read, inactive channels hide; the active channel and any unread ones stay visible.
5. Reload. The collapse state survives.
6. Switch to another server and back. Collapse state is per server, not global.
7. Rename the category. Both clients update.
8. Move a channel between categories, and out to uncategorised.
9. **Delete a category with channels in it.** Read the confirmation copy, accept, then verify on *both* clients that the channels moved to uncategorised and none were deleted. This is the one behaviour a user will not forgive being wrong.
10. As a non-owner: no `+` on any group header, and a right-click on a category offers only Copy Category ID.
11. Console errors and any 4xx.

---

## Deploy gate

Unchanged and still open from 3a/3b: `/etc/nginx/sites-available/skycord` needs `servers` and `invites` in its location alternation, and `/join/<code>` must fall through to the SPA index the way `/theme/<slug>` does. Categories add no new path.

## Carried forward

- `role="button"` on `.ch-item` containing a real `<button>` is ARIA children-presentational. The correct shape is a plain `div` row with the label wrapped in the button and `.ch-more` as its sibling — the `.self` guards then become unnecessary. Not a regression; worth doing when the sidebar markup is next opened, which **is this plan's Task 4**.
- Non-owner paths across 3b are unit-tested only, never exercised in a browser.
- Deleting a channel orphans its `Message` documents server-side.
- `vite.config.ts` hardcodes `hmr.clientPort: 5173` while the dev launch config serves 8090, so HMR dials a dead port.
- Presence events have no ordering guarantee — a rapid disconnect/reconnect can deliver `offline` after `online`.
- Invites are owner-only; Discord makes this a per-role permission with `@everyone` allowed by default.
