import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Category, MAX_CATEGORIES } from '../models/Category'
import { Channel } from '../models/Channel'
import { loadServer, requireOwner, shapeCategory, emitToServer } from './serversController'
import { withServerLock } from './channelsController'

/**
 * Resolve a category and prove the caller may touch it. Mirrors loadChannel
 * (channelsController.ts): the category must belong to the server in the path,
 * otherwise a member of any server could address a category in any other by
 * id — renaming or, worse, deleting it and reparenting its channels.
 *
 * A mismatch is a 404 rather than a 403, exactly as loadChannel treats a
 * foreign channel id: from this server's point of view the category does not
 * exist, and saying anything more would confirm that it exists elsewhere.
 */
export const loadCategory = async (req: Request, res: Response) => {
  const server = await loadServer(req, res)
  if (!server) return null
  const { cid } = req.params
  if (!Types.ObjectId.isValid(cid)) { res.status(404).json({ message: 'Category not found' }); return null }
  const category = await Category.findById(cid)
  if (!category || category.server.toString() !== server._id.toString()) {
    res.status(404).json({ message: 'Category not found' }); return null
  }
  return { server, category }
}

export const createCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    const name = String(req.body.name ?? '').trim()
    if (!name || name.length > 100) { res.status(400).json({ message: 'Give the category a name' }); return }

    // The cap check and the highest-position read are both check-then-act:
    // concurrent requests that all read a count under the cap, or all read
    // the same highest position, all pass and all write — over-filling the
    // cap by however many raced together, or handing out duplicate
    // positions. Locked with the same per-server mutex deleteCategory and the
    // channel category paths use, so this also can't interleave with a
    // concurrent deleteCategory (irrelevant to the cap/position math here,
    // but it's the same lock everyone shares for this server).
    const serverId = server._id.toString()
    const result = await withServerLock(serverId, async () => {
      const count = await Category.countDocuments({ server: server._id })
      if (count >= MAX_CATEGORIES) {
        return { error: `A server can have at most ${MAX_CATEGORIES} categories` } as const
      }

      // Appended to the end, the same way createChannel assigns its own
      // position: highest + 1, not the document count. A count would reuse the
      // position of a deleted category and collide with an existing one.
      const last = await Category.find({ server: server._id }).sort({ position: -1 }).limit(1).lean()
      const position = last.length ? last[0].position + 1 : 0

      const category = await Category.create({ server: server._id, name, position })
      return { category } as const
    })
    if ('error' in result) { res.status(400).json({ message: result.error }); return }

    const shaped = shapeCategory(result.category)
    emitToServer(server, 'category:created', { serverId, category: shaped })
    res.status(201).json({ category: shaped })
  } catch (err) { next(err) }
}

export const updateCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadCategory(req, res); if (!found) return
    if (!requireOwner(found.server, req.user!.sub, res)) return

    const name = String(req.body.name ?? '').trim()
    if (!name || name.length > 100) { res.status(400).json({ message: 'Give the category a name' }); return }

    // Rename only. `position` is assigned by appending and there is no reorder
    // UI yet; accepting one from the body would let a client write a position
    // that collides with a sibling's for no one to fix.
    found.category.name = name
    await found.category.save()

    const shaped = shapeCategory(found.category)
    emitToServer(found.server, 'category:updated', {
      serverId: found.server._id.toString(), category: shaped,
    })
    res.json({ category: shaped })
  } catch (err) { next(err) }
}

export const deleteCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadCategory(req, res); if (!found) return
    if (!requireOwner(found.server, req.user!.sub, res)) return

    const { server, category } = found

    // Channels outlive their category. Reparent first, then delete — if the
    // delete happened first, a concurrent read could see channels pointing at
    // a category that no longer exists. Deleting a category is a tidying
    // action; taking ten channels and their history with it is not something
    // a single click should be able to do.
    //
    // Scoped by `server` as well as `category` — the category id alone would
    // be enough today, but a filter that cannot reach outside this server is
    // the same guarantee loadCategory just established, restated where the
    // write happens.
    //
    // Wrapped in the same per-server lock that createChannel/updateChannel
    // take around their category resolution: reparent-then-delete here and
    // resolve-then-persist there are two halves of one check-then-act race.
    // Without a shared lock, a concurrent createChannel/updateChannel could
    // resolve this category as valid *after* the reparent below has run but
    // *before* the deleteOne, and then persist a channel pointing at the id
    // this call is about to remove — a dangling reference exactly like the
    // one this comment used to (wrongly) claim was impossible. With the lock,
    // that create/update either fully completes before this delete starts
    // (and gets swept up by the reparent below, same as any other channel
    // already in the category) or fully waits until after this delete has
    // committed (and then fails validation, since the category is gone) —
    // never something in between.
    const serverId = server._id.toString()
    await withServerLock(serverId, async () => {
      await Channel.updateMany({ server: server._id, category: category._id }, { category: null })
      await Category.deleteOne({ _id: category._id })
    })

    // Ids only. The client already knows which channels were in the category
    // and can reparent them locally; sending the whole channel list would be a
    // second source of truth for something the client can derive.
    emitToServer(server, 'category:deleted', {
      serverId,
      categoryId: category._id.toString(),
    })
    res.json({ ok: true })
  } catch (err) { next(err) }
}
