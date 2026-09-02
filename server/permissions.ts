/**
 * Role permissions.
 *
 * Skycord has been owner-vs-member since it existed: 20 call sites across five
 * controllers ask `requireOwner` and there is nothing between "can do
 * everything" and "can do nothing". This is the model those checks become.
 *
 * Shaped after Discord's because everyone arriving already knows it — the same
 * reason the three-column layout is a binding commitment. Same names, same
 * grouping, same bitfield semantics.
 *
 * ── Why BigInt ───────────────────────────────────────────────────────────
 * There are 31 flags today. JavaScript's bitwise operators coerce to 32-bit
 * SIGNED integers, so bit 31 is the sign bit and `1 << 31` is negative — the
 * 32nd permission anyone adds would silently corrupt every stored value. Using
 * BigInt from the start costs nothing and removes the cliff entirely. It is
 * also what Discord does, and why its API sends permissions as strings.
 *
 * ── Why stored as a string ───────────────────────────────────────────────
 * BSON has no BigInt. A decimal string round-trips exactly at any width, sorts
 * nowhere useful (which is fine — nothing sorts by permissions), and is what
 * the client already has to handle since JSON has no BigInt either.
 */

/** Every permission, by group. The order here IS the bit order — appending is
 *  safe, reordering or removing is not, because the values are persisted. */
export const PERMISSIONS = {
  // ── General server ──
  ViewChannels:       1n << 0n,
  ManageChannels:     1n << 1n,
  ManageRoles:        1n << 2n,
  ManageEmojis:       1n << 3n,
  ViewAuditLog:       1n << 4n,
  ManageWebhooks:     1n << 5n,
  ManageServer:       1n << 6n,

  // ── Membership ──
  CreateInvite:       1n << 7n,
  ChangeNickname:     1n << 8n,
  ManageNicknames:    1n << 9n,
  KickMembers:        1n << 10n,
  BanMembers:         1n << 11n,

  // ── Text ──
  SendMessages:       1n << 12n,
  EmbedLinks:         1n << 13n,
  AttachFiles:        1n << 14n,
  AddReactions:       1n << 15n,
  UseExternalEmojis:  1n << 16n,
  MentionEveryone:    1n << 17n,
  ManageMessages:     1n << 18n,
  ReadMessageHistory: 1n << 19n,
  SendTTSMessages:    1n << 20n,
  UseSlashCommands:   1n << 21n,

  // ── Voice ──
  Connect:            1n << 22n,
  Speak:              1n << 23n,
  Video:              1n << 24n,
  UseVoiceActivity:   1n << 25n,
  PrioritySpeaker:    1n << 26n,
  MuteMembers:        1n << 27n,
  DeafenMembers:      1n << 28n,
  MoveMembers:        1n << 29n,

  // ── Advanced ──
  /** Grants everything and bypasses per-channel overrides. Still below the
   *  owner — see `resolve`. */
  Administrator:      1n << 30n,
} as const

export type PermissionName = keyof typeof PERMISSIONS

/** Grouping for the settings UI. Names only — the values live above. */
export const PERMISSION_GROUPS: { label: string; perms: PermissionName[] }[] = [
  { label: 'General Server Permissions',
    perms: ['ViewChannels', 'ManageChannels', 'ManageRoles', 'ManageEmojis', 'ViewAuditLog', 'ManageWebhooks', 'ManageServer'] },
  { label: 'Membership Permissions',
    perms: ['CreateInvite', 'ChangeNickname', 'ManageNicknames', 'KickMembers', 'BanMembers'] },
  { label: 'Text Channel Permissions',
    perms: ['SendMessages', 'EmbedLinks', 'AttachFiles', 'AddReactions', 'UseExternalEmojis', 'MentionEveryone', 'ManageMessages', 'ReadMessageHistory', 'SendTTSMessages', 'UseSlashCommands'] },
  { label: 'Voice Channel Permissions',
    perms: ['Connect', 'Speak', 'Video', 'UseVoiceActivity', 'PrioritySpeaker', 'MuteMembers', 'DeafenMembers', 'MoveMembers'] },
  { label: 'Advanced',
    perms: ['Administrator'] },
]

/** Every bit set. Used for the owner and as the Administrator expansion. */
export const ALL_PERMISSIONS: bigint =
  Object.values(PERMISSIONS).reduce((acc, p) => acc | p, 0n)

/**
 * What a brand-new `@everyone` gets: talk, listen, read back, react, invite.
 *
 * Deliberately not "nothing". A server whose default role grants nothing looks
 * broken on the first join — the owner sees a working server and everyone else
 * sees an empty one, with no error to explain it.
 */
