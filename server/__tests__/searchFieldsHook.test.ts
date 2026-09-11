import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth } from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { Friendship } from '../models/Friendship'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: any) => (await app().post('/servers').set(auth(u)).send({ name: 'SF' })).body
const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')
// `words` is left out of reads unless asked for, so ask.
const stored = (id: string) => Message.findById(id).select('+words').lean()

describe('search fields on save', () => {
  it('records links, images and cards on a channel message', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(u)).send({ content: 'pic https://x.io/cat.png and https://app.skycord.xyz/join/Ab12Cd34' })
    const m = await stored(res.body.message._id)
    expect(m!.has).toEqual(['link', 'image', 'embed'])
  })

  it('resolves a mention to the member it names', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(a)).send({ content: `hey <@${b.username}>` })
    const m = await stored(res.body.message._id)
    expect(m!.mentions.map(String)).toEqual([b.id])
  })

  it('resolves nobody for a name that is not a member here', async () => {
    const a = await register(), outsider = await register()
    const { server, channels } = await mkServer(a)
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(a)).send({ content: `hey <@${outsider.username}>` })
    expect((await stored(res.body.message._id))!.mentions).toEqual([])
  })

  it('updates both when a message is edited', async () => {
    const a = await register(), b = await register()
    await Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })
    const sent = await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'plain' })
    const id = sent.body.message._id
    expect((await stored(id))!.has).toEqual([])
    await app().patch(`/messages/${id}`).set(auth(a)).send({ content: `now https://x.io/v.mp4 <@${b.username}>` })
    const m = await stored(id)
    expect(m!.has).toEqual(['link', 'video'])
    expect(m!.mentions.map(String)).toEqual([b.id])
  })

  it('records nothing for a system message', async () => {
    const u = await register()
    const m = await Message.create({
      conversationId: 'x_y', kind: 'system', authorId: u.id, authorName: 'sys',
      content: 'https://x.io/a.png <@someone>', systemType: 'call',
    })
    expect(m.has).toEqual([])
    expect(m.mentions).toEqual([])
    expect(m.words).toEqual([])
  })

  it('records the words of the text, and refreshes them on an edit', async () => {
    const a = await register(), b = await register()
    await Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })
    const sent = await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'Release plan #10' })
    const id = sent.body.message._id
    expect((await stored(id))!.words).toEqual(['release', 'plan', '10'])
    await app().patch(`/messages/${id}`).set(auth(a)).send({ content: 'Café later' })
    expect((await stored(id))!.words).toEqual(['cafe', 'later'])
  })

  it('keeps the words out of everything the API sends', async () => {
    const a = await register(), b = await register()
    await Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })
    const sent = await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'hello there' })
    expect(sent.body.message.words).toBeUndefined()
    const edited = await app().patch(`/messages/${sent.body.message._id}`).set(auth(a)).send({ content: 'hello again' })
    expect(edited.body.message.words).toBeUndefined()
    const history = await app().get(`/messages/dm/${b.id}`).set(auth(a))
    expect(history.body.messages[0].words).toBeUndefined()
  })
})
