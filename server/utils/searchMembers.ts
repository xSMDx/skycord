import mongoose from 'mongoose'
import type { MentionCandidate } from './searchFields'

const isId = (s: string) => /^[a-f0-9]{24}$/i.test(s)

/**
 * Who could be mentioned in a conversation: server members for a channel,
 * group members for a group, the two participants of a DM.
 *
 * Models are looked up by name when called rather than imported: the Message
 * model calls this from a hook, and importing Channel/Server/Conversation/User
 * into it would tie the model files into a cycle for one lookup.
 */
const memberIdsOf = async (kind: string, conversationId: string): Promise<unknown[]> => {
  if (kind === 'dm') return conversationId.split('_').filter(isId)
  if (kind === 'group') {
    const g = await mongoose.model('Conversation').findById(conversationId).select('members').lean<{ members: unknown[] }>()
    return g?.members ?? []
  }
  if (kind === 'channel') {
    const ch = await mongoose.model('Channel').findById(conversationId).select('server').lean<{ server: unknown }>()
    if (!ch) return []
    const s = await mongoose.model('Server').findById(ch.server).select('members').lean<{ members: unknown[] }>()
    return s?.members ?? []
  }
  return []
}

/**
 * The members of the conversation whose username or display name is one of
 * `names`, ignoring case. A strength-2 collation makes `$in` case-insensitive,
 * so this is one query rather than a regex per name.
 */
export const mentionCandidates = async (
  kind: string, conversationId: string, names: string[],
): Promise<MentionCandidate[]> => {
  if (!names.length) return []
  const memberIds = await memberIdsOf(kind, conversationId)
  if (!memberIds.length) return []
  return mongoose.model('User')
    .find({ _id: { $in: memberIds }, $or: [{ username: { $in: names } }, { displayName: { $in: names } }] })
    .collation({ locale: 'en', strength: 2 })
    .select('_id username displayName')
    .lean<MentionCandidate[]>()
}
