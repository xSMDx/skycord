/**
 * Adding people to a group that already exists.
 *
 * The same rule as starting one (createGroup): you can only put your own
 * friends in it. Someone who is not your friend joins through an invite link,
 * which they choose to open. Being in a group with someone is also what lets
 * the two of you message each other (canDM), so this rule decides that too.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, auth, befriend, connectDb, disconnectDb, resetDb, register, type TestUser } from './helpers'
import { Conversation } from '../models/Conversation'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

/** A group started through the real endpoint, so it is shaped like a real one. */
const startGroup = async (owner: TestUser, members: TestUser[]): Promise<string> => {
  for (const m of members) await befriend(owner, m)
  const res = await app().post('/conversations/groups').set(auth(owner)).send({ memberIds: members.map(m => m.id) })
  if (res.status !== 201) throw new Error(`group create failed: ${res.status} ${res.text}`)
  return res.body.group.id
}

const add = (who: TestUser, groupId: string, memberIds: unknown) =>
  app().post(`/conversations/groups/${groupId}/members`).set(auth(who)).send({ memberIds })

const membersOf = async (groupId: string): Promise<string[]> =>
  ((await Conversation.findById(groupId).lean())?.members ?? []).map(String)

describe('adding people to a group', () => {
  it('a member cannot add someone who is not their friend', async () => {
    const owner = await register(), friend = await register(), stranger = await register()
    const groupId = await startGroup(owner, [friend])

    const res = await add(owner, groupId, [stranger.id])

    expect(res.status).toBe(403)
    expect(await membersOf(groupId)).not.toContain(stranger.id)
  })

  it('one stranger in the list stops the whole add', async () => {
    const owner = await register(), friend = await register(), friend2 = await register(), stranger = await register()
    const groupId = await startGroup(owner, [friend])
    await befriend(owner, friend2)

    const res = await add(owner, groupId, [friend2.id, stranger.id])

    expect(res.status).toBe(403)
    const members = await membersOf(groupId)
    expect(members).not.toContain(friend2.id)
    expect(members).not.toContain(stranger.id)
  })

  it('a friend can still be added', async () => {
    const owner = await register(), friend = await register(), friend2 = await register()
    const groupId = await startGroup(owner, [friend])
    await befriend(owner, friend2)

    const res = await add(owner, groupId, [friend2.id])

    expect(res.status).toBe(200)
    expect(await membersOf(groupId)).toContain(friend2.id)
  })

  it("it is the adder's friends that count, not the owner's", async () => {
    const owner = await register(), member = await register(), membersFriend = await register()
    const groupId = await startGroup(owner, [member])
    await befriend(member, membersFriend)

    expect((await add(member, groupId, [membersFriend.id])).status).toBe(200)

    const ownersOnlyFriend = await register()
    await befriend(owner, ownersOnlyFriend)
    expect((await add(member, groupId, [ownersOnlyFriend.id])).status).toBe(403)
  })

  it('an id that is not a user id is refused, not a server error', async () => {
    const owner = await register(), friend = await register()
    const groupId = await startGroup(owner, [friend])

    for (const bad of [['not-an-id'], [42], [null], [{ $ne: null }]]) {
      expect((await add(owner, groupId, bad)).status, JSON.stringify(bad)).toBe(400)
    }
  })

  it('the same friend listed twice is added once', async () => {
    const owner = await register(), friend = await register(), friend2 = await register()
    const groupId = await startGroup(owner, [friend])
    await befriend(owner, friend2)

    expect((await add(owner, groupId, [friend2.id, friend2.id])).status).toBe(200)
    expect((await membersOf(groupId)).filter(id => id === friend2.id)).toHaveLength(1)
  })
})
