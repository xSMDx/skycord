import { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Role, MAX_ROLES, MAX_ROLE_NAME } from '../models/Role'
import { Server } from '../models/Server'
import { loadServer, emitToServer } from './serversController'
import {
  DEFAULT_EVERYONE, ALL_PERMISSIONS,
  parseBits, serializeBits, resolve, has, canManageRole,
} from '../permissions'

/**
 * Roles: the first thing in this codebase to authorise on something other than
 * "are you the owner".
 *
 * Every write here goes through actorContext(), which resolves the caller's
 * effective permissions and highest position from the permission model rather
 * than comparing ids. The owner short-circuit lives in resolve(); the rule that
 * an administrator still cannot reach the owner lives in canActOnMember(). This
 * file adds the two guards those cannot express on their own:
 *
 *   1. You cannot touch a role at or above your own highest. Equal does NOT
 *      pass — two peers must not be able to unmake each other, and a tie
 *      settled by whoever clicks first is not an authorisation model.
 *   2. You cannot grant a permission you do not hold. Without this, ManageRoles
 *      is a single hop to Administrator: make a role with every bit, assign it
 *      to yourself. The owner is exempt because they already hold everything.
 */

const shapeRole = (r: any) => ({
  id:          r._id.toString(),
  name:        r.name,
  color:       r.color,
  position:    r.position,
  permissions: r.permissions,
  hoist:       r.hoist,
  mentionable: r.mentionable,
  isEveryone:  r.isEveryone,
})

/** The @everyone role, created on demand for servers that predate roles. */
export const ensureEveryoneRole = async (serverId: Types.ObjectId) => {
  const found = await Role.findOne({ server: serverId, isEveryone: true })
  if (found) return found
  return Role.create({
    server:      serverId,
    name:        '@everyone',
    position:    0,
    permissions: serializeBits(DEFAULT_EVERYONE),
    isEveryone:  true,
  })
}

interface Actor {
  isOwner: boolean
  bits: bigint
  highestPosition: number
}

/**
 * What the caller may do in this server.
 *
 * `highestPosition` is -1 for a member with no roles beyond @everyone, NOT 0:
 * @everyone sits at position 0, and a strict `>` comparison must not let a
 * member with nothing manage the role every member holds.
 */
const actorContext = async (server: any, userId: string): Promise<Actor> => {
  const isOwner = server.owner.toString() === userId
  const entry = (server.memberRoles ?? []).find((m: any) => m.user.toString() === userId)
  const roleIds: Types.ObjectId[] = entry?.roles ?? []
  const roles = roleIds.length
    ? await Role.find({ _id: { $in: roleIds }, server: server._id })
    : []
  const everyone = await ensureEveryoneRole(server._id)

  const roleBits = [parseBits(everyone.permissions), ...roles.map(r => parseBits(r.permissions))]
  const bits = resolve({ isOwner, roleBits })
  const highestPosition = roles.length ? Math.max(...roles.map(r => r.position)) : -1
  return { isOwner, bits, highestPosition }
}

/** Refuse anything the actor is not itself holding. Owners hold everything. */
const grantable = (actor: Actor, wanted: bigint): boolean =>
  actor.isOwner || (wanted & ~actor.bits) === 0n

export const listRoles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    await ensureEveryoneRole(server._id)
    const roles = await Role.find({ server: server._id }).sort({ position: -1 })
    res.json({ roles: roles.map(shapeRole) })
  } catch (e) { next(e) }
}

