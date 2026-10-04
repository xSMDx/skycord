/**
 * An id that is not an id is the caller's mistake, not the server's. Before,
 * Mongoose's CastError fell through to the catch-all: a 500, and an
 * "[Unhandled]" stack in the log for every malformed URL anyone sent.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import mongoose from 'mongoose'
import { app, connectDb, disconnectDb, resetDb, register, auth } from './helpers'
import { errorHandler } from '../middleware/errorHandler'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

describe('a malformed id', () => {
  it('accepting a friend request by a non-id is a 400, not a 500', async () => {
    const u = await register()
    const res = await app().patch('/users/friends/accept/undefined').set(auth(u))
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid id')
  })

  it('the handler answers any ObjectId cast failure with 400, and logs nothing', () => {
    const err = new mongoose.Error.CastError('ObjectId', 'nope', '_id')
    const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    errorHandler(err, {} as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid id' })
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('a cast failure on something other than an id is still a server error', () => {
    const err = new mongoose.Error.CastError('Number', 'abc', 'position')
    const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    errorHandler(err, {} as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    log.mockRestore()
  })
})
