# Server Settings — what already exists, and what does not

Read-only survey done 2026-08-23, before planning the screen. The point of writing it down is
that the backend turns out to be *mostly already there*, and a plan written without checking
would have re-specified endpoints that ship today.

## The headline

There is no Server Settings screen, but there is a Server Settings **API** — most of one, anyway.
`updateServer` already accepts every field an Overview tab would edit, and the invite-management
endpoints are routed and working with no client caller at all.

## What exists server-side

`server/models/Server.ts` already carries the editable fields:

| Field | Notes |
|---|---|
| `name` | required, max 100, free unicode (emoji names are deliberate) |
| `icon` | base64 string or null, capped at 1.5 MB by the controller |
| `iconCrop` | `{ zoom, x, y }` — the same crop shape as user avatars |
| `bannerColor` | strict `#rrggbb`, lowercased, or null |
| `description` | max 300 |

`PATCH /servers/:sid` (`updateServer`, serversController.ts:143) is owner-gated via `requireOwner`,
validates each field, saves, emits `server:updated` to every member, and returns the shaped server.
**Every Overview-tab field is already writable.**

Also routed and working:

| Endpoint | Controller | Returns |
|---|---|---|
| `GET /servers/:sid/invites` | `listInvites` | `{ invites: [...] }`, each with its creator |
| `DELETE /servers/:sid/invites/:code` | `revokeInvite` | `{ ok: true }` |
| `GET /servers/:sid/members` | `getServerMembers` | id, names, avatar, avatarCrop, effectiveStatus, isOwner |
| `DELETE /servers/:sid/members/:uid` | `removeMember` | `{ ok: true }` — kick (owner) *and* leave (self) |
| `DELETE /servers/:sid` | `deleteServer` | `{ ok: true }` |

`removeMember` is worth knowing in detail: it is one endpoint doing two jobs. `isSelf` skips the
owner check, so the same route is "kick" for an owner and "leave" for a member. The owner cannot
leave their own server (400). It uses an atomic `$pull` with `members: target` folded into the
*filter*, so a non-member is a genuine no-op and `modifiedCount` stays trustworthy — deliberate,
because `timestamps: true` would otherwise bump `updatedAt` and make every call look like a hit.

## What does not exist

- **Ownership transfer.** No endpoint, no field write. The owner cannot hand the server over, and
  cannot leave — so today a server outlives its owner's interest in it permanently.
- **Reordering channels and categories.** `position` is assigned on create and never updated.
  There is no reorder endpoint, and no list-reordering primitive anywhere in `src/` (the only drag
  code is image cropping and bottom-sheet dragging).
- **Roles and per-channel permissions.** Deferred by the user; the member list groups by presence,
  not by role, until a role system exists.
- **Bans.** Only kick exists. A kicked member can rejoin with any live invite.
- **Client wrappers.** `useApi.ts` has `deleteServerApi` and `leaveServerApi` but **no**
  `updateServer`, `listInvites` or `revokeInvite`. Three working endpoints with no caller.
- **Invite expiry choice.** The server accepts `24h`/`7d`/`never` and the modal *displays* expiry,
  but the client never sends a choice, so every invite silently gets 24h. This is a settings-shaped
  bug and probably belongs in this work.

## Consequences for planning

1. The Overview tab is mostly client work — the API is done. Don't re-plan it.
2. The Invites tab is entirely client work plus two `useApi` wrappers.
3. The Members tab reuses `getServerMembers`, which 3f already wired into `membersByServer`.
4. Ownership transfer, reorder and bans are **new backend**, and each wants its own decision:
   transfer needs a confirmation flow, reorder needs a `position` write path plus a drag primitive,
   bans need a new collection. These are the parts that make this more than a screen.
5. Icon upload should reuse `useCrop` and the `Avatar` wrapper. Note the two render lessons:
   `object-fit: cover` crops to the element box first, and `border-radius` does not clip a scaled
   element — a bare `<img>` will spill.

Open question for the user when this is picked up: **is ownership transfer in scope?** It is the
one gap with no workaround at all, but it is also the one that needs the most care.
