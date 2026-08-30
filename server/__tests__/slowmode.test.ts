/**
 * Slowmode enforcement.
 *
 * The setting existed, validated, persisted and displayed for a whole release
 * without anything ever reading it on send — so these tests are about the one
 * thing that was missing: that it actually stops a message.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { Types } from 'mongoose'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

const textOf = (srv: any) => srv.channels.find((c: any) => c.type === 'text')

const send = (u: TestUser, sid: string, cid: string, content = 'hello') =>
  app().post(`/servers/${sid}/channels/${cid}/messages`).set(auth(u)).send({ content })

const setSlowmode = (u: TestUser, sid: string, cid: string, slowmode: number) =>
  app().patch(`/servers/${sid}/channels/${cid}`).set(auth(u)).send({ slowmode })

/** A member who is not the owner — the only person slowmode applies to. */
const withMember = async () => {
  const owner = await register(), member = await register()
  const srv = await mkServer(owner)
  await Server.updateOne({ _id: srv.server.id }, { $push: { members: member.id } })
  return { owner, member, sid: srv.server.id, cid: textOf(srv).id }
}

describe('slowmode', () => {
  it('lets a second message through when slowmode is off', async () => {
    const { member, sid, cid } = await withMember()
    expect((await send(member, sid, cid)).status).toBe(201)
    expect((await send(member, sid, cid)).status).toBe(201)
  })

  it('blocks a second message inside the window', async () => {
    const { owner, member, sid, cid } = await withMember()
    await setSlowmode(owner, sid, cid, 30)

    expect((await send(member, sid, cid)).status).toBe(201)
    const second = await send(member, sid, cid)
    expect(second.status).toBe(429)
    // The client counts down from this rather than from its own clock.
    expect(second.body.retryAfter).toBeGreaterThan(0)
    expect(second.body.retryAfter).toBeLessThanOrEqual(30)
  })

  it('does not store the message it refused', async () => {
    // A 429 that still wrote the row would be worse than no slowmode at all.
    const { owner, member, sid, cid } = await withMember()
    await setSlowmode(owner, sid, cid, 30)
    await send(member, sid, cid, 'first')
    await send(member, sid, cid, 'second')
    expect(await Message.countDocuments({ conversationId: cid })).toBe(1)
  })

  it('exempts the owner', async () => {
    const { owner, sid, cid } = await withMember()
    await setSlowmode(owner, sid, cid, 30)
    expect((await send(owner, sid, cid)).status).toBe(201)
    expect((await send(owner, sid, cid)).status).toBe(201)
  })

  it('is per person, not per channel', async () => {
    // One member's message must not start everyone else's clock.
    const { owner, member, sid, cid } = await withMember()
    const other = await register()
    await Server.updateOne({ _id: sid }, { $push: { members: other.id } })
    await setSlowmode(owner, sid, cid, 30)

    expect((await send(member, sid, cid)).status).toBe(201)
    expect((await send(other, sid, cid)).status).toBe(201)
  })

  it('is per channel, not per server', async () => {
    const { owner, member, sid } = await withMember()
    const a = (await app().post(`/servers/${sid}/channels`).set(auth(owner))
      .send({ name: 'a', type: 'text' })).body.channel
    const b = (await app().post(`/servers/${sid}/channels`).set(auth(owner))
      .send({ name: 'b', type: 'text' })).body.channel
    await setSlowmode(owner, sid, a.id, 30)

    expect((await send(member, sid, a.id)).status).toBe(201)
    // b has no slowmode of its own; a's clock must not reach into it.
    expect((await send(member, sid, b.id)).status).toBe(201)
  })

  it('lets the message through once the window has passed', async () => {
    const { owner, member, sid, cid } = await withMember()
    await setSlowmode(owner, sid, cid, 5)
    const first = await send(member, sid, cid)
    expect(first.status).toBe(201)

    // Backdated rather than slept: the rule is about elapsed time, and waiting
    // five real seconds in a test proves nothing extra.
    //
    // Through the native collection, not the model: Mongoose marks `createdAt`
    // immutable on a timestamped schema and silently DROPS a $set on it, so
    // the model call appears to succeed while changing nothing.
    await Message.collection.updateOne(
      { _id: new Types.ObjectId(String(first.body.message._id)) },
      { $set: { createdAt: new Date(Date.now() - 6000) } })
    expect((await send(member, sid, cid)).status).toBe(201)
  })

  it('turning slowmode off releases people immediately', async () => {
    const { owner, member, sid, cid } = await withMember()
    await setSlowmode(owner, sid, cid, 60)
    await send(member, sid, cid)
    expect((await send(member, sid, cid)).status).toBe(429)

    await setSlowmode(owner, sid, cid, 0)
    expect((await send(member, sid, cid)).status).toBe(201)
  })
})
