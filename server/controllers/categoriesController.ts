import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Category, MAX_CATEGORIES } from '../models/Category'
import { Channel } from '../models/Channel'
import { loadServer, requireOwner, shapeCategory, emitToServer } from './serversController'

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

    const count = await Category.countDocuments({ server: server._id })
    if (count >= MAX_CATEGORIES) {
      res.status(400).json({ message: `A server can have at most ${MAX_CATEGORIES} categories` }); return
    }

    // Appended to the end, the same way createChannel assigns its own
    // position: highest + 1, not the document count. A count would reuse the
    // position of a deleted category and collide with an existing one.
    const last = await Category.find({ server: server._id }).sort({ position: -1 }).limit(1).lean()
    const position = last.length ? last[0].position + 1 : 0

    const category = await Category.create({ server: server._id, name, position })
    const shaped = shapeCategory(category)
    emitToServer(server, 'category:created', { serverId: server._id.toString(), category: shaped })
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
    await Channel.updateMany({ server: server._id, category: category._id }, { category: null })
    await Category.deleteOne({ _id: category._id })

    // Ids only. The client already knows which channels were in the category
    // and can reparent them locally; sending the whole channel list would be a
    // second source of truth for something the client can derive.
    emitToServer(server, 'category:deleted', {
      serverId:   server._id.toString(),
      categoryId: category._id.toString(),
    })
    res.json({ ok: true })
  } catch (err) { next(err) }
}
