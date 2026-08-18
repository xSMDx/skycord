# Servers, channels and voice channels — design

Date: 2026-08-17
Status: approved, ready for planning
Milestone: Channels (roadmap item 5)

## What this delivers

Servers containing text and voice channels. Create a server, share an invite
link, talk in `#general`, hop into a voice channel and see who is already in it.

## What this deliberately does NOT deliver

Named so the plan cannot quietly absorb them:

- **Roles and permissions.** Next cycle. Until then there is exactly one rule:
  a server member may read and write every channel in it. The owner alone may
  create, rename and delete channels, and delete the server.
- **Search with tags across a server.** Already a separate backlog item, and it
  needs this shape settled first.
- **Categories.** Channels carry a `position`, so a Category model is additive
  later. Confirmed against the reference: a *new* server shows only the two
  fixed groupings, and that is this cycle's target.
- **Text inside voice channels.** A voice channel is one thing.
- Bots, events, server boosts, discovery, ownership transfer.

## Decisions and why

| Decision | Chosen | Why not the alternative |
|---|---|---|
| Servers vs group DMs | Separate models | Groups keep working untouched. Unifying them is a live-data migration across every DM and group path. |
| Channel storage | Own collection | `Message.kind` already includes `channel` and `conversationId` is documented as "dmId or channelId". Embedding makes message keying and later per-channel permissions awkward. |
| Joining | Invite links, expiry 24h / 7d / never | A group's fixed 24h TTL is wrong for a server you want people to keep joining. |
| Organisation | Flat, grouped Text then Voice | Matches a newly created server exactly; categories only start paying off past roughly a dozen channels. |
| Presence | Friends **plus** anyone sharing a server | A member list without live status is most of the point of a member list. Widens the audience only to rooms the user chose to join; Invisible remains a full opt-out. |
| Size | 100 members | Member list in one request, presence fans out directly, no pagination. Raise the constant when real usage says so. |
| Voice join on touch | Bottom sheet with a Join Voice button | On a phone a mis-tap would open a live mic in a room. Desktop keeps instant join. |

## Data model

### Server

`name`, `icon`, `iconCrop`, `owner`, `members[]`, `createdAt`.
`MAX_SERVER_MEMBERS = 100`, declared beside the model as `MAX_GROUP_MEMBERS`
already is in `Conversation.ts`.

`iconCrop` is included from the start. Group icons still cannot be cropped
because `Conversation` has no crop field; this is the moment where adding it
costs nothing, and it reuses `cropLayout()` and the `Avatar` component.

### Channel

`server`, `name`, `type` of `text` or `voice`, `position`.
Index `{ server: 1, position: 1 }`. No members array — membership is the
server's job.

Names are free unicode up to 100 characters. The reference servers use names
like `general-chat` and `listen-to-this` prefixed with emoji, so there is no
slug validation, no lowercasing and no hyphenating.

Creating a server seeds `#general` (text) and `General` (voice), so a new
server is never an empty screen.

`position` is assigned on creation by appending to the end of its type group.
**There is no reorder UI this cycle** — the field exists so ordering is stable
and so categories and drag-to-reorder are additive later, not so it can be
changed now.

### ServerInvite

`code`, `server`, `createdBy`, `expiresAt` which is a Date or null.

Separate from `GroupInvite` rather than generalising it: "never expires" needs
a nullable `expiresAt`, and Mongo's TTL index skips documents whose field is
not a date, so "never" needs no special-casing. `generateInviteCode()` and
`inviteExpiry()` move from `GroupInvite.ts` into `utils/inviteCode.ts`, which
both models import. That is the only refactor of existing code.

### Message — unchanged

A channel message is `conversationId = channel._id.toString()` with
`kind: 'channel'`. `resolveMessages()` is called as-is, so channel messages get
live author avatars, `authorAvatarCrop`, replies, reactions, pins and edits
from day one.

## Authorisation

One helper, called by every channel route: **you may read or write a channel if
you are a member of its server.** No per-channel rules this cycle.

Owner-only: create, rename and delete a channel; rename the server; change its
icon; delete the server; create and revoke invites; remove a member.

## Server and socket

Routes mirror the existing group shape:

    POST   /servers                             create
    GET    /servers                             my servers
    GET    /servers/:sid                        server plus channels
    PATCH  /servers/:sid                        rename or icon       (owner)
    DELETE /servers/:sid                                             (owner)
    GET    /servers/:sid/members
    DELETE /servers/:sid/members/:uid           kick, or leave if self
    POST   /servers/:sid/channels                                    (owner)
    PATCH  /servers/:sid/channels/:cid          rename               (owner)
    DELETE /servers/:sid/channels/:cid                               (owner)
    GET    /servers/:sid/channels/:cid/messages
    POST   /servers/:sid/channels/:cid/messages
    POST   /servers/:sid/invites                                     (owner)
    GET    /servers/:sid/invites                                     (owner)
    DELETE /servers/:sid/invites/:code          revoke               (owner)
    POST   /invites/:code                       join

**Adding these prefixes requires three edits, not one** — `server/app.ts`, the
`vite.config.ts` proxy list, and the prod nginx alternation. Missing either of
the last two fails silently: the request falls through to the SPA and returns
200 with `index.html`, so `res.json()` throws into a swallowed catch and the
feature renders empty.

