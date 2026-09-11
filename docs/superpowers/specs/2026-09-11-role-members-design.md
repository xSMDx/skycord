# Role members — design

**Status:** approved in session 2026-09-11 (inline picker chosen over a separate modal).

## Problem

The Roles page has had a Members tab since v0.17.0, showing a placeholder that said
assignment "needs a member list and a per-member role model, neither of which exists
on the server". Both have existed since v0.17.0 — `memberRoles` on Server, and
`PUT /servers/:sid/members/:uid/roles`. What was missing was any way for a client to
SEE assignments: the member list carried no role ids, the role list showed `—` for a
count, and the server's `member:roles` event was emitted on every change and listened
to by nothing.

## Design

- **Data.** `GET /servers/:sid/members` gains `roles: string[]` per member, built in the
  same loop that already computes each member's rank. Only ids whose role still exists
  are sent. No new endpoint; the member list stays the one source.
- **Rank travels with roles.** `member:roles` and the `setMemberRoles` response both
  carry `highestPosition`. Clients gate moderation rows on rank, and a role change is
  exactly what moves it.
- **Live.** The client handles `member:roles`, writing roles and rank together through
  one store mutator (`applyMemberRoles`).
- **The tab.** Holders listed with avatar, name, username and a remove button. A search
  box filters them. **Add members** opens an inline picker — the same pattern as the
  Private-channel access list — listing members who do not hold the role and whom the
  viewer may edit. Writes are optimistic and roll back on refusal, with a toast.
- **@everyone** shows a sentence, not a list: every member holds it and it cannot be
  given or taken.
- **Gating mirrors `setMemberRoles`.** No Add button unless the viewer may manage the
  role (`canManageRoleUI`, a parity-tested mirror of `canManageRole`). No remove button,
  and no picker entry, for a member the viewer may not edit: owner may edit anyone
  including themselves; anyone else needs Manage Roles, must outrank the member, and
  never reaches the owner. That is `isOwner || canActOnMemberUI(me, m, 'ManageRoles')`,
  reusing the already parity-tested mirror.
- **Counts.** The role list and the Members tab show real holder counts, replacing `—`
  and `TBD`.

## Known limit

`setMemberRoles` takes a member's full role list, so two moderators editing the same
member at the same instant could overwrite each other. The client computes each write
from the member's live roles, which the socket keeps current, so the window is one
round trip. Not addressed here: it is the existing contract.

## Testing

Server: roles in the payload, @everyone never listed, deleted-role ids filtered, visible
to ordinary members, rank in the response and in the socket event. Client: parity for
`canManageRoleUI`, store tests for `applyMemberRoles` and the absent-field reading.
