/**
 * Test harness. Talks to the Docker Mongo used for development, on a separate
 * `sykord_test` database, so nothing here can touch real data.
 */
import http from 'http'
import mongoose from 'mongoose'
import request from 'supertest'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createApp } from '../app'
import { initSocket } from '../sockets/chatSocket'

const TEST_URI =
  process.env.TEST_MONGO_URI ??
  'mongodb://localhost:27017/sykord_test?authSource=admin'

export const connectDb = async (): Promise<void> => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(TEST_URI)
}

export const disconnectDb = async (): Promise<void> => {
  await mongoose.connection.close()
}

/** Wipe every collection between tests so ordering can never matter. */
export const resetDb = async (): Promise<void> => {
  const cols = await mongoose.connection.db!.collections()
  await Promise.all(cols.map(c => c.deleteMany({})))
}

export const app = () => request(createApp())

let seq = 0
export interface TestUser { token: string; id: string; username: string }

/** Registers a real account through the real endpoint and returns its token. */
export const register = async (name?: string): Promise<TestUser> => {
  const username = name ?? `t${Date.now()}${seq++}`
  const res = await app()
    .post('/auth/register')
    .send({
      username,
      email: `${username}@test.local`,
      password: 'TestPass123!',
      displayName: username,
    })
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`)
  return { token: res.body.accessToken, id: res.body.user.id, username }
}

/** Authorization header for a test user. */
export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` })

/**
 * A real HTTP server with the real socket layer attached, on an OS-assigned
 * port. Tests drive actual websockets rather than asserting on mocks.
 */
export const withSocketServer = async (): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = http.createServer(createApp())
  const io = initSocket(server)
  await new Promise<void>(r => server.listen(0, r))
  const { port } = server.address() as import('net').AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    // io.close() forcibly disconnects every still-open client BEFORE closing
    // the underlying HTTP server. Plain server.close() only stops accepting
    // new connections and waits for existing ones to end on their own — a
    // still-open websocket (nothing in a test necessarily disconnects the
    // last client it opened) means that wait never finishes and the suite
    // hangs.
    //
    // The forced disconnects fire each server-side "disconnect" handler,
    // which does its own async work (chatSocket.ts writes lastSeenAt via
    // mongoose) that io.close()'s callback does not wait for. Without a
    // short grace tick here, a caller that immediately closes the Mongo
    // connection afterwards (as disconnectDb() does) can race that write
    // and surface an unhandled MongoClientClosedError instead of a clean exit.
    close: () => new Promise<void>(r => { io.close(() => setTimeout(r, 100)) }),
  }
}

/** Connects an authenticated client and resolves once it is actually connected. */
export const connectSocket = (url: string, token: string): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const s = ioClient(url, { auth: { token }, transports: ['websocket'], forceNew: true })
    s.on('connect', () => resolve(s))
    s.on('connect_error', reject)
  })

/** Resolves with the next payload for `name`, or rejects if it never arrives. */
export const nextEvent = <T = any>(s: ClientSocket, name: string, ms = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${name}" within ${ms}ms`)), ms)
    s.once(name, (p: T) => { clearTimeout(timer); resolve(p) })
  })