export const createRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const actor = await actorContext(server, req.user!.sub)
    if (!actor.isOwner && !has(actor.bits, 'ManageRoles')) {
      res.status(403).json({ message: 'You need Manage Roles to do that' }); return
    }

    const count = await Role.countDocuments({ server: server._id })
    if (count >= MAX_ROLES) {
      res.status(409).json({ message: `A server can have at most ${MAX_ROLES} roles` }); return
    }

    const name = String(req.body.name ?? '').trim() || 'new role'
    if (name.length > MAX_ROLE_NAME) { res.status(400).json({ message: 'That name is too long' }); return }

    // A new role starts from @everyone's set — never from nothing, which is a
    // role that cannot see a channel or speak, and never what anyone meant.
    const everyone = await ensureEveryoneRole(server._id)
    const wanted = req.body.permissions !== undefined
      ? parseBits(req.body.permissions)
      : parseBits(everyone.permissions)
    if (!grantable(actor, wanted)) {
      res.status(403).json({ message: 'You cannot grant a permission you do not have' }); return
    }

    // Above every existing role but never above the actor's own — creating a
    // role you then could not edit is a trap, and creating one ABOVE you is
    // privilege escalation with extra steps.
    const top = await Role.findOne({ server: server._id }).sort({ position: -1 })
    const ceiling = actor.isOwner ? (top?.position ?? 0) + 1 : actor.highestPosition - 1
    const position = Math.max(1, Math.min((top?.position ?? 0) + 1, ceiling))

    const role = await Role.create({
      server:      server._id,
      name,
      color:       req.body.color ?? null,
      position,
      permissions: serializeBits(wanted),
      hoist:       !!req.body.hoist,
      mentionable: !!req.body.mentionable,
    })

    emitToServer(server, 'role:created', { serverId: server._id.toString(), role: shapeRole(role) })
    res.status(201).json({ role: shapeRole(role) })
  } catch (e) { next(e) }
}

export const updateRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const { rid } = req.params
    if (!Types.ObjectId.isValid(rid)) { res.status(404).json({ message: 'Role not found' }); return }
    const role = await Role.findOne({ _id: rid, server: server._id })
    if (!role) { res.status(404).json({ message: 'Role not found' }); return }

    const actor = await actorContext(server, req.user!.sub)
    if (!canManageRole(
      { isOwner: actor.isOwner, highestPosition: actor.highestPosition, bits: actor.bits },
      role.position,
    )) {
      res.status(403).json({ message: 'That role is above yours' }); return
    }

    if (req.body.name !== undefined) {
      // @everyone is the floor everything else sits on; renaming it would make
      // every mention and every permission table read as something it is not.
      if (role.isEveryone) { res.status(400).json({ message: '@everyone cannot be renamed' }); return }
      const name = String(req.body.name).trim()
      if (!name || name.length > MAX_ROLE_NAME) { res.status(400).json({ message: 'Give the role a name' }); return }
      role.name = name
    }
    if (req.body.color !== undefined) {
      if (role.isEveryone) { res.status(400).json({ message: '@everyone cannot have a colour' }); return }
      role.color = req.body.color === null ? null : String(req.body.color)
    }
    if (req.body.permissions !== undefined) {
      const wanted = parseBits(req.body.permissions)
      if (!grantable(actor, wanted)) {
        res.status(403).json({ message: 'You cannot grant a permission you do not have' }); return
      }
      // Nor take away what you could not give: without this, a moderator could
      // strip a permission from a role, leaving it unrecoverable by them.
      const removed = parseBits(role.permissions) & ~wanted
      if (!grantable(actor, removed)) {
        res.status(403).json({ message: 'You cannot remove a permission you do not have' }); return
      }
      role.permissions = serializeBits(wanted & ALL_PERMISSIONS)
    }
    if (req.body.hoist !== undefined)       role.hoist = !!req.body.hoist
    if (req.body.mentionable !== undefined) role.mentionable = !!req.body.mentionable

    await role.save()
    emitToServer(server, 'role:updated', { serverId: server._id.toString(), role: shapeRole(role) })
    res.json({ role: shapeRole(role) })
  } catch (e) { next(e) }
}

