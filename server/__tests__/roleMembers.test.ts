import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'

/**
 * Who holds which role — the data behind the Roles page's Members tab.
 *
 * Assigning roles has worked since v0.17.0; what was missing was any way for a
 * client to SEE the assignments. The member list now carries each member's role
 * ids, and the `member:roles` event carries the rank that goes with them. Both
 * are tested here because the client trusts both.
 */

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'RM' })).body.server
const join = (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })
const mkRole = async (u: TestUser, sid: string, name: string) =>
  (await app().post(`/servers/${sid}/roles`).set(auth(u)).send({ name })).body.role
const listMembers = async (u: TestUser, sid: string) =>
  (await app().get(`/servers/${sid}/members`).set(auth(u))).body.members as any[]
const setRoles = (u: TestUser, sid: string, uid: string, roles: string[]) =>
  app().put(`/servers/${sid}/members/${uid}/roles`).set(auth(u)).send({ roles })

describe('GET /servers/:sid/members — roles', () => {
  it('lists the roles each member holds', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await join(server.id, member.id)
    const role = await mkRole(owner, server.id, 'mods')

    expect((await setRoles(owner, server.id, member.id, [role.id])).status).toBe(200)

    const members = await listMembers(owner, server.id)
    expect(members.find(m => m.id === member.id).roles).toEqual([role.id])
    expect(members.find(m => m.id === owner.id).roles).toEqual([])
  })

  it('never lists @everyone, which every member holds implicitly', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    const everyone = (await app().get(`/servers/${server.id}/roles`).set(auth(owner))).body.roles
      .find((r: any) => r.isEveryone)

    const members = await listMembers(owner, server.id)
    for (const m of members) expect(m.roles).not.toContain(everyone.id)
  })

  it('leaves out an id whose role no longer exists', async () => {
    // Deleting a role does not rewrite every member's side-car entry, so a
    // stored id can outlive its role. Sending it would put a phantom into the
    // client that no role row could ever explain.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await join(server.id, member.id)
    const role = await mkRole(owner, server.id, 'real')
    await setRoles(owner, server.id, member.id, [role.id])

    await Server.updateOne(
      { _id: server.id, 'memberRoles.user': member.id },
      { $push: { 'memberRoles.$.roles': new Types.ObjectId() } },
    )

    const members = await listMembers(owner, server.id)
    expect(members.find(m => m.id === member.id).roles).toEqual([role.id])
  })

  it('is visible to an ordinary member, not only to moderators', async () => {
    // Role membership is public inside a server — the same thing Discord shows
    // on every profile. The Members tab reads it for anyone who can open Roles.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await join(server.id, member.id)
    const role = await mkRole(owner, server.id, 'visible')
    await setRoles(owner, server.id, member.id, [role.id])

    const members = await listMembers(member, server.id)
    expect(members.find(m => m.id === member.id).roles).toEqual([role.id])
  })
})

describe('PUT /servers/:sid/members/:uid/roles — rank', () => {
  it('answers with the rank the new roles give', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await join(server.id, member.id)
    const role = await mkRole(owner, server.id, 'ranked')

    const res = await setRoles(owner, server.id, member.id, [role.id])
    expect(res.body.highestPosition).toBe(role.position)
  })

  it('answers -1 once the last role is taken away', async () => {
    // -1, not 0: @everyone sits at 0 and every rank comparison is strictly
    // greater-than, so somebody holding nothing must not tie with everyone.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await join(server.id, member.id)
    const role = await mkRole(owner, server.id, 'temporary')
    await setRoles(owner, server.id, member.id, [role.id])

    const res = await setRoles(owner, server.id, member.id, [])
    expect(res.body.roles).toEqual([])
    expect(res.body.highestPosition).toBe(-1)
  })
})

describe('member:roles', () => {
  it('reaches the rest of the server with the rank included', async () => {
    // The client listens for this now. Without the rank it would hold a member's
    // new roles beside their OLD rank, and gate moderation rows on the wrong one.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await join(server.id, member.id)
    const role = await mkRole(owner, server.id, 'announced')

    const sock = track(await connectSocket(sockets.url, member.token))
    const received = nextEvent<any>(sock, 'member:roles')
    await setRoles(owner, server.id, member.id, [role.id])

    const payload = await received
    expect(payload).toMatchObject({
      serverId: server.id, userId: member.id, roles: [role.id], highestPosition: role.position,
    })
  })
})
