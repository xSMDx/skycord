# Group DM Rework — Design Spec

**Date:** 2026-06-23
**Status:** Approved, implementing

## Problem

Groups were built channel-style: a separate "Group DMs" sidebar section and a
distinct `view==='group'` that felt like a server channel. Wrong model.

A group DM is **a normal direct-message chat with more than two people in it**.
It must live in the same Direct Messages list as 1:1 DMs, open like a DM, and
carry the extra affordances Discord gives groups: a member panel, group rename +
avatar, and an invite flow.

Target = three reference screenshots (Discord group DM, Edit Group modal, Invite
to Group DM modal).

## Design

### Sidebar — unified conversation list
- Remove the separate "Group DMs" section.
- Merge DMs + groups into one list under "Direct Messages", sorted by most
  recent activity (`lastMessageAt`, falling back to DM ordering).
- Group row: group avatar (uploaded image, else default people-icon circle) +
  derived name (`name` or member display names joined) + subtitle `"N Members"`.
- 1:1 DM row: unchanged.

### Group chat — normal chat + member panel
- Group opens via the same message list / input components as a DM.
- Header: group avatar + name + pencil (→ Edit Group) + existing call/video/pin/
  add-people/members icons.
- Right-side member panel (reuses server member-panel styling): "Members—N",
  each member with avatar + status, and an "Invite to Group DM" button pinned
  at the bottom.

### Edit Group modal (`EditGroupModal.vue`, new)
- Avatar with pencil overlay (base64 upload, same path as user/sticker avatars).
- Group name text input.
- Cancel / Save. Save → `PATCH /conversations/groups/:id { name, avatar }`.

### Invite to Group DM modal (`InviteGroupModal.vue`, new)
- Header: "You can add N more people" (N = `MAX_GROUP_MEMBERS - memberCount`).
- Search + friend checkboxes + Add button → `addGroupMembers`.
- "Or, send an invite link" + link field + Copy + "expires in 24 hours" →
  `createGroupInvite`.

## Backend changes
- `Conversation` model: add `avatar: string | null` (default null).
- `conversationsController.updateGroup`: membership-checked PATCH of `name`
  and/or `avatar`; emits `group:updated` to all members; returns shaped group.
  `shapeGroup` includes `avatar`.
- `routes/conversations.ts`: `PATCH /groups/:groupId → updateGroup`.

## Frontend changes
- `types/index.ts`: `Group.avatar?: string | null`.
- `useApi.ts`: `updateGroup(groupId, { name?, avatar? })`.
- `ChatApp.vue`: unified list computed, group-as-chat rendering, member panel,
  header pencil, wire both modals.
- New: `EditGroupModal.vue`, `InviteGroupModal.vue`.
- `NewDMModal.vue`: unchanged (remains the create-group entry point).

## Out of scope
- Group avatar CDN/file storage (base64 in Mongo, consistent with existing
  avatar handling).
- Per-member roles/permissions inside a group (groups are flat; owner only
  matters for ownership handoff on leave, already implemented).

## Verification
1. Group appears inline in the DM list, sorted by recency, with member count.
2. Clicking a group opens a normal chat with the member panel visible.
3. Pencil → Edit Group → rename + change avatar → reflected in list/header/panel
   for all members in real time.
4. Invite modal: add a friend via checkbox (appears for them live); copy invite
   link; link pasted in any chat renders the join card.
5. Edit/delete/pin/react in a group broadcast to all members.
