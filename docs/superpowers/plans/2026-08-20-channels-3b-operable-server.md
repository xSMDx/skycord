# Channels Plan 3b — Making a Server Operable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 3a slice into a server people can actually use — invite someone in, and add channels beyond the two `createServer` gives you.

**Architecture:** Entirely client-side. Every endpoint this plan calls already exists, is merged, and is covered by the server suite: invites (`POST/GET/DELETE /servers/:sid/invites`, `GET/POST /invites/:code`) and channels (`POST/PATCH/DELETE /servers/:sid/channels`). The work is UI: a server dropdown to host the actions, an invite modal, a way to consume a pasted invite link, a create-channel modal, and a channel context menu.

**Tech Stack:** Vue 3 `<script setup lang="ts">`, Composition API, socket.io-client, vitest (node environment, no DOM).

## Global Constraints

- **No new runtime or dev dependencies.** No jsdom, no `@vue/test-utils`, no vue-router — this app deliberately has no router and matches paths in `App.vue` (see the `/theme/<slug>` precedent at `src/App.vue:18-29`).
- **`npm run typecheck` must exit 0.** It runs `vue-tsc` over the client and `tsc` over the server. It is a real gate — the baseline is genuinely zero errors as of `ab08299`.
- **No `.vue` imports in any test file.** Vitest's default environment is node with no DOM.
- **Server-side code (`server/`) is out of scope.** Everything here is already supported. If a task appears to need a server change, stop and report it.
- **All existing tests stay green.** Baseline at `ab08299` is **163 passing across 18 files**. Run `npx vitest run` unfiltered before every commit. **Requires Docker/MongoDB running** — a stopped daemon shows up as `connectDb` hook timeouts across ~15 files, which is an environment failure, not a code one.
- **Match the existing modal and menu patterns.** `ModalBase` has **no `footer` slot** and ignores its `title` prop; sibling modals (`NewDMModal`, `AddFriendModal`, `CreateServerModal`) build their own header and footer inside the default slot. Context menus are plain item arrays built in `src/composables/contextMenus/*.ts` and opened through `useContextMenu`.
- **Out of scope, deferred to 3c and beyond:** categories (they need a server-side model change — see below), member list, voice-channel join, Server Settings, channel reordering, per-channel permissions, the phone layout.

## Two findings that shaped this plan

**Categories are not in 3b, because they are not client work.** `server/models/Channel.ts` has `server`, `name`, `type`, `position` and no parent field. Categories need a model change, a migration for existing channels, CRUD endpoints, and socket events before any UI can exist. That is plan 3c. Until then the sidebar keeps 3a's flat `TEXT CHANNELS` / `VOICE CHANNELS` split.

**`/invite/<code>` is already taken by group invites.** `src/components/chat/MessageItem.vue:84` matches `/invite/([A-Za-z0-9_-]{6,12})` and renders a `GroupInviteCard`, and `InviteGroupModal.vue:92` mints links in that shape. Server invite codes come from a different collection and could collide. So server invites use **`/join/<code>`** — a distinct path, no ambiguity, no lookup-then-fallback. Both link shapes coexist.

---

### Task 1: The server dropdown menu

The sidebar header (`.sb-header`) already renders the server name and a chevron, and already has a `cursor:pointer` and a hover state — but no click handler. It is decoration. This task makes it the home for everything else in the plan.

**Files:**
- Create: `src/composables/contextMenus/serverMenu.ts`
- Create: `src/composables/contextMenus/__tests__/serverMenu.test.ts`
- Modify: `src/views/ChatApp.vue` (the `.sb-header` block, currently ~line 2000)

**Interfaces:**
- Consumes: `MenuItem` from `src/composables/useContextMenu`
- Produces: `buildServerMenu(server, handlers): MenuItem[]` — used by Tasks 2 and 4

- [ ] **Step 1: Read the pattern you are copying**

```bash
sed -n '1,60p' src/composables/contextMenus/conversationMenu.ts
sed -n '1,60p' src/composables/useContextMenu.ts
```

`MenuAction`, `MenuSeparator`, and the `openMenu` call shape are all defined there. Match them exactly; do not invent a new menu mechanism.

- [ ] **Step 2: Write the failing test**

