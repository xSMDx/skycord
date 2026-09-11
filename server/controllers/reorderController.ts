import { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { loadServer, shapeChannel, shapeCategory, emitToServer } from './serversController'
import { withServerLock } from './channelsController'
import { requirePerm } from '../utils/access'
import { emitChannelsReordered } from '../sockets/visibility'

/**
 * Putting channels and categories in a chosen order.
 *
 * `position` has existed since channels were built and was assigned on create
 * and never written again — so a sidebar could only ever be in creation order.
 * This is the missing write path.
 *
 * ── Why the whole list, and not "move item X to index 3" ────────────────────
 * An index is a claim about a list the client can no longer see. Between the
 * drag starting and the request landing, somebody else can create, delete or
 * move a channel, and index 3 then means something the person who dragged never
 * looked at. Sending the full order makes the request self-describing: the
 * server checks that the list is exactly the membership it holds, and refuses
 * outright if it is not, rather than silently applying an order to the wrong
 * set. The client refetches and the person drags again — annoying, and far
 * better than a shuffle nobody asked for.
 */

/** More than this in one bucket is a client bug, not a sidebar. */
const MAX_ORDER = 500

/**
 * Reassign the slots a set of rows already occupies, in a new order.
 *
 * The subtle part, and the reason this is not simply `0..n-1`: positions are
 * shared across every channel of a type in the server, so renumbering a bucket
 * from zero would drop it on top of the numbering of every other bucket. Taking
 * the positions these rows ALREADY hold and permuting which row holds which
 * leaves every channel outside the bucket untouched.
 *
 * Ties are broken upward first. Duplicate positions are reachable — two
 * creations racing, which the create path documents — and assigning a duplicate
 * slot to two rows would leave their order undefined, which is precisely the
 * complaint this endpoint exists to fix.
 */
export const slotsFor = (positions: number[]): number[] => {
  const slots = [...positions].sort((a, b) => a - b)
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1
  }
  return slots
}

/**
 * Validate an ordering request against the rows that actually exist.
 *
 * Returns the rows in the requested order, or null after responding. The three
 * refusals are deliberate and none of them is paranoia:
 *
 *   - a DUPLICATE id would give one row two positions
 *   - an UNKNOWN id means the client is ordering a list from another bucket
 *   - a MISSING id means the client's list is stale, and applying it would
 *     leave the absent channel wherever it happened to be
 */
const orderRows = <T extends { _id: Types.ObjectId }>(
  raw: unknown, rows: T[], res: Response, noun: string,
): T[] | null => {
  if (!Array.isArray(raw)) {
    res.status(400).json({ message: 'order must be a list of ids' }); return null
  }
  if (raw.length > MAX_ORDER) {
    res.status(400).json({ message: `Too many ${noun} in one order` }); return null
  }
  const byId = new Map(rows.map(r => [r._id.toString(), r]))
  const seen = new Set<string>()
  const out: T[] = []
  for (const entry of raw) {
    const id = String(entry ?? '')
    if (seen.has(id)) {
      res.status(400).json({ message: 'The same item appears twice in that order' }); return null
    }
    seen.add(id)
    const row = byId.get(id)
    if (!row) {
      res.status(409).json({ message: `That list is out of date — reopen the server and try again` })
      return null
    }
    out.push(row)
  }
  if (out.length !== rows.length) {
    res.status(409).json({ message: `That list is out of date — reopen the server and try again` })
    return null
  }
  return out
}

/**
 * PUT /servers/:sid/channels/order — order one bucket of the sidebar.
 *
 * A bucket is a (category, type) pair, because that is what the sidebar draws:
 * a category shows its text channels and its voice channels as two lists, and
 * they interleave nowhere. Ordering is therefore scoped to one of them.
 */
