import type { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { Conversation } from '../models/Conversation'
import { loadServer } from './serversController'
import { resolveMessages, dmConvId } from './messagesController'
import { loadAccess, categoryOverwriteMap, channelViewOf, channelBits, has } from '../utils/access'
import { parseOverwrites } from '../permissions'
import { parseSearch, searchFilter, runSearch, type SearchParams } from '../utils/messageSearch'

/**
 * The text channels of a server a member may search: fully visible AND
 * readable. View alone is not enough — Read Message History is what shows a
 * channel's past, and search is nothing but its past.
 */
const searchableChannelIds = async (server: any, userId: string): Promise<string[]> => {
  const [channels, categories, access] = await Promise.all([
    Channel.find({ server: server._id, type: 'text' }).select('_id category overwrites hideWhenDenied').lean(),
    Category.find({ server: server._id }).select('_id overwrites').lean(),
    loadAccess(server, userId),
  ])
  const catOverwrites = await categoryOverwriteMap(categories as never)
  return channels
    .filter(c => {
      if (channelViewOf(access, c, catOverwrites) !== 'full') return false
      const bits = channelBits(
        access,
        catOverwrites.get(c.category ? String(c.category) : '') ?? [],
        parseOverwrites(c.overwrites as never),
      )
      return has(bits, 'ReadMessageHistory')
    })
    .map(c => c._id.toString())
}

/**
 * Run the search and shape the answer. Results are resolved per conversation
 * because reply previews are scoped to the conversation a message is in.
 */
const answer = async (res: Response, conversationIds: string[], p: SearchParams, withChannel: boolean) => {
  const { rows, total, hasMore } = await runSearch(searchFilter(conversationIds, p), p)
  const byConv = new Map<string, any[]>()
  for (const r of rows) {
    delete r.score
    const list = byConv.get(r.conversationId) ?? []
    list.push(r)
    byConv.set(r.conversationId, list)
  }
  const resolved = new Map<string, any>()
  for (const [conv, list] of byConv) {
    for (const m of await resolveMessages(list, conv)) resolved.set(String(m._id), m)
  }
  const results = rows.map(r => {
    const m = resolved.get(String(r._id))
    return withChannel ? { ...m, channelId: r.conversationId } : m
  })
  res.json({ results, total, hasMore })
}

const parsedOr400 = (req: Request, res: Response): SearchParams | null => {
  const parsed = parseSearch(req.query as Record<string, unknown>)
  if (!parsed.ok) { res.status(400).json({ message: parsed.message }); return null }
  return parsed.params
}

export const searchServerMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const p = parsedOr400(req, res); if (!p) return
    let ids = await searchableChannelIds(server, req.user!.sub)
    // A channel the searcher cannot read narrows to nothing rather than
    // erroring: an error would confirm the channel exists.
    if (p.in.length) ids = ids.filter(id => p.in.includes(id))
    if (!ids.length) { res.json({ results: [], total: 0, hasMore: false }); return }
    await answer(res, ids, p, true)
  } catch (err) { next(err) }
}

export const searchGroupMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { groupId } = req.params
    if (!mongoose.isValidObjectId(groupId)) { res.status(400).json({ message: 'Invalid group' }); return }
    const group = await Conversation.findById(groupId).select('members').lean()
    if (!group) { res.status(404).json({ message: 'Group not found' }); return }
    if (!group.members.some(m => m.toString() === req.user!.sub)) {
      res.status(403).json({ message: 'You are not a member of this group' }); return
    }
    const p = parsedOr400(req, res); if (!p) return
    await answer(res, [groupId], p, false)
  } catch (err) { next(err) }
}

export const searchDMMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params
    if (!mongoose.isValidObjectId(partnerId)) { res.status(400).json({ message: 'Invalid user' }); return }
    const p = parsedOr400(req, res); if (!p) return
    // The conversation id is built from the caller's own id, so this can only
    // ever search a DM the caller is in.
    await answer(res, [dmConvId(req.user!.sub, partnerId)], p, false)
  } catch (err) { next(err) }
}