Create `src/composables/contextMenus/__tests__/serverMenu.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildServerMenu } from '../serverMenu'
import { isAction, isSeparator, type MenuItem } from '../../useContextMenu'

const handlers = () => ({
  invitePeople: vi.fn(),
  createChannel: vi.fn(),
  leaveServer: vi.fn(),
  deleteServer: vi.fn(),
  copy: vi.fn(),
})

const labels = (items: MenuItem[]) =>
  items.filter(isAction).map(i => i.label)

describe('buildServerMenu', () => {
  it('offers Invite People and Create Channel to the owner', () => {
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers()))
    expect(l).toContain('Invite People')
    expect(l).toContain('Create Channel')
  })

  it('offers the owner Delete Server, never Leave Server', () => {
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers()))
    expect(l).toContain('Delete Server')
    expect(l).not.toContain('Leave Server')
  })

  it('offers a non-owner Leave Server, never Delete Server', () => {
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'someone' }, 'me', handlers()))
    expect(l).toContain('Leave Server')
    expect(l).not.toContain('Delete Server')
  })

  it('hides Create Channel from a non-owner', () => {
    // The server 403s a non-owner creating a channel, so offering the row
    // would produce a modal that can only fail.
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'someone' }, 'me', handlers()))
    expect(l).not.toContain('Create Channel')
  })

  it('still offers a non-owner Invite People', () => {
    const l = labels(buildServerMenu({ id: 's1', name: 'HQ', owner: 'someone' }, 'me', handlers()))
    expect(l).toContain('Invite People')
  })

  it('marks the destructive row danger', () => {
    const items = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers())
    const del = items.filter(isAction).find(i => i.label === 'Delete Server')
    expect(del?.danger).toBe(true)
  })

  it('copies the server id', () => {
    const h = handlers()
    const items = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', h)
    items.filter(isAction).find(i => i.label === 'Copy Server ID')!.onClick()
    expect(h.copy).toHaveBeenCalledWith('s1', 'Server ID')
  })

  it('separates the destructive row from the rest', () => {
    const items = buildServerMenu({ id: 's1', name: 'HQ', owner: 'me' }, 'me', handlers())
    expect(items.some(isSeparator)).toBe(true)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run src/composables/contextMenus/__tests__/serverMenu.test.ts
```

Expected: FAIL — `Failed to resolve import "../serverMenu"`.

- [ ] **Step 4: Implement**

Create `src/composables/contextMenus/serverMenu.ts`:

```ts
/**
 * The menu behind the sidebar header's chevron.
 *
 * Rows are gated on ownership rather than shown-and-disabled, because the
 * server 403s a non-owner on channel creation and deletion — a row that can
 * only ever fail is worse than no row, which is the same rule conversationMenu
 * follows for its unimplemented entries.
 *
 * Server Settings is deliberately absent, not disabled: it has no
 * implementation at all yet (plan 3c+).
 */
import { UserPlus, Plus, Copy, Trash2, LogOut } from 'lucide-vue-next'
import type { MenuItem } from '../useContextMenu'

export interface MenuServer { id: string; name: string; owner?: string }

export interface ServerMenuHandlers {
  invitePeople:  (serverId: string) => void
  createChannel: (serverId: string) => void
  leaveServer:   (serverId: string) => void
  deleteServer:  (serverId: string) => void
  copy:          (text: string, what: string) => void
}

export const buildServerMenu = (
  server: MenuServer,
  myId: string | undefined,
  h: ServerMenuHandlers,
): MenuItem[] => {
  const isOwner = !!myId && server.owner === myId
  const items: MenuItem[] = [
    { label: 'Invite People', icon: UserPlus, onClick: () => h.invitePeople(server.id) },
  ]
  if (isOwner) {
    items.push({ label: 'Create Channel', icon: Plus, onClick: () => h.createChannel(server.id) })
  }
  items.push(
    { label: 'Copy Server ID', icon: Copy, onClick: () => h.copy(server.id, 'Server ID') },
    { sep: true },
    isOwner
      ? { label: 'Delete Server', icon: Trash2, danger: true, onClick: () => h.deleteServer(server.id) }
      : { label: 'Leave Server',  icon: LogOut, danger: true, onClick: () => h.leaveServer(server.id) },
  )
  return items
}
```