export const DEFAULT_EVERYONE: bigint =
  PERMISSIONS.ViewChannels | PERMISSIONS.SendMessages | PERMISSIONS.ReadMessageHistory |
  PERMISSIONS.AddReactions | PERMISSIONS.EmbedLinks | PERMISSIONS.AttachFiles |
  PERMISSIONS.UseExternalEmojis | PERMISSIONS.CreateInvite | PERMISSIONS.ChangeNickname |
  PERMISSIONS.Connect | PERMISSIONS.Speak | PERMISSIONS.Video | PERMISSIONS.UseVoiceActivity

// ── Storage ────────────────────────────────────────────────────────────────

/** Parse a stored bitfield. Anything unreadable reads as no permissions —
 *  failing closed, because the alternative is granting on corrupt data. */
export const parseBits = (raw: unknown): bigint => {
  if (typeof raw === 'bigint') return raw
  try { return BigInt(String(raw ?? '0')) } catch { return 0n }
}

export const serializeBits = (bits: bigint): string => bits.toString()

// ── Resolution ─────────────────────────────────────────────────────────────

export interface ResolveInput {
  /** True for the server's owner. */
  isOwner: boolean
  /** Bitfields of every role the member holds, `@everyone` included. */
  roleBits: bigint[]
}

/**
 * The effective permissions of one member.
 *
 * Two rules do the work, in this order:
 *
 *  1. **The owner has everything, always.** Not "the owner has Administrator" —
 *     the owner is above the role system entirely, so no combination of roles
 *     can produce a member who outranks them. That is what stops an
 *     Administrator from editing the owner, kicking them, or handing
 *     themselves the server.
 *  2. **Administrator expands to everything else.** It is a shorthand, not a
 *     separate tier, so a check for any single permission is one operation
 *     rather than "has X, or has Administrator".
 *
 * Roles are a union: holding several means holding the sum of their bits.
 * There is no per-role deny, matching Discord at the server level.
 */
export const resolve = ({ isOwner, roleBits }: ResolveInput): bigint => {
  if (isOwner) return ALL_PERMISSIONS
  const combined = roleBits.reduce((acc, b) => acc | b, 0n)
  return (combined & PERMISSIONS.Administrator) ? ALL_PERMISSIONS : combined
}

/** Does this resolved bitfield carry the permission? */
export const has = (bits: bigint, perm: PermissionName): boolean =>
  (bits & PERMISSIONS[perm]) === PERMISSIONS[perm]

/** All of them. An empty list is vacuously true, as with `Array.every`. */
export const hasAll = (bits: bigint, perms: PermissionName[]): boolean =>
  perms.every(p => has(bits, p))

/** Readable list, for API responses and debugging. */
export const toNames = (bits: bigint): PermissionName[] =>
  (Object.keys(PERMISSIONS) as PermissionName[]).filter(p => has(bits, p))

export const fromNames = (names: readonly PermissionName[]): bigint =>
  names.reduce((acc, n) => acc | (PERMISSIONS[n] ?? 0n), 0n)

// ── Hierarchy ──────────────────────────────────────────────────────────────

/**
 * Whether `actor` may act on a role or a member at `targetPosition`.
 *
 * Higher position wins, and equal positions do NOT — two Administrators cannot
 * remove each other, which is the property that keeps a co-admin from staging a
 * coup and keeps ties from resolving by whoever clicks first.
 *
 * The owner is exempt: they outrank every position, and nobody outranks them.
 */
export interface Actor {
  isOwner: boolean
  /** The actor's highest role position. `@everyone` is 0. */
  highestPosition: number
  bits: bigint
}

export const outranks = (actor: Actor, targetPosition: number): boolean =>
  actor.isOwner || actor.highestPosition > targetPosition

/**
 * Whether `actor` may edit or delete a role.
 *
 * Needs ManageRoles AND a strictly higher position — the permission alone is
 * not enough, or the lowest moderator could rewrite the top role and grant
 * themselves the server.
 */
export const canManageRole = (actor: Actor, targetPosition: number): boolean => {
  if (actor.isOwner) return true
  if (!has(actor.bits, 'ManageRoles')) return false
  return actor.highestPosition > targetPosition
}

/**
 * Whether `actor` may kick, ban or otherwise act on another MEMBER.
 *
 * `targetIsOwner` is checked first and separately: the owner can never be
 * acted on, whatever the acting member holds. An Administrator has every bit
 * set, so without this an admin could kick the person whose server it is.
 */
