import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { connectDb, disconnectDb, resetDb } from './helpers'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { PERMISSIONS, ALL_PERMISSIONS, parseOverwrites, resolveChannel, has } from '../permissions'

/**
 * Storage for overwrites.
 *
 * channelPermissions.test.ts proves the algorithm; this proves the data
 * survives a round trip through Mongo and comes back in the shape the
 * algorithm expects. The gap between the two is where a working function
 * quietly reads nothing.
 */

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const oid = () => new mongoose.Types.ObjectId()

const mkChannel = (over: Record<string, unknown> = {}) =>
  Channel.create({ server: oid(), name: 'general', type: 'text', ...over })

describe('defaults', () => {
  it('gives a channel no overwrites, which means "follow my category"', async () => {
    const c = await mkChannel()
    expect(c.overwrites).toEqual([])
  })

  it('hides a denied channel by default', async () => {
    // The safer of the two, and the reference's behaviour: a name is itself
    // information, so leaking it has to be the opt-in.
    const c = await mkChannel()
    expect(c.hideWhenDenied).toBe(true)
  })

  it('gives a category no overwrites either', async () => {
    const cat = await Category.create({ server: oid(), name: 'Text Channels' })
    expect(cat.overwrites).toEqual([])
  })

  it('leaves every channel that existed before this field untouched', async () => {
    // Written straight through the driver, bypassing defaults, the way a row
    // created before the field existed looks.
    const id = oid()
    await Channel.collection.insertOne({
      _id: id, server: oid(), name: 'old', type: 'text', position: 0, category: null,
    } as never)
    const c = await Channel.findById(id)
    // Absent reads as empty and as hidden-by-default, so nothing needs
    // migrating and an old channel behaves exactly as it did.
    expect(parseOverwrites(c!.overwrites)).toEqual([])
    expect(c!.hideWhenDenied ?? true).toBe(true)
  })
})

describe('round trip', () => {
  it('stores and returns an overwrite the resolver can read', async () => {
    const roleId = oid()
    const c = await mkChannel({
      overwrites: [{
        id: roleId, type: 'role',
        allow: PERMISSIONS.Connect.toString(),
        deny:  PERMISSIONS.ViewChannels.toString(),
      }],
    })

    const fresh = await Channel.findById(c._id)
    const parsed = parseOverwrites(fresh!.overwrites)
    expect(parsed).toHaveLength(1)
    // The id arrives as an ObjectId and must come out as a comparable string —
    // resolveChannel matches role ids by ===, so a stray ObjectId here would
    // silently match nothing and every overwrite would be ignored.
    expect(typeof parsed[0].id).toBe('string')
    expect(parsed[0].id).toBe(roleId.toString())
    expect(parsed[0].allow).toBe(PERMISSIONS.Connect)
    expect(parsed[0].deny).toBe(PERMISSIONS.ViewChannels)
  })

  it('survives the full bitfield, where a Number would lose precision', async () => {
    const c = await mkChannel({
      overwrites: [{ id: oid(), type: 'role', allow: ALL_PERMISSIONS.toString(), deny: '0' }],
    })
    const fresh = await Channel.findById(c._id)
    expect(parseOverwrites(fresh!.overwrites)[0].allow).toBe(ALL_PERMISSIONS)
  })

  it('rejects an overwrite that is neither a role nor a member', async () => {
    // The enum is the only thing stopping a typo becoming a layer the resolver
    // skips without complaint.
    await expect(mkChannel({
      overwrites: [{ id: oid(), type: 'group', allow: '0', deny: '0' }],
    })).rejects.toThrow()
  })
})

describe('stored data drives the resolver', () => {
  it('locks a voice channel end to end, from the database', async () => {
    const everyone = oid()
    const staff = oid()
    const locked = PERMISSIONS.ViewChannels | PERMISSIONS.Connect

    const cat = await Category.create({
      server: oid(), name: 'Staff',
      overwrites: [{ id: everyone, type: 'role', allow: '0', deny: locked.toString() }],
    })
    const chan = await mkChannel({
      type: 'voice',
      overwrites: [{ id: staff, type: 'role', allow: locked.toString(), deny: '0' }],
    })

    const layers = [
      parseOverwrites((await Category.findById(cat._id))!.overwrites),
      parseOverwrites((await Channel.findById(chan._id))!.overwrites),
    ]
    const base = {
      isOwner: false,
      userId: 'u1',
      everyoneRoleId: everyone.toString(),
      roleBits: [PERMISSIONS.ViewChannels | PERMISSIONS.Connect | PERMISSIONS.SendMessages],
      layers,
    }

    const outsider = resolveChannel({ ...base, roleIds: [] })
    expect(has(outsider, 'ViewChannels')).toBe(false)
    expect(has(outsider, 'Connect')).toBe(false)

    const insider = resolveChannel({ ...base, roleIds: [staff.toString()] })
    expect(has(insider, 'ViewChannels')).toBe(true)
    expect(has(insider, 'Connect')).toBe(true)
  })
})