If `MenuAction` has no `danger` field, check what `conversationMenu.ts` uses for its destructive rows and use that instead — do not add a new field to the menu type.

- [ ] **Step 5: Run the test**

```bash
npx vitest run src/composables/contextMenus/__tests__/serverMenu.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Wire the header in ChatApp.vue**

Find the `.sb-header` block (currently ~line 2000) and give it a click handler:

```html
        <div class="sb-header" @click.stop="openServerMenu($event)">
          <span>{{ activeServer?.name }}</span>
          <ChevronDown :size="14" :stroke-width="1.5"/>
        </div>
```

Add the opener next to the other menu openers in the script. Match how existing menus are opened — read a current `openMenu(...)` call site first rather than guessing the argument order:

```ts
const openServerMenu = (e: MouseEvent) => {
  const s = activeServer.value
  if (!s) return
  const el = (e.currentTarget as HTMLElement).getBoundingClientRect()
  openMenu(el.left, el.bottom + 4, buildServerMenu(s, authUser.value?.id, {
    invitePeople:  () => { showInvite.value = true },          // Task 2
    createChannel: () => { showCreateChannel.value = true },   // Task 4
    leaveServer:   () => {},   // wired in Step 7
    deleteServer:  () => {},   // wired in Step 7
    copy:          (t, what) => { navigator.clipboard.writeText(t); showToast(`${what} copied`) },
  }))
}
```

`showInvite` and `showCreateChannel` are `ref(false)` declared alongside the other modal flags; the modals themselves arrive in Tasks 2 and 4. Declare the refs now so the menu compiles, and add both to the app's Escape-reset array where every other modal flag lives.

- [ ] **Step 7: Wire leave and delete**

Both endpoints exist. `DELETE /servers/:sid` (owner only) and `DELETE /servers/:sid/members/:uid` (used with your own id to leave). Add them to `useApi.ts` next to the other server calls:

```ts
  const deleteServerApi = (sid: string) =>
    del<{ deleted: boolean }>(`/servers/${sid}`)

  const leaveServerApi = (sid: string, uid: string) =>
    del<{ removed: boolean }>(`/servers/${sid}/members/${uid}`)
```

Confirm those response shapes against `deleteServer` and `removeMember` in `server/controllers/serversController.ts` before trusting them, and correct the types if they differ.

Both are destructive, so both go through a confirmation. Reuse whatever confirm affordance the app already has — search for how `deleteDM` or `leaveGroup` confirms — rather than adding a new one:

```bash
grep -n "leaveGroup\|confirmDelete\|showConfirm" src/views/ChatApp.vue | head
```

Both actions need no local cleanup: the server emits `server:deleted` / `server:memberLeft`, and the 3a handlers already call `removeServer` and navigate away.

- [ ] **Step 8: Typecheck and full suite**

```bash
npm run typecheck && npx vitest run
```

Expected: exit 0, then 171 passing (163 + 8).

- [ ] **Step 9: Commit**

```bash
git add src/composables/contextMenus/serverMenu.ts src/composables/contextMenus/__tests__/serverMenu.test.ts src/composables/useApi.ts src/views/ChatApp.vue
git commit -m "feat: server dropdown menu on the sidebar header"
```

---

### Task 2: The invite modal

**Files:**
- Create: `src/components/modals/InviteServerModal.vue`
- Modify: `src/composables/useApi.ts`, `src/views/ChatApp.vue`

**Interfaces:**
- Consumes: `buildServerMenu`'s `invitePeople` handler (Task 1)
- Produces: nothing downstream

- [ ] **Step 1: Add the three invite calls to useApi**

```ts
  const createServerInvite = (sid: string) =>
    post<{ invite: WireInvite }>(`/servers/${sid}/invites`)

  const listServerInvites = (sid: string) =>
    get<{ invites: WireInvite[] }>(`/servers/${sid}/invites`)

  const revokeServerInvite = (sid: string, code: string) =>
    del<{ ok: boolean }>(`/servers/${sid}/invites/${code}`)
