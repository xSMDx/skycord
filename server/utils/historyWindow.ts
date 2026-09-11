import { Types } from 'mongoose'
import { Message } from '../models/Message'

/**
 * One page of a conversation's history — older, newer, or around one message.
 *
 * Shared by the channel, DM and group history endpoints, which used to page by
 * `createdAt < before` alone. Two messages written in the same millisecond then
 * sat on a page boundary with nothing to tell them apart, and one was never
 * returned. Ordering by `(createdAt, _id)` and continuing strictly past the
 * cursor's pair makes every boundary exact.
 *
 * `base` is the endpoint's own filter (conversation id, and the kinds it
 * serves). Every cursor is looked up INSIDE it, so an id from another
 * conversation behaves exactly like one that does not exist.
 */

export const HISTORY_LIMIT = 50
export const HISTORY_MAX   = 100

export interface HistoryQuery { before?: unknown; after?: unknown; around?: unknown; limit?: unknown }

export type HistoryWindow =
  | { ok: true; messages: any[]; hasOlder: boolean; hasNewer: boolean }
  | { ok: false; status: 400 | 404; message: string }

interface Cursor { createdAt: Date; _id: Types.ObjectId }

const GONE = { ok: false, status: 404, message: 'That message is no longer here' } as const

const isId = (s: string) => /^[a-f0-9]{24}$/i.test(s)
const given = (v: unknown) => v != null && v !== ''

const olderThan = (c: Cursor) => ({
  $or: [{ createdAt: { $lt: c.createdAt } }, { createdAt: c.createdAt, _id: { $lt: c._id } }],
})
const newerThan = (c: Cursor) => ({
  $or: [{ createdAt: { $gt: c.createdAt } }, { createdAt: c.createdAt, _id: { $gt: c._id } }],
})

const clampLimit = (raw: unknown) => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), HISTORY_MAX) : HISTORY_LIMIT
}

/**
 * `n` rows on one side of `edge` (the newest `n` when there is none), returned
 * oldest-first, and whether more exist beyond them. One extra row is read
 * rather than a count query: it answers "is there more" for free.
 */
const page = async (base: object, side: 'older' | 'newer', edge: Cursor | null, n: number) => {
  if (n <= 0) return { rows: [] as any[], more: false }
  const filter = edge ? { $and: [base, side === 'older' ? olderThan(edge) : newerThan(edge)] } : base
  const dir = side === 'older' ? -1 : 1
  const rows = await Message.find(filter).sort({ createdAt: dir, _id: dir }).limit(n + 1).lean()
  const more = rows.length > n
  const kept = rows.slice(0, n)
  return { rows: side === 'older' ? kept.reverse() : kept, more }
}

export const loadHistoryWindow = async (
  base: Record<string, unknown>,
  q: HistoryQuery,
): Promise<HistoryWindow> => {
  const limit = clampLimit(q.limit)
  if ([q.before, q.after, q.around].filter(given).length > 1) {
    return { ok: false, status: 400, message: 'Use only one of before, after or around' }
  }

  const find = async (raw: unknown) => {
    const id = String(raw)
    if (!isId(id)) return null
    return Message.findOne({ ...base, _id: id }).lean()
  }

  if (given(q.around)) {
    const target = await find(q.around)
    if (!target) return GONE
    const olderN = Math.floor(limit / 2)
    const newerN = limit - olderN - 1
    const [older, newer] = await Promise.all([
      page(base, 'older', target as Cursor, olderN),
      page(base, 'newer', target as Cursor, newerN),
    ])
    return { ok: true, messages: [...older.rows, target, ...newer.rows], hasOlder: older.more, hasNewer: newer.more }
  }

  if (given(q.after)) {
    const edge = await find(q.after)
    if (!edge) return GONE
    const newer = await page(base, 'newer', edge as Cursor, limit)
    // Paging forward FROM a message: that message, at least, is above.
    return { ok: true, messages: newer.rows, hasOlder: true, hasNewer: newer.more }
  }

  let edge: Cursor | null = null
  if (given(q.before)) {
    const raw = String(q.before)
    if (isId(raw)) {
      const found = await find(raw)
      if (!found) return GONE
      edge = found as Cursor
    } else {
      // A date, from clients deployed before id cursors. An `_id` below every
      // real one keeps the tie-break inert, so this is exactly the old
      // `createdAt < before` they asked for.
      const at = new Date(raw)
      if (Number.isNaN(at.getTime())) {
        return { ok: false, status: 400, message: 'before must be a message id or a date' }
      }
      edge = { createdAt: at, _id: new Types.ObjectId('000000000000000000000000') }
    }
  }
  const older = await page(base, 'older', edge, limit)
  // Paging back from a cursor means something newer exists: at least the cursor.
  return { ok: true, messages: older.rows, hasOlder: older.more, hasNewer: edge !== null }
}
