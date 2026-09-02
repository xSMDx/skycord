import type { Response } from 'express'
import { Types } from 'mongoose'
import { Role } from '../models/Role'
import {
  DEFAULT_EVERYONE, ALL_PERMISSIONS, canManageRole,
  parseBits, serializeBits, resolve, resolveChannel, parseOverwrites,
  has as hasPerm,
  type Overwrite, type StoredOverwrite, type PermissionName,
} from '../permissions'

/**
 * Turning a request into an answer about what this person may do here.
 *
 * Split deliberately into two steps. `loadAccess` hits the database once per
 * REQUEST; `channelBits` is pure and runs once per CHANNEL. The server-detail
 * endpoint resolves every channel in a server, so folding the queries into the
 * per-channel call would turn one sidebar render into dozens of round trips.
 */

export interface ServerAccess {
  isOwner: boolean
  userId: string
  everyoneRoleId: string
  /** Roles the member holds. @everyone is implicit and not listed. */
  roleIds: string[]
  /** @everyone's bits plus each held role's, for the base resolve. */
  roleBits: bigint[]
  /** Server-level permissions, before any channel overwrite. */
  base: bigint
  /**
   * The member's highest role position, or -1 when they hold none.
   *
   * -1 and NOT 0: @everyone sits at position 0, and the hierarchy comparisons
   * are strictly greater-than. A member with nothing must not come out equal
   * to the role every member has.
   */
  highestPosition: number
}

/**
 * The @everyone role, created on demand.
 *
 * Servers built before roles existed have none, and this runs on read paths, so
 * it has to be tolerant: a duplicate-key race (two requests arriving together
 * for the same fresh server) is answered by re-reading rather than throwing,
 * since the unique partial index means the other request already made it.
 */
export const ensureEveryone = async (serverId: Types.ObjectId) => {
  const found = await Role.findOne({ server: serverId, isEveryone: true })
  if (found) return found
  try {
    return await Role.create({
      server: serverId, name: '@everyone', position: 0,
      permissions: serializeBits(DEFAULT_EVERYONE), isEveryone: true,
    })
  } catch {
    const raced = await Role.findOne({ server: serverId, isEveryone: true })
    if (raced) return raced
    throw new Error('Could not resolve @everyone')
  }
}

export const loadAccess = async (server: any, userId: string): Promise<ServerAccess> => {
  const isOwner = server.owner.toString() === userId
  const everyone = await ensureEveryone(server._id)

  const entry = (server.memberRoles ?? []).find((m: any) => m.user.toString() === userId)
  const heldIds: Types.ObjectId[] = entry?.roles ?? []
  const held = heldIds.length
    ? await Role.find({ _id: { $in: heldIds }, server: server._id })
    : []

  const roleBits = [parseBits(everyone.permissions), ...held.map(r => parseBits(r.permissions))]
  return {
    isOwner,
    userId,
    everyoneRoleId: everyone._id.toString(),
    // Read back from the roles that actually exist, not from the stored ids: a
    // role deleted between two requests would otherwise stay "held" here.
    roleIds: held.map(r => r._id.toString()),
    roleBits,
    base: resolve({ isOwner, roleBits }),
    highestPosition: held.length ? Math.max(...held.map(r => r.position)) : -1,
  }
}

/**
 * Effective permissions in one channel.
 *
 * `categoryOverwrites` is the outer layer and may be empty — a channel with no
 * category simply has one fewer layer, and a channel with no overwrites of its
 * own follows whatever is above it. That absence IS "synced".
 */
export const channelBits = (
  access: ServerAccess,
  categoryOverwrites: Overwrite[],
  channelOverwrites: Overwrite[],
): bigint => resolveChannel({
  isOwner: access.isOwner,
  userId: access.userId,
  everyoneRoleId: access.everyoneRoleId,
  roleIds: access.roleIds,
  roleBits: access.roleBits,
  layers: [categoryOverwrites, channelOverwrites],
})

/** Overwrites for every category in a server, keyed by id, fetched once. */
export const categoryOverwriteMap = async (
  categories: { _id: Types.ObjectId; overwrites?: StoredOverwrite[] }[],
): Promise<Map<string, Overwrite[]>> => {
  const map = new Map<string, Overwrite[]>()
  for (const c of categories) map.set(c._id.toString(), parseOverwrites(c.overwrites))
  return map
}

/** Re-exported so callers need one import, not two. */
export { has } from '../permissions'

/** "ManageChannels" -> "Manage Channels", for a message someone has to read. */
const humanise = (perm: string) => perm.replace(/([a-z])([A-Z])/g, '$1 $2')

/**
 * The permission-model replacement for requireOwner.
 *
 * Same shape deliberately — responds itself and returns a boolean, so a call
 * site changes by one line rather than being restructured.
 *
 * Takes SERVER-level permissions. Operations scoped to one channel should use
 * the bits `loadChannel` already resolved instead, since a channel overwrite
 * can grant or remove Manage Channels for that channel alone.
 *
 * Note what this does NOT replace: deleting a server stays owner-only. An
 * administrator holds every bit, so routing that through a permission check
 * would let one destroy the server out from under the person who owns it —
 * the exact thing the owner short-circuit exists to prevent.
 */