```

and the wire type, matching `shapeInvite` at `server/controllers/invitesController.ts:15` exactly:

```ts
/** Exactly `shapeInvite` in server/controllers/invitesController.ts:15. */
export interface WireInvite {
  code:      string
  uses:      number
  expiresAt: string | null
  createdAt: string
  inviter:   { id: string; username: string } | null
}
```

Note the create response is `{ invite: {...} }`, **not** `{ code }` — the group invite call next to it returns the bare shape and they are easy to confuse.

- [ ] **Step 2: Build the modal**

Read `src/components/modals/InviteGroupModal.vue` first — it already does the mint-and-copy flow this mirrors, including the copied-confirmation state. Match its structure and class-naming convention.

Create `src/components/modals/InviteServerModal.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import ModalBase from './ModalBase.vue'
import { useApi } from '@/composables/useApi'
import type { WireInvite } from '@/composables/useApi'

const props = defineProps<{ serverId: string; serverName: string; isOwner: boolean }>()
const emit  = defineEmits<{ close: [] }>()

const { createServerInvite, listServerInvites, revokeServerInvite } = useApi()

const invites = ref<WireInvite[]>([])
const url     = ref('')
const busy    = ref(false)
const error   = ref('')
const copied  = ref(false)

// Server invites use /join/<code>, not /invite/<code>. That path is already
// claimed by GROUP invites (MessageItem.vue matches it and renders a
// GroupInviteCard), and the two codes come from different collections, so one
// shared path would need a lookup-then-fallback with a real collision risk.
const linkFor = (code: string) => `${location.origin}/join/${code}`

const load = async () => {
  if (!props.isOwner) return   // listing invites is owner-only
  try { invites.value = (await listServerInvites(props.serverId)).invites }
  catch (e: any) { error.value = e?.message || 'Could not load invites' }
}

const mint = async () => {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const { invite } = await createServerInvite(props.serverId)
    url.value = linkFor(invite.code)
    invites.value = [invite, ...invites.value]
    await copy()
  } catch (e: any) {
    error.value = e?.message || 'Could not create an invite'
  } finally { busy.value = false }
}

const copy = async () => {
  if (!url.value) return
  await navigator.clipboard.writeText(url.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1600)
}

const revoke = async (code: string) => {
  try {
    await revokeServerInvite(props.serverId, code)
    invites.value = invites.value.filter(i => i.code !== code)
    if (url.value.endsWith(`/${code}`)) url.value = ''
  } catch (e: any) { error.value = e?.message || 'Could not revoke that invite' }
}

onMounted(load)
</script>
```

Write the template and scoped styles to match `InviteGroupModal.vue`: a header with the server name and a close X, a primary "Create Invite Link" button, the minted link in a read-only field with a Copy button that flips to "Copied!", an existing-invites list (code, uses, expiry, a revoke X) shown only to the owner, and an error line. Use only CSS custom properties that exist — check `src/styles/tokens.css`; `--danger` and `--text-muted` do **not** exist, and sibling modals hardcode `#f08080` for error text.

- [ ] **Step 3: Mount it**

In `ChatApp.vue`, alongside the other modals:

```html
      <InviteServerModal v-if="showInvite && activeServer"
        :server-id="activeServer.id"
        :server-name="activeServer.name"
        :is-owner="activeServer.owner === authUser?.id"
        @close="showInvite = false" />
```

- [ ] **Step 4: Typecheck, test, build**

```bash
npm run typecheck && npx vitest run && npx vite build
```

Expected: exit 0 for all three, 171 passing (this task adds no tests — it is a modal over tested endpoints, and its gate is the browser pass in Task 5).

- [ ] **Step 5: Commit**

```bash
git add src/components/modals/InviteServerModal.vue src/composables/useApi.ts src/views/ChatApp.vue
git commit -m "feat: create, copy and revoke server invite links"
```

---

### Task 3: Consuming an invite link

Two entry points, mirroring how group invites already work: a pasted link renders an inline card in the message list, and opening the link directly lands you in the app with a join prompt.

**Files:**
- Create: `src/components/chat/ServerInviteCard.vue`
- Modify: `src/components/chat/MessageItem.vue`, `src/App.vue`

**Interfaces:**
- Consumes: `getServerInvite`, `joinServerInvite` (added below)
- Produces: nothing downstream

- [ ] **Step 1: Add the two calls to useApi**