export const reorderChannels = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!await requirePerm(server, req.user!.sub, 'ManageChannels', res)) return

    const { category, type, order } = req.body as {
      category?: unknown; type?: unknown; order?: unknown
    }
    if (type !== 'text' && type !== 'voice') {
      res.status(400).json({ message: 'type must be text or voice' }); return
    }
    // Absent and null both mean the uncategorised group at the top, matching
    // how a channel with no category is stored and drawn.
    const categoryId = category == null ? null : String(category)
    if (categoryId !== null && !Types.ObjectId.isValid(categoryId)) {
      res.status(404).json({ message: 'Category not found' }); return
    }

    const updated = await withServerLock(server._id.toString(), async () => {
      if (categoryId !== null) {
        const cat = await Category.findOne({ _id: categoryId, server: server._id }).lean()
        if (!cat) return { kind: 'missing-category' } as const
      }
      // Read INSIDE the lock: the membership check below is only meaningful
      // against the list as it is at the moment of the write.
      const rows = await Channel.find({
        server: server._id, type, category: categoryId,
      }).sort({ position: 1 })

      const ordered = orderRows(order, rows, res, 'channels')
      // orderRows has already responded; nothing left for the caller to say.
      if (!ordered) return { kind: 'answered' } as const

      const slots = slotsFor(rows.map(r => r.position))
      const writes = ordered
        .map((row, i) => ({ row, position: slots[i] }))
        // Only what actually moves. A drag that ends where it began, or one that
        // shifts two of thirty rows, should not rewrite the other twenty-eight.
        .filter(({ row, position }) => row.position !== position)

      if (writes.length) {
        await Channel.bulkWrite(writes.map(({ row, position }) => ({
          updateOne: { filter: { _id: row._id }, update: { $set: { position } } },
        })))
      }
      // The whole bucket, in its new order — not just what changed. The client
      // replaces a list rather than patching one, and a partial answer would
      // make it reconstruct an order it just asked the server to decide.
      for (const { row, position } of ordered.map((row, i) => ({ row, position: slots[i] }))) {
        row.position = position
      }
      return { kind: 'ok', rows: ordered, channels: ordered.map(c => shapeChannel(c)) } as const
    })

    if (updated.kind === 'answered') return
    if (updated.kind === 'missing-category') {
      res.status(404).json({ message: 'Category not found' }); return
    }

    // Member by member: a bucket can hold a channel some of them may not see,
    // and the whole list would put it in their sidebar.
    await emitChannelsReordered(server._id, { category: categoryId, type }, updated.rows)
    res.json({ channels: updated.channels })
  } catch (err) { next(err) }
}

/**
 * PUT /servers/:sid/categories/order — order the categories themselves.
 *
 * Same shape and same reasoning as above; there is only one list, so there is
 * no bucket to name. Gated on ManageChannels rather than a category-specific
 * permission because creating and renaming a category is already that bit —
 * inventing a second one for moving them would be a distinction nobody asked
 * for and nobody could discover.
 */
export const reorderCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!await requirePerm(server, req.user!.sub, 'ManageChannels', res)) return

    const updated = await withServerLock(server._id.toString(), async () => {
      const rows = await Category.find({ server: server._id }).sort({ position: 1 })
      const ordered = orderRows((req.body as { order?: unknown }).order, rows, res, 'categories')
      if (!ordered) return { kind: 'answered' } as const

      const slots = slotsFor(rows.map(r => r.position))
      const writes = ordered
        .map((row, i) => ({ row, position: slots[i] }))
        .filter(({ row, position }) => row.position !== position)

      if (writes.length) {
        await Category.bulkWrite(writes.map(({ row, position }) => ({
          updateOne: { filter: { _id: row._id }, update: { $set: { position } } },
        })))
      }
      ordered.forEach((row, i) => { row.position = slots[i] })
      return { kind: 'ok', categories: ordered.map(shapeCategory) } as const
    })

    if (updated.kind === 'answered') return

    emitToServer(server, 'categories:reordered', {
      serverId: server._id.toString(),
      categories: updated.categories,
    })
    res.json({ categories: updated.categories })
  } catch (err) { next(err) }
}