export const requirePerm = async (
  server: any,
  userId: string,
  perm: PermissionName,
  res: Response,
): Promise<boolean> => {
  const access = await loadAccess(server, userId)
  if (hasPerm(access.base, perm)) return true
  res.status(403).json({ message: `You need ${humanise(perm)} to do that` })
  return false
}

/** As above, for a permission already resolved against a channel. */
export const requireBits = (
  bits: bigint,
  perm: PermissionName,
  res: Response,
): boolean => {
  if (hasPerm(bits, perm)) return true
  res.status(403).json({ message: `You need ${humanise(perm)} to do that` })
  return false
}

/**
 * What validation produces: ready to assign straight onto a document.
 *
 * Distinct from StoredOverwrite, whose `id` is loose enough to accept a lean
 * row as well as a hydrated one. Casting at the call sites instead would put
 * an `as never` in front of the one assignment that decides who can see a
 * channel, which is the last place to switch type checking off.
 */
export interface PersistableOverwrite {
  id: Types.ObjectId
  type: 'role' | 'member'
  allow: string
  deny: string
}

/** More than this on one channel is a client bug, not a configuration. */
export const MAX_OVERWRITES = 100

/**
 * Validate an overwrite list from a request body, for a channel or a category.
 *
 * Responds itself and returns null on refusal, so a caller bails with one `if`
 * — the shape requirePerm and loadServer already use.
 *
 * The two guards that matter are the same ones the roles endpoints carry, and
 * for the same reason: without them, Manage Roles is a short walk to owning
 * the server.
 *
 *   1. **You cannot allow or deny a permission you do not hold.** Both
 *      directions, not just allow. A moderator who could DENY a permission
 *      they lack could quietly strip it from a role above them, which is
 *      privilege escalation wearing a different hat.
 *   2. **You cannot write an overwrite for a role you could not manage.**
 *      Otherwise the role hierarchy holds when editing a role directly and
 *      evaporates the moment you edit it through a channel.
 *
 * The owner is exempt from both — they already hold everything.
 */
export const validateOverwrites = async (
  raw: unknown,
  server: any,
  actor: ServerAccess,
  res: Response,
): Promise<PersistableOverwrite[] | null> => {
  if (!Array.isArray(raw)) {
    res.status(400).json({ message: 'overwrites must be a list' }); return null
  }
  if (raw.length > MAX_OVERWRITES) {
    res.status(400).json({ message: 'Too many permission entries on one channel' }); return null
  }

  const roles = await Role.find({ server: server._id })
  const roleById = new Map(roles.map(r => [r._id.toString(), r]))
  const memberIds = new Set((server.members ?? []).map((m: any) => m.toString()))

  const out: PersistableOverwrite[] = []
  const seen = new Set<string>()

  for (const entry of raw) {
    const id = String(entry?.id ?? '')
    const type = entry?.type
    if (!Types.ObjectId.isValid(id) || (type !== 'role' && type !== 'member')) {
      res.status(400).json({ message: 'Malformed permission entry' }); return null
    }
    // One entry per target: two rows for the same role would resolve by
    // accumulation and make the UI's "this is the row for @staff" a lie.
    const key = `${type}:${id}`
    if (seen.has(key)) {
      res.status(400).json({ message: 'Duplicate permission entry' }); return null
    }
    seen.add(key)

    if (type === 'role' && !roleById.has(id)) {
      res.status(400).json({ message: 'Unknown role' }); return null
    }
    if (type === 'member' && !memberIds.has(id)) {
      res.status(400).json({ message: 'That person is not a member' }); return null
    }

    // Unknown bits are masked off rather than rejected: a client one release
    // ahead should not be able to persist a flag this server cannot resolve.
    const allow = parseBits(entry?.allow) & ALL_PERMISSIONS
    const deny  = parseBits(entry?.deny)  & ALL_PERMISSIONS
    if (allow & deny) {
      res.status(400).json({ message: 'A permission cannot be both allowed and denied' }); return null
    }

    if (!actor.isOwner) {
      const touched = allow | deny
      if (touched & ~actor.base) {
        res.status(403).json({ message: 'You cannot change a permission you do not have' }); return null
      }
      if (type === 'role') {
        const role = roleById.get(id)!
        if (!canManageRole(
          { isOwner: false, highestPosition: actor.highestPosition, bits: actor.base },
          role.position,
        )) {
          res.status(403).json({ message: `“${role.name}” is above your highest role` }); return null
        }
      }
    }

    out.push({
      id: new Types.ObjectId(id),
      type,
      allow: serializeBits(allow),
      deny:  serializeBits(deny),
    })
  }

  return out
}