```ts
  const getServerInvite = (code: string) =>
    get<{ code: string; server: { id: string; name: string; icon: string | null; memberCount: number; isMember: boolean } }>(
      `/invites/${code}`)

  const joinServerInvite = (code: string) =>
    post<{ server: WireServer; channels: WireChannel[]; joined: boolean }>(`/invites/${code}`)
```

Verify both shapes against `previewInvite` (`server/controllers/invitesController.ts`, the `res.json` around line 77) and `joinViaInvite` (around line 193) before relying on them. The join response returns `joined` — `false` means "already a member", which the UI must treat as success, not an error.

- [ ] **Step 2: Build the card**

Read `src/components/chat/GroupInviteCard.vue` first and mirror it — it already handles the preview → join → "you're in" states and the invalid/expired case. Create `src/components/chat/ServerInviteCard.vue` with a `code` prop, the same three states, the server's icon (fall back to `serverIconFor` from `useServers` when `icon` is null), its name, its member count, and a Join button that becomes "Joined" once `joined` or `isMember` is true.

On a successful join, fold the response into state so the rail updates without a refetch:

```ts
const { receiveDetail } = useServers()
// …inside the join handler, after a successful joinServerInvite:
receiveDetail(res.server, res.channels)
```

- [ ] **Step 3: Render it from a message**

In `src/components/chat/MessageItem.vue`, next to the existing `INVITE_RE` at line 84:

```ts
// Server invites use /join/<code>; /invite/<code> above is group invites.
const JOIN_RE = /https?:\/\/[^/\s]+\/join\/([A-Za-z0-9_-]{6,16})\/?/
const joinCode = computed(() => JOIN_RE.exec(props.msg.content)?.[1] ?? null)
```

and render `<ServerInviteCard v-if="joinCode" :code="joinCode" />` wherever `GroupInviteCard` is rendered, following the same conditional structure.

- [ ] **Step 4: Handle a directly-opened link**

`src/App.vue` already matches `/theme/<slug>` at lines 18-29. Add the same treatment for `/join/<code>`: capture the code on mount, `history.replaceState(null, '', '/')` to clean the URL, and hold it in a ref that `ChatApp` reads once authenticated so it can show the same join card.

The ordering matters and the theme handler shows the shape: a link opened while logged out must survive the trip through `AuthPage`, so capture the code **before** the auth check rather than inside the authed branch.

- [ ] **Step 5: Typecheck, test, build**

```bash
npm run typecheck && npx vitest run && npx vite build
```

Expected: exit 0, 171 passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ServerInviteCard.vue src/components/chat/MessageItem.vue src/App.vue src/composables/useApi.ts
git commit -m "feat: join a server from a pasted or opened invite link"
```

---

### Task 4: Create, rename and delete channels

**Files:**
- Create: `src/components/modals/CreateChannelModal.vue`, `src/composables/contextMenus/channelMenu.ts`, `src/composables/contextMenus/__tests__/channelMenu.test.ts`
- Modify: `src/composables/useApi.ts`, `src/views/ChatApp.vue`

**Interfaces:**
- Consumes: `useServers`' `upsertChannel` / `removeChannel` (already exist from 3a)
- Produces: `buildChannelMenu(channel, isOwner, handlers): MenuItem[]`

- [ ] **Step 1: Add the three channel calls to useApi**

```ts
  const createChannelApi = (sid: string, name: string, type: 'text' | 'voice') =>
    post<{ channel: WireChannel }>(`/servers/${sid}/channels`, { name, type })

  const updateChannelApi = (sid: string, cid: string, body: { name?: string }) =>
    patch<{ channel: WireChannel }>(`/servers/${sid}/channels/${cid}`, body)

  const deleteChannelApi = (sid: string, cid: string) =>
    del<{ deleted: boolean }>(`/servers/${sid}/channels/${cid}`)
```

Check each response shape against `channelsController.ts` and correct if they differ.

- [ ] **Step 2: Write the channel-menu test**

Create `src/composables/contextMenus/__tests__/channelMenu.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildChannelMenu } from '../channelMenu'
import { isAction, type MenuItem } from '../../useContextMenu'

const ch = { id: 'c1', name: 'general', type: 'text' as const, serverId: 's1' }
const handlers = () => ({ rename: vi.fn(), remove: vi.fn(), copy: vi.fn() })
const labels = (i: MenuItem[]) => i.filter(isAction).map(x => x.label)