export const deleteRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const { rid } = req.params
    if (!Types.ObjectId.isValid(rid)) { res.status(404).json({ message: 'Role not found' }); return }
    const role = await Role.findOne({ _id: rid, server: server._id })
    if (!role) { res.status(404).json({ message: 'Role not found' }); return }
    if (role.isEveryone) { res.status(400).json({ message: '@everyone cannot be deleted' }); return }

    const actor = await actorContext(server, req.user!.sub)
    if (!canManageRole(
      { isOwner: actor.isOwner, highestPosition: actor.highestPosition, bits: actor.bits },
      role.position,
    )) {
      res.status(403).json({ message: 'That role is above yours' }); return
    }

    await role.deleteOne()
    // Take it off everyone who held it, in the same breath. A dangling role id
    // in memberRoles would resolve to nothing today and to whatever reuses that
    // id tomorrow.
    await Server.updateOne(
      { _id: server._id },
      { $pull: { 'memberRoles.$[].roles': role._id } },
    )

    emitToServer(server, 'role:deleted', { serverId: server._id.toString(), roleId: rid })
    res.json({ ok: true })
  } catch (e) { next(e) }
}

/**
 * Give or take a role from one member.
 *
 * Two separate checks, and both matter: the ROLE must be below the actor
 * (canManageRole), and so must the TARGET's highest role. Without the second, a
 * moderator could not edit an admin's roles directly but could hand an admin a
 * junk role — or, worse, be handed one themselves by a peer.
 */
export const setMemberRoles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const { uid } = req.params
    if (!Types.ObjectId.isValid(uid)) { res.status(404).json({ message: 'Member not found' }); return }
    if (!server.members.some((m: any) => m.toString() === uid)) {
      res.status(404).json({ message: 'Member not found' }); return
    }

    const actor = await actorContext(server, req.user!.sub)
    if (!actor.isOwner && !has(actor.bits, 'ManageRoles')) {
      res.status(403).json({ message: 'You need Manage Roles to do that' }); return
    }

    // The owner's roles are theirs alone. An administrator holds every bit, so
    // only an explicit ownership check stops this.
    if (server.owner.toString() === uid && !actor.isOwner) {
      res.status(403).json({ message: 'You cannot change the owner’s roles' }); return
    }

    const wanted: string[] = Array.isArray(req.body.roles) ? req.body.roles.map(String) : []
    const valid = wanted.filter(id => Types.ObjectId.isValid(id))
    const roles = await Role.find({ _id: { $in: valid }, server: server._id })
    if (roles.length !== valid.length) { res.status(400).json({ message: 'Unknown role' }); return }
    // @everyone is held implicitly by every member; storing it would be a fact
    // that can go stale, and removing it would be meaningless.
    if (roles.some(r => r.isEveryone)) {
      res.status(400).json({ message: '@everyone is not assignable' }); return
    }

    const target = await actorContext(server, uid)
    if (!actor.isOwner && target.highestPosition >= actor.highestPosition) {
      res.status(403).json({ message: 'That member outranks you' }); return
    }
    for (const r of roles) {
      if (!canManageRole(
        { isOwner: actor.isOwner, highestPosition: actor.highestPosition, bits: actor.bits },
        r.position,
      )) {
        res.status(403).json({ message: `“${r.name}” is above your highest role` }); return
      }
    }

    const ids = roles.map(r => r._id)
    // Upsert into the side-car: replace the entry if present, append if not.
    const updated = await Server.updateOne(
      { _id: server._id, 'memberRoles.user': uid },
      { $set: { 'memberRoles.$.roles': ids } },
    )
    if (updated.matchedCount === 0) {
      await Server.updateOne(
        { _id: server._id },
        { $push: { memberRoles: { user: new Types.ObjectId(uid), roles: ids } } },
      )
    }

    emitToServer(server, 'member:roles', {
      serverId: server._id.toString(),
      userId: uid,
      roles: ids.map(i => i.toString()),
    })
    res.json({ ok: true, roles: ids.map(i => i.toString()) })
  } catch (e) { next(e) }
}
