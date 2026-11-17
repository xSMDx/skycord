/**
 * Every event the server listens to must survive a payload of the wrong shape.
 *
 * A synchronous throw inside a Socket.IO listener is caught by nothing: it
 * escapes into the event loop and the process exits, dropping every connection
 * on the instance. An async listener that rejects is only logged, but that
 * rests on a process-wide handler rather than on the handler itself.
 *
 * So this checks every registered event, read from the server-side socket
 * itself rather than from a list kept here. A handler added later is covered
 * the moment it exists.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  connectDb, disconnectDb, resetDb, register, withSocketServer, connectSocket, nextEvent,
} from './helpers'
import { getIO, cancelAllCallEnds } from '../sockets/chatSocket'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => {
  open.splice(0).forEach(s => s.disconnect())
  await new Promise(r => setTimeout(r, 50))
  cancelAllCallEnds()
  await resetDb()
})

const track = (s: ClientSocket) => { open.push(s); return s }
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms))

// Names the client is not allowed to emit, plus Socket.IO's own 'error' slot.
const NOT_OURS = new Set(['connect', 'connect_error', 'disconnect', 'disconnecting', 'newListener', 'removeListener', 'error'])
const WRONG_SHAPES: unknown[] = [undefined, null, 'x', 1, [], {}]

/** The events the server registered for this user's socket. */
const registeredEvents = (userId: string): string[] => {
  const io = getIO()
  if (!io) throw new Error('socket server not running')
  const own = [...io.sockets.sockets.values()].find(s => (s as unknown as { userId: string }).userId === userId)
  if (!own) throw new Error('no server-side socket for that user')
  return own.eventNames().map(String).filter(e => !NOT_OURS.has(e))
}

describe('socket payload guard', () => {
  it('no event can take the server down with a payload of the wrong shape', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const events = registeredEvents(a.id)
    // The one that was known to throw, so this cannot pass on an empty list.
    expect(events).toContain('typing:start')

    const escaped: { event: string; err: unknown }[] = []
    let current = ''
    const onEscape = (err: unknown) => { escaped.push({ event: current, err }) }
    process.on('uncaughtException', onEscape)
    process.on('unhandledRejection', onEscape)
    // Handlers log what they refuse; the noise is not what is under test.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const event of events) {
        current = event
        for (const payload of WRONG_SHAPES) {
          if (payload === undefined) aSock.emit(event)
          else aSock.emit(event, payload)
        }
        await settle(40)
      }
      await settle(500)
    } finally {
      process.off('uncaughtException', onEscape)
      process.off('unhandledRejection', onEscape)
      quiet.mockRestore()
    }

    expect(escaped.map(e => `${e.event}: ${String((e.err as Error)?.message ?? e.err)}`)).toEqual([])

    // And the server is still serving: a well-formed event still arrives.
    const typing = nextEvent<{ userId: string }>(bSock, 'typing:start')
    aSock.emit('typing:start', { partnerId: b.id })
    expect((await typing).userId).toBe(a.id)
  })
})