describe('buildChannelMenu', () => {
  it('gives the owner rename and delete', () => {
    const l = labels(buildChannelMenu(ch, true, handlers()))
    expect(l).toEqual(expect.arrayContaining(['Edit Channel', 'Delete Channel']))
  })

  it('gives a non-owner only Copy Channel ID', () => {
    expect(labels(buildChannelMenu(ch, false, handlers()))).toEqual(['Copy Channel ID'])
  })

  it('copies the channel id, not the name', () => {
    const h = handlers()
    buildChannelMenu(ch, true, h).filter(isAction)
      .find(i => i.label === 'Copy Channel ID')!.onClick()
    expect(h.copy).toHaveBeenCalledWith('c1', 'Channel ID')
  })

  it('marks delete destructive', () => {
    const del = buildChannelMenu(ch, true, handlers()).filter(isAction)
      .find(i => i.label === 'Delete Channel')
    expect(del?.danger).toBe(true)
  })
})
```

Run it, watch it fail, then implement `buildChannelMenu` in `src/composables/contextMenus/channelMenu.ts` following `serverMenu.ts`'s shape.

- [ ] **Step 3: Build the create-channel modal**

Create `src/components/modals/CreateChannelModal.vue`, matching `CreateServerModal.vue`'s structure exactly (it is the closest sibling and was itself matched to `NewDMModal`). Props: `serverId`. Emits: `close`, `created(channel)`. Fields: a name input and a text/voice type toggle defaulting to text.

Two behaviours worth getting right:

```ts
// Discord slugifies as you type and users expect it. Spaces become hyphens,
// uppercase folds down. Voice channels keep their name verbatim — the real
// server in the reference screenshots has "| Voice Chat" and "Study Chat".
const display = computed(() =>
  type.value === 'text' ? name.value.trim().toLowerCase().replace(/\s+/g, '-') : name.value.trim())
```

```ts
// Same unmount guard CreateServerModal carries: the POST can outlive the
// modal, and Vue does not invalidate an emit closure on unmount, so a
// cancelled create would still navigate. Fold the channel into state either
// way — it exists on the server — but skip the navigation.
let gone = false
onBeforeUnmount(() => { gone = true })
```

On success call `upsertChannel(channel)` from `useServers` so the sidebar updates immediately rather than waiting for the `channel:created` echo — and note the echo is harmless, since `upsertChannel` updates in place by id.

- [ ] **Step 4: Wire both into ChatApp.vue**

Open the channel menu from a right-click on a `.ch-item` and from the row's hover affordance, matching how conversation rows already do both:

```html
            <button v-for="ch in textChannels" :key="ch.id"
              class="ch-item" :class="{ active: activeChannelId===ch.id, unread: !!unreadChannels[ch.id] }"
              @click="selectChannel(ch)"
              @contextmenu.prevent.stop="openChannelMenu($event, ch)">
```

Restore the `+` affordance on the `TEXT CHANNELS` group label that 3a removed — it now has something to do:

```html
            <div class="ch-group-label">
              <ChevronRight :size="10" :stroke-width="2.25"/><span>Text Channels</span>
              <button v-if="isServerOwner" class="ch-add-btn" v-tip="'Create Channel'"
                @click.stop="showCreateChannel = true"><Plus :size="14" :stroke-width="1.5"/></button>
            </div>
