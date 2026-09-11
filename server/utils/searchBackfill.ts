import { Types } from 'mongoose'
import { Message } from '../models/Message'
import { classifyHas, mentionNames, resolveMentions } from './searchFields'
import { mentionCandidates } from './searchMembers'
import { searchWords } from './searchWords'

/**
 * Fill the search fields on messages written before them: `has` and
 * `mentions` on messages from before search, `words` on messages from before
 * whole-word matching.
 *
 * Idempotent: it only touches messages missing a field and only sets the
 * fields they are missing, so after the first run every later boot costs one
 * empty query, and a mention resolved once is never resolved again. Written
 * through the raw collection, not the model, so it neither re-runs the hook
 * nor bumps `updatedAt` on a message nobody edited. Old mentions resolve
 * against members' CURRENT names — a mention made before someone renamed can
 * miss.
 */
export const backfillSearchFields = async (batchSize = 500): Promise<number> => {
  let done = 0
  for (;;) {
    const batch = await Message.collection
      .find(
        { $or: [{ has: { $exists: false } }, { words: { $exists: false } }] },
        { projection: { _id: 1, kind: 1, conversationId: 1, content: 1, has: 1, words: 1 } },
      )
      .limit(batchSize)
      .toArray()
    if (!batch.length) return done

    const ops = []
    for (const m of batch) {
      const content = String(m.content ?? '')
      const system  = m.kind === 'system'
      const $set: Record<string, unknown> = {}
      if (!Array.isArray(m.words)) $set.words = system ? [] : searchWords(content)
      if (!Array.isArray(m.has)) {
        const names  = system ? [] : mentionNames(content)
        const people = names.length ? await mentionCandidates(String(m.kind), String(m.conversationId), names) : []
        $set.has      = system ? [] : classifyHas(content)
        $set.mentions = resolveMentions(names, people).map(id => new Types.ObjectId(id))
      }
      ops.push({ updateOne: { filter: { _id: m._id }, update: { $set } } })
    }
    await Message.collection.bulkWrite(ops)
    done += batch.length
  }
}