export const canActOnMember = (
  actor: Actor,
  target: { isOwner: boolean; highestPosition: number },
  perm: PermissionName,
): boolean => {
  if (target.isOwner) return false
  if (actor.isOwner) return true
  if (!has(actor.bits, perm)) return false
  return actor.highestPosition > target.highestPosition
}

// ── Channel overwrites ─────────────────────────────────────────────────────

/**
 * One allow/deny pair aimed at a role or a single member, attached to a
 * category or a channel.
 *
 * Stored with `allow`/`deny` as decimal strings for the same reason role
 * permissions are — BSON has no BigInt. `parseOverwrites` converts on the way
 * in so nothing downstream has to remember.
 */
export interface Overwrite {
  id: string
  type: 'role' | 'member'
  allow: bigint
  deny: bigint
}

export interface StoredOverwrite {
  id: { toString(): string }
  type: 'role' | 'member'
  allow: string
  deny: string
}

/** Stored shape -> working shape. Unreadable bits read as zero, never as a
 *  grant, matching parseBits. */
export const parseOverwrites = (raw: StoredOverwrite[] | null | undefined): Overwrite[] =>
  (raw ?? []).map(o => ({
    id: o.id.toString(),
    type: o.type,
    allow: parseBits(o.allow),
    deny: parseBits(o.deny),
  }))

export interface ChannelResolveInput {
  isOwner: boolean
  /** The member, for member-specific overwrites. */
  userId: string
  /** @everyone's role id. Its overwrite is applied before any other. */
  everyoneRoleId: string
  /** Role ids the member holds. @everyone is implicit and not listed. */
  roleIds: string[]
  /** Base bits: @everyone's permissions plus each role the member holds. */
  roleBits: bigint[]
  /**
   * Overwrite layers, OUTERMOST FIRST — normally [category, channel]. A
   * channel with no category passes one layer; a channel with no overwrites of
   * its own passes an empty array and simply follows its category, which is
   * what "synced" means here.
   */
  layers: Overwrite[][]
}

/**
 * A member's effective permissions in one channel.
 *
 * Two short-circuits, both before any overwrite is read:
 *
 *   1. The owner has everything. Not "the owner has Administrator" — they are
 *      above the role system, so no overwrite can take anything from them.
 *   2. Administrator in the BASE permissions grants everything and bypasses
 *      overwrites entirely. This is why a channel cannot be hidden from an
 *      admin by denying @everyone.
 *
 * Then each layer applies, outermost first, in this order:
 *
 *   @everyone's overwrite  ->  the member's roles  ->  the member themselves
 *
 * with deny applied before allow at every step. Two properties are easy to get
 * wrong and are load-bearing:
 *
 *   - **Role overwrites ACCUMULATE.** Every matching role's denies are OR'd
 *     together and every allow is OR'd together, then applied once. They are
 *     NOT walked in position order, so role rank has no effect on channel
 *     permissions. Rank decides who may EDIT a role, nothing else. Applying
 *     them sequentially would make the answer depend on role order, which is
 *     both wrong and unstable as roles are reordered.
 *   - **Later layers win.** A channel allow beats a category deny, because the
 *     channel layer runs second. That is what makes "one open channel inside a
 *     locked category" expressible.
 */
export const resolveChannel = (input: ChannelResolveInput): bigint => {
  const { isOwner, userId, everyoneRoleId, roleIds, roleBits, layers } = input

  if (isOwner) return ALL_PERMISSIONS
  const base = resolve({ isOwner: false, roleBits })
  if (base === ALL_PERMISSIONS) return ALL_PERMISSIONS   // Administrator

  const held = new Set(roleIds)
  let perms = base

  for (const layer of layers) {
    if (!layer?.length) continue

    const everyone = layer.find(o => o.type === 'role' && o.id === everyoneRoleId)
    if (everyone) perms = (perms & ~everyone.deny) | everyone.allow

    let allow = 0n
    let deny = 0n
    for (const o of layer) {
      if (o.type !== 'role' || o.id === everyoneRoleId || !held.has(o.id)) continue
      allow |= o.allow
      deny |= o.deny
    }
    perms = (perms & ~deny) | allow

    const mine = layer.find(o => o.type === 'member' && o.id === userId)
    if (mine) perms = (perms & ~mine.deny) | mine.allow
  }

  return perms
}

/** Convenience for the common question. */
export const canInChannel = (input: ChannelResolveInput, perm: PermissionName): boolean =>
  has(resolveChannel(input), perm)
