# Context Menus — Home Page & Conversations (P3-A)

Design doc, 2026-07-19. Branch `video-screenshare`.

## Problem

Skycord has six `@contextmenu` handlers in the whole client. Right-clicking a
person, a conversation, or anything in the sidebar does nothing. The user wants
"most things" to have a menu, built page by page, starting with Home/Friends.

Two structural problems block that:

1. **No shared primitive.** Each menu today is a self-contained component with
   its own backdrop, positioning and dismissal. That already produced two
   implementations (`chat/ContextMenu.vue` and an inline copy inside
   `ReplyTreeModal.vue`), and its positioning is hardcoded to one menu's size
   (`window.innerWidth - 230`), so any differently-sized menu mispositions.
2. **The obvious menu items have no backend.** Remove Friend, decline request,
   pin and mute do not exist server-side. The friend-request decline button
   already fakes it — it filters the row out of local state and the request
   returns on refresh.

## Goals

- A registry-driven context-menu primitive that makes a new menu ~1 line per
  surface.
- Working menus on the Home page: friend rows, pending requests, Active Now,
  members panels.
- Working menus on sidebar conversations (DM and group), replacing the
  click-only `⋯` menu.
- The backend those menus need: decline request, remove friend, pin, mute.

## Non-goals

- **Block / Ignore.** `Friendship.status` has `'blocked'` in its enum but nothing
  writes or reads it. A real block touches every surface that lists people
  (search, friends, DMs, calls) and needs its own design.
- **Notes, per-friend nicknames.** New per-relationship data, deferred.
- **The server-icon menu.** `ChatApp.vue:403` and `:409` are hardcoded arrays of
  four fake servers and their channels. No `Server` model, no routes. Every item
  on that menu acts on data that doesn't exist. Belongs with the channels
  milestone.
- **Migrating the message menu** (`chat/ContextMenu.vue`) and the ReplyTreeModal
  duplicate onto the new primitive. Chat-view work; follow-up.
- **`Mark as Unread`** in the message menu is dead (emits `close` only). Noted,
  not fixed here.

## Architecture — the primitive

Built and verified ahead of this spec (commit `95cbf58`).

```
useContextMenu.ts   module-scoped reactive state + openMenu/closeMenu
ui/ContextMenu.vue  the single surface, mounted ONCE at the app root
contextMenus/*.ts   one file per menu, each a function returning MenuItem[]
```

A target wires up with one line:

```vue
<div class="f-row" @contextmenu="openUserMenu($event, f)">
```

A menu is data, not markup:

```ts
export const userMenu = (u: MenuUser, h: Handlers, ctx: Ctx = {}): MenuItem[] => [...]
```

`MenuItem` is `MenuAction { label, icon?, danger?, disabled?, check?, onSelect }`
or `MenuSeparator { sep: true }`.

The shell owns positioning with viewport clamping, backdrop and click-away,
Escape, arrow-key navigation (skipping separators and disabled rows), Enter to
select, and focus return. Every menu inherits all of it.

