# Channel permissions

Roles are decoration until a channel can be locked to one. This is the chain
that makes "a voice channel only staff can join" real, and it is the gate on
shipping the Roles page at all.

## What exists today

| Piece | State |
|---|---|
| Role model | none |
| Member → roles | none. `Server.members` is a flat `ObjectId[]`, touched in **54 places across 6 files** |
| Per-channel overwrites | none — `Channel.ts` says so in a comment |
| Resolution | none |
| Enforcement | owner-only, **21** `requireOwner` call sites |
| Channel Permissions UI | a `ready: false` tab already stubbed in `EditChannelModal` |

## Decisions

1. **Member→role storage: a side-car.** `Server.members` stays exactly as it is;
   a parallel `memberRoles` map carries the assignment. Zero migration, none of
   the 54 sites change, and the feature can land incrementally. The cost is
   accepted knowingly: join and leave must write both, so those two paths get a
   test proving they stay in step.
2. **Slice 1 surfaces three permissions; storage carries all of them.**
   The UI shows View channel, Send messages and Connect — exactly what "locked
   channel" means. Overwrites store the full allow/deny bitfields regardless, so
   widening to the full set later is deleting a filter, not a migration.
3. **Denied channels: hidden or visible-locked, per channel.** Both, chosen in
   that channel's settings. Default hidden, matching Discord and leaking less.
4. **Categories live-inherit.** The category is a real layer in resolution
   rather than Discord's copy-and-sync. A channel with no overwrites of its own
   follows its category always, with nothing to keep in step and no fan-out
   write that can half-fail.

## Data model

```
Role                          (new collection, server-scoped)
  server, name, color, position, permissions: string  // decimal bigint
  hoist, mentionable

Server
  members: ObjectId[]                    // UNCHANGED
  memberRoles: [{ user, roles: [RoleId] }]   // new side-car

Overwrite                     (embedded, on Category and Channel alike)
  id: ObjectId                // role id, or user id
  type: 'role' | 'member'
  allow: string               // decimal bigint
  deny:  string

Category.overwrites: Overwrite[]
Channel.overwrites:  Overwrite[]
Channel.hideWhenDenied: boolean = true
```

`permissions`, `allow` and `deny` are decimal strings because BSON has no
BigInt — the same reason `server/permissions.ts` already serialises that way.

## Resolution

Two layers, each a full Discord-shaped pass, applied outermost first. Later
layers win.

```
resolveChannel(member, server, category, channel) -> bigint

  if member is the server owner        -> ALL_PERMISSIONS
  base = @everyone.permissions | (each of the member's roles)
  if base has Administrator            -> ALL_PERMISSIONS

  perms = base
  for layer in [category, channel]:        // skip nulls
      ow = layer.overwrites

      e = ow where id == @everyoneRoleId
      if e: perms = (perms & ~e.deny) | e.allow

      allow = 0n; deny = 0n                // ACCUMULATED, not sequential
      for o in ow where type=='role' and member holds o.id and o.id != everyone:
          allow |= o.allow;  deny |= o.deny
      perms = (perms & ~deny) | allow

      m = ow where type=='member' and id == member.user
      if m: perms = (perms & ~m.deny) | m.allow

  return perms
```

Two properties worth stating because both are commonly got wrong:

- **Role overwrites accumulate.** All denies are OR'd, all allows are OR'd, then
  applied once. Role *position* therefore has no effect on channel permissions
  — position governs only who may edit what.
- **Deny before allow, within every layer.** An allow at the same layer beats a
  deny at that layer; a deny at a later layer beats an allow at an earlier one.

## Enforcement

Server-side, always. A channel the viewer may not see must never reach the
client — filtering in the sidebar is a cosmetic lie.

| Point | Check |
|---|---|
| Channel list / server detail | drop channels without `ViewChannels`, unless `hideWhenDenied` is false, in which case send a locked stub with no content |
| Open a channel, fetch messages | `ViewChannels` or 404 — not 403, which confirms it exists |
| Send a message | `SendMessages` |
| Join voice | `Connect` |
| The 21 `requireOwner` sites | replaced with the permission each one actually means |

## UI (from the reference screenshots)

The screenshots settle the shape, and the important part is what is NOT on
screen by default: **Advanced permissions is collapsed**. Almost nobody opens
it. The primary interface is one toggle and a list.

### Channel settings -> Permissions

1. **Private Channel** toggle, in a card with a lock icon.
   > By making a channel private, only select members and roles will be able to
   > view this channel.

   Switching it on writes a single overwrite: @everyone denied `ViewChannels`
   — and for a voice channel, `Connect` as well. The reference says this
   outright in its own copy, and a voice channel that is invisible but joinable
   is a real hole.

2. **Who can access this channel?** appears once private, with an
   *Add members or roles* button and two lists, **Roles** and **Members**.
   Adding one writes an allow overwrite for `ViewChannels` (+ `Connect`).
   The owner is listed and cannot be removed.

3. **Advanced permissions**, collapsed. A roles/members column on the left,
   and for the selected entry a three-state control per permission:
   ✗ deny / ∕ neutral / ✓ allow, neutral being the default. This is where the
   full set eventually lands (slice 5).

### Category settings -> Permissions

Same layout, titled *Category Settings*, with **Private Category**:
> Linked channels in this category will automatically match to this setting.

Under live inheritance that sentence is simply true, with nothing to keep in
step.

### The sync banner

The reference shows *"Permissions synced with category: Voice Channels"* at the
top of a channel that has not diverged. We keep the banner and drop the
mechanism: it renders when the channel has no overwrites of its own, and the
action beside it is **Reset to category** (delete this channel's overwrites)
rather than Discord's *Sync Now* (copy the category's down). Same signal, no
fan-out.

### Roles page

Already built. Stays behind this work — an unshipped Roles page is honest, a
shipped one that cannot lock anything is not.

## Slices

1. Role model + `memberRoles` side-car + assignment in the Members page
2. Overwrites on Category and Channel + `resolveChannel` + its tests
3. Enforcement at the five points above
4. The two Permissions tabs — Private toggle + access list FIRST, Advanced collapsed behind it
5. Widen the UI to the full permission set

## Open

Nothing blocking. Screenshots received and folded in above.

Sources for Discord's behaviour:
- https://docs.discord.com/developers/topics/permissions
- https://support.discord.com/hc/en-us/articles/206029707-Setting-Up-Permissions-FAQ