```

with `const isServerOwner = computed(() => !!activeServer.value && activeServer.value.owner === authUser.value?.id)`.

Rename reuses the app's existing single-field edit modal — check whether `EditFieldModal` fits before writing a new one:

```bash
sed -n '1,40p' src/components/modals/EditFieldModal.vue
```

Delete must confirm, and must warn that message history goes with it. **Use `src/components/modals/ConfirmModal.vue`** — Task 1 built it, and `ChatApp.vue` already holds a shared `confirmState` that Leave Server and Delete Server both drive, so a third caller is a one-liner. Do not add a second confirmation mechanism, and do not use `window.confirm` (Task 1's review rejected it: unstyled OS chrome in a themed app).

Deleting the **last text channel** is refused by the server — surface that error rather than swallowing it.

- [ ] **Step 5: Typecheck, test, build**

```bash
npm run typecheck && npx vitest run && npx vite build
```

Expected: exit 0, 175 passing (171 + 4).

- [ ] **Step 6: Commit**

```bash
git add src/components/modals/CreateChannelModal.vue src/composables/contextMenus/channelMenu.ts src/composables/contextMenus/__tests__/channelMenu.test.ts src/composables/useApi.ts src/views/ChatApp.vue
git commit -m "feat: create, rename and delete channels from the sidebar"
```

---

### Task 5: Two-client browser verification

The gate for Tasks 2, 3 and 4, none of which have unit tests. Use the browser pane; do not ask the user to check by hand.

- [ ] **Step 1: Bring the environment up**

MongoDB must be running (Docker Desktop). Then start both servers from `H:/projects/.claude/launch.json`: `skycord-api` (port 8990 — **must match `API_PORT` in `.env`**, or every call 404s through the Vite proxy) and `skycord-dev` (port 8090).

- [ ] **Step 2: Second client**

The in-app browser shares one cookie jar, so a second tab is silently the same user. Either use the Chrome MCP for client B, or drive B over the API with a node socket.io client — `.superpowers/sdd/two-client.mjs` from 3a is a working starting point. Test accounts `slicetest_a` / `slicetest_b` (password `SliceTest!2026`) already exist in the dev database.

- [ ] **Step 3: Walk the flows**

1. Click the sidebar header. Expect the menu, with Delete Server (not Leave) as the owner, and Create Channel present.
2. Invite People → Create Invite Link. Expect a `/join/<code>` URL, auto-copied, and the invite listed below with 0 uses.
3. Paste that URL into a DM. Expect an inline card with the server icon, name and member count — **not** a group invite card, and not a bare link.
4. As B, join via the card. Expect the button to become Joined, and the server to appear in B's rail without a reload.
5. Revoke the invite as the owner, then try it again as a third party. Expect a clear "invite does not exist" state, not a crash.
6. Open `http://localhost:8090/join/<code>` directly while logged out. Expect to land on the login page, and after logging in to see the join card — the code must survive the auth trip.
7. Create a text channel. Expect it in A's sidebar immediately **and** in B's without a reload, with the name slugified.
8. Create a voice channel. Expect it under Voice Channels with its name unslugified.
9. Rename a channel from the context menu. Expect both clients to update.
10. Delete a channel A is currently viewing. Expect A to land on another channel with its history loaded, and B's sidebar to drop the row.
11. Try to delete the last remaining text channel. Expect the server's refusal surfaced as a visible error.
12. As B (non-owner), open the server menu and a channel menu. Expect Leave Server, and no Create/Edit/Delete rows.
13. Check `read_console_messages` for errors and `read_network_requests` for 4xx.

- [ ] **Step 4: Commit any fixes, then screenshot the server view for the report.**

---

## Deploy gate

Unchanged from 3a and still open: `/etc/nginx/sites-available/skycord` line 8 needs `servers` and `invites` in its location alternation, or both paths return 200 with the SPA's `index.html` and every call fails by parsing HTML as JSON. The Vite dev proxy already has both, which is exactly why this passes locally and fails in production. **`/join/<code>` must also fall through to the SPA index**, like `/theme/<slug>` already does.

## Carried forward

- **Categories (plan 3c)** — needs `server/models/Channel.ts` to gain a parent, a migration, CRUD endpoints and socket events before any UI.
- **Group reactions are unverified.** Un-gating `handleReact` in 3a fixed channels and incidentally fixed groups, which had the same local-only bug. No test covers a group reaction. Verify early here or add a server test.
- `server:memberJoined` / `memberLeft` handlers are no-ops: those payloads carry `{serverId, member}` and `{serverId, userId}`, no `memberCount`.
- Rail badge `srv.unread` is never written — no server-level unread aggregation.
- `selectChannel` omits `mobileNav.openConversation()`; latent only because `.shell.mobile .rail` is `display:none`.
- Rail double-click race: two fast clicks on two uncached servers can leave `activeChannelId` from server A while `activeServerId` is B.
- Presence events have no ordering guarantee — a rapid disconnect/reconnect can deliver `offline` after `online`. Needs a client-side sequence check.
