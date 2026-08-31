/**
 * Reactions on a GROUP message.
 *
 * Listed as a known defect for being *unverified* rather than broken: groups
 * started working incidentally when `handleReact` was un-gated during slice 3a,
 * and nothing has covered them since. An accident that happens to work is one
 * refactor away from silently not working, and the failure would be invisible —
 * a reaction that simply never appears for anyone else.
 *
 * The property that matters most is the authorisation one. `canAccessMessage`
 * is what stops a stranger reacting to a group they are not in, and the same
 * ack that carries the reaction also carries the userIds of everyone who
 * reacted — so a hole here leaks membership, not just a thumbs-up.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  connectDb, disconnectDb, resetDb, register,
  withSocketServer, connectSocket, type TestUser,
} from './helpers'
import { Conversation } from '../models/Conversation'
import { Message } from '../models/Message'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }

const mkGroup = (owner: TestUser, members: TestUser[]) =>
  Conversation.create({
    type: 'group', owner: owner.id,
    members: [owner.id, ...members.map(m => m.id)],
    lastMessageAt: new Date(),
  })

const mkMessage = (groupId: string, author: TestUser) =>
  Message.create({
    conversationId: groupId, kind: 'group',
    authorId: author.id, authorName: author.username,
    content: 'react to me',
  })

const react = (s: ClientSocket, messageId: string, emoji: string) =>
  new Promise<any>(resolve => s.emit('message:react', { messageId, emoji }, resolve))

describe('group reactions', () => {
  it('a member can react, and the reaction is stored', async () => {
    const a = await register(), b = await register()
    const group = await mkGroup(a, [b])
    const msg = await mkMessage(group._id.toString(), a)

    const sock = track(await connectSocket(sockets.url, b.token))
    const ack = await react(sock, msg._id.toString(), '👍')

    expect(ack.ok).not.toBe(false)
    const stored = await Message.findById(msg._id).lean()
    expect(stored!.reactions).toHaveLength(1)
    expect(stored!.reactions[0].emoji).toBe('👍')
  })

  it('reacting again removes it — the same toggle DMs and channels have', async () => {
    const a = await register(), b = await register()
    const group = await mkGroup(a, [b])
    const msg = await mkMessage(group._id.toString(), a)
    const sock = track(await connectSocket(sockets.url, b.token))

    await react(sock, msg._id.toString(), '👍')
    await react(sock, msg._id.toString(), '👍')

    const stored = await Message.findById(msg._id).lean()
    // The whole entry goes, not an entry with a count of zero — an empty
    // reaction would render as a chip nobody can clear.
    expect(stored!.reactions).toHaveLength(0)
  })

  it('two members stack on one emoji rather than making two entries', async () => {
    const a = await register(), b = await register()
    const group = await mkGroup(a, [b])
    const msg = await mkMessage(group._id.toString(), a)

    await react(track(await connectSocket(sockets.url, a.token)), msg._id.toString(), '👍')
    await react(track(await connectSocket(sockets.url, b.token)), msg._id.toString(), '👍')

    const stored = await Message.findById(msg._id).lean()
    expect(stored!.reactions).toHaveLength(1)
    expect(stored!.reactions[0].userIds).toHaveLength(2)
  })

  it('refuses someone who is not in the group', async () => {
    // The ack carries the userIds of everyone who reacted, so this is a
    // membership leak and not merely an unwanted thumbs-up.
    const a = await register(), b = await register(), stranger = await register()
    const group = await mkGroup(a, [b])
    const msg = await mkMessage(group._id.toString(), a)

    const sock = track(await connectSocket(sockets.url, stranger.token))
    const ack = await react(sock, msg._id.toString(), '👍')

    expect(ack.ok).toBe(false)
    expect(await Message.findById(msg._id).lean().then(m => m!.reactions)).toHaveLength(0)
  })

  it('refuses an oversized emoji field', async () => {
    // The field took arbitrary strings of arbitrary length straight into the
    // document before it was bounded.
    const a = await register()
    const group = await mkGroup(a, [])
    const msg = await mkMessage(group._id.toString(), a)

    const sock = track(await connectSocket(sockets.url, a.token))
    const ack = await react(sock, msg._id.toString(), 'x'.repeat(200))
    expect(ack.ok).toBe(false)
  })
})