**Socket rooms are per channel**, named `chan:<id>`, joined on connect for
every channel of every server the user belongs to. Per-server rooms would be
less code but would deliver messages for channels a user cannot see —
irrelevant now, wrong the moment roles land.

Events follow existing naming: `channel:receive`, `channel:created`,
`channel:updated`, `channel:deleted`, `server:updated`, `server:memberJoined`,
`server:memberLeft`.

**Presence fan-out** extends `myFriendIds` to also include the deduplicated
union of members of the user's servers. `effectiveStatus()` remains the only
thing serialised — never the raw `status` column.

That union is built at connect and **recomputed when the user joins or leaves a
server, and when someone joins or leaves a server they are in**. Building it
once at connect would mean a member who joined after you connected never sees
you go idle.

## Voice channels

A voice channel is a LiveKit room named `channel:<id>`, alongside the existing
`dm:` and `group:` rooms. `activeCalls` in `chatSocket.ts` already maps room to
participants and broadcasts `call:state`, which is what lets the sidebar list
who is sitting in each channel.

Differences from a DM call, all deliberate:

- **No ringing.** A room you walk into is not a call you place.
- **It persists** with nobody in it.
- **You stay connected while browsing** other channels — `CallBar` already
  survives conversation switches, from the P2-C work.

Mute, deafen, camera, screen share, the connection panel and the debug export
are unchanged.

## Client surface

`ChatApp.vue` is 3,075 lines and currently owns the rail, sidebar, member panel
and all navigation state. Servers do not go into it.

- **`useServers.ts`** — servers, channels, active selection, fetching.
- **`ServerRail.vue`** — replaces the inline rail and deletes the four
  hardcoded DiceBear servers at `ChatApp.vue:519`.
- **`ChannelSidebar.vue`** — server header and chevron menu, the Text Channels
  and Voice Channels groupings, the add buttons, and live participants under
  each voice channel.

`ChatApp` keeps composition and routing and gets smaller.

**Member list** reuses the existing `.mp-*` panel with grouping added:
`Online — n` then `Offline — n`, offline listed and dimmed.

**Empty channel**: a large hash mark, "Welcome to *name*", "This is the
beginning of this server."

**Create and invite modals** follow `EditGroupModal` and `InviteGroupModal`,
the invite modal gaining the 24h / 7d / never choice.

### Phone

Taken from the six reference screenshots:

- The rail is a **narrow vertical strip of about 52px beside the channel
  list** — not horizontal, not a swipe-out.
- Opening a channel **hides the rail** and goes full width with a back chevron
  carrying the unread count. This is the existing off-canvas pattern, unchanged.
- The channel header shows the channel name with a chevron and `n Online`.
- **Tapping a voice channel raises a `BottomSheet`**, not an instant join: the
  channel name, "No one's here yet! When you are ready to talk, just hop in.",
  and a green **Join Voice** button. Desktop keeps instant join.
- In voice, the existing call surface is used: participant tiles and the
  control bar.

Touch targets follow the rule established on the landing page — a 44px minimum
under `(pointer: coarse)` only, leaving desktop density alone.

## Unread

The reference screenshots show unread badges on rail icons and on the phone's
back chevron, so this cannot be left unsaid.

Channels reuse the pattern DMs and groups already use, which is entirely
client-side: increment `channel.unread` when `channel:receive` arrives for a
channel that is not the active one, clear it when the channel is opened. A
server's rail badge is the sum of its channels.

**This is session-scoped and resets on reload**, exactly as DM and group unread
already does — there is no server-side read state anywhere in the app today.
Persisting it means a per-user, per-channel `lastReadAt`, which is its own
piece of work and is **not in this cycle**. Matching the existing behaviour is
the point: one inconsistent unread model would be worse than a simple one.

## Failure modes

| Case | Behaviour |
|---|---|
| Channel deleted while reading it | `channel:deleted`, fall back to the server's first text channel, toast |
| Deleting the last text channel | Refused. A server always has one. |
| Channel deleted while in its voice room | Participants disconnected, room torn down via the existing leave path |
| Server deleted, or you are removed | Drop to DM home, rail entry disappears, channel rooms left |
| Invite expired, revoked, or server full | Three distinct messages, never one generic failure |
| Joining a server you are already in | Navigates there, does not error |
| Owner tries to leave | Refused. Ownership transfer is a roles-cycle concern. |

## Verification

Two clients on separate storage origins (`localhost` and `127.0.0.1`), as used
for the presence work:

1. A member posts in a text channel; the other receives it without refreshing.
2. Both join a voice channel; each appears in the other's sidebar participant
   list, and audio flows.
3. Presence across a server boundary between two people who are **not
   friends** — online, idle, offline. This is the rule this cycle changes.
4. Invite expiry: a 24h link, a never link, an expired link, a revoked link.
5. The 100-member cap rejects the 101st join with the right message.
6. Phone at 375px: rail beside the channel list, chat off-canvas, the voice
   sheet raises with Join Voice, and no horizontal overflow.

`npm run typecheck` — never bare `tsc`, which cannot parse `.vue` and once let
a fatal render crash through both it and the vite build.