**Escape hatch:** a `header` slot, for menus that aren't a list of rows. The one
real case is the message menu's quick-reaction emoji strip. Recurring non-row
controls (the call menu's User Volume slider) get their own item `type` instead
of a slot.

**Measurement note:** clamping uses `offsetWidth`/`offsetHeight`, not
`getBoundingClientRect`. The menu opens at `scale(.94)`; a rect measured during
that animation reports it smaller than it is, so the clamp under-corrects and the
menu overhangs the viewport edge. Verified by probing all four corners.

## Data model

DMs have **no `Conversation` document** — only groups do (`type: 'group'`). A
DM's `conversationId` is synthesised from the two user ids by `dmConvId`. So
there is no row to attach pin/mute to, and both are per-user regardless.

Per-user preferences live on `User`, keyed by conversation id string, which is
uniform across a group's ObjectId and a DM's synthetic id:

```ts
// server/models/User.ts
convPrefs: {
  type: Map,
  of: new Schema({ pinned: Boolean, mutedUntil: Date }, { _id: false }),
  default: () => new Map(),
}
```

Mute state, with **lazy expiry — no cron job**:

| Stored | Meaning |
|---|---|
| `mutedUntil` field absent | not muted |
| `mutedUntil: null` | muted indefinitely |
| `mutedUntil:` future date | muted until then |
| `mutedUntil:` past date | expired; treated as unmuted on read |

Expiry is evaluated when prefs are read, so a lapsed mute needs no sweeper and no
write. The map is also where notes and nicknames go later, without a migration.

**Unmuting must not collide with mute-forever.** Both are "no end date", so the
request body distinguishes them explicitly rather than overloading `null`:

| Request `mute` value | Effect |
|---|---|
| `"forever"` | store `mutedUntil: null` |
| ISO timestamp | store `mutedUntil: <date>` |
| `null` | `$unset` the field — unmuted |

Storing `null` to mean *forever* while also accepting `null` to mean *unmute*
would make the two indistinguishable on the wire, so the API field is named
`mute` and is separate in shape from the stored `mutedUntil`.

## API

```
PATCH  /users/me/conversations/:convId    { pinned?, mute? }  → updated prefs
DELETE /users/friends/:userId             remove friend
PATCH  /users/friends/decline/:requestId  decline a pending request
```

Pin and mute are the same write to the same map, so they are one route, not two.
`decline` mirrors the existing `accept` route and fixes the fake decline button.

`convPrefs` ships with the existing user payload and with
`getMyConversations`, so the sidebar can sort and badge without an extra
round-trip.

Authorisation: `remove friend` and `decline` must verify the caller is a party to
the friendship. `convPrefs` writes are on `me` only, so the caller is implicit —
but `:convId` must not be trusted for anything except being a map key.

## Menus

**userMenu** — friend rows, pending requests, Active Now, members panels, and
later message avatars and call tiles. Already built; gains Remove Friend.

| Item | Notes |
|---|---|
| Profile | |
| Message | disabled when already in that DM |
| Call | opens the DM, then `toggleCall` |
| Copy User ID | |
| Remove Friend | danger. Only when the relationship is `accepted` — the caller passes it in `ctx`, since this menu also opens on pending-request rows and on group members who may not be friends |

**dmMenu** — sidebar DM row.

| Item | Notes |
|---|---|
| Mark As Read | clears `unread` (client state) |
| Pin / Unpin Conversation | |
| Mute ▸ | 15 min · 1 hour · 8 hours · 24 hours · Until I turn it back on |
| Profile · Start a Call | |
| Close DM | existing `hideConv` |
| Copy User ID · Copy Channel ID | Channel ID for a DM is its synthetic `dmConvId`, the same string used as the `convPrefs` key |
| Remove Friend | danger |

**groupMenu** — sidebar group row.

| Item | Notes |
|---|---|
| Mark As Read | |
| Pin / Unpin Conversation | |
| Mute ▸ | same durations |
| Invites | existing `createGroupInvite` |
| Edit Group | existing EditGroupModal |
| Leave Group | danger; existing route |
| Copy Channel ID | |

Mute needs a **submenu** (durations). That is new to the primitive: `MenuItem`
gains an optional `submenu: MenuItem[]`, rendered as a flyout on hover/→ with
the same clamping. This is the only structural addition the primitive needs.

The existing `convMenu` in `ChatApp.vue` (the `⋯` button) is **deleted**; the
button opens `dmMenu`/`groupMenu` instead, so click and right-click agree.

## Client behaviour

- **Pin:** pinned conversations sort above unpinned in the sidebar; existing
  recency order holds within each group.
- **Mute:** suppresses the incoming-message notification sound, and renders the
  unread badge at reduced opacity while keeping its count. It does not hide the
  conversation, and it does not suppress call ringing — an incoming call still
  rings a muted DM.
- Both read from `convPrefs` with expiry applied, via a
  `useConvPrefs` composable so sorting, badging and the menus share one source of
  truth.

## Verification

Automated, by me:

- Primitive behaviour in-browser: keyboard nav skips disabled rows and
  separators, wraps, Enter fires and closes, Escape closes, clamping holds at all
  four viewport corners. (Done for the base menu; must be redone for submenus.)
- API: each new route exercised against a running server — decline actually
  removes the request, remove-friend actually deletes the friendship, prefs
  round-trip, an expired `mutedUntil` reads back as unmuted.
- Build and typecheck clean.

User-driven, because the preview pane has no logged-in session:

- The menus render and the highlight is visible. **The preview tab defers style
  recalculation for post-render class changes, so I cannot verify the hover /
  keyboard highlight myself** — proven by adding a known-good class post-render
  and watching it fail to compute. This must be eyeballed in a real browser.
- Pin reorders the sidebar; mute silences the sound and dims the badge; a muted
  conversation un-mutes itself after its window passes.
