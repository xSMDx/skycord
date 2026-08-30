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
export interface TestUser { token: string; id: string; username: string; email: string; password: string }

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
  // email and password returned too: anything testing login, password change or
  // reset needs the credentials this helper just made up.
  return { token: res.body.accessToken, id: res.body.user.id, username,
           email: `${username}@test.local`, password: 'TestPass123!' }
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
    // mongoose). That handler now wraps its body in try/catch, so a write
    // racing disconnectDb()'s connection close is caught and logged instead
    // of escaping as an unhandled MongoClientClosedError — no grace tick
    // needed here anymore.
    close: () => new Promise<void>(r => { io.close(() => r()) }),
  }
}

/**
 * Connects and resolves the instant the handshake completes, before the
 * server has finished its setup.
 *
 * Only for tests that must have a listener attached while setup is still
 * running — the reconnect catch-up replays in-progress calls from inside the
 * connect handler, so a helper that waits until setup is done would miss it.
 * Everything else wants `connectSocket`.
 */
export const connectSocketRaw = (url: string, token: string): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const c = ioClient(url, { auth: { token }, transports: ['websocket'], forceNew: true })
    c.on('connect', () => resolve(c))
    c.on('connect_error', reject)
  })
/**
 * Connects an authenticated client and resolves once the SERVER has finished
 * setting that connection up — not merely once the handshake completed.
 *
 * The distinction is the whole point. The client's 'connect' fires at the
 * handshake, but chatSocket then does several awaited round-trips before it
 * joins the socket to its `user:`, `group:` and `chan:` rooms. A test that
 * resolves on the handshake and immediately emits can therefore land BEFORE
 * the socket is in the room it is about to be tested on, and the expected
 * broadcast goes nowhere.
 *
 * That race made the suite fail roughly one run in ten — twice in a single
 * session — and a suite that cries wolf costs more than the bug it hides,
 * because the next real failure gets re-run instead of read.
 *
 * A settle rather than a signal: the server emits nothing that marks "setup
 * done", and inventing an event solely for the tests would put a fiction on
 * the wire. If that changes, await the real signal here and delete the wait.
 *
 * Use `connectSocketRaw` instead when the test needs to observe an event the
 * server emits DURING setup — the call catch-up, for one. Waiting past setup
 * means waiting past the very thing under test.
 */
export const connectSocket = async (url: string, token: string): Promise<ClientSocket> => {
  const s = await new Promise<ClientSocket>((resolve, reject) => {
    const c = ioClient(url, { auth: { token }, transports: ['websocket'], forceNew: true })
    c.on('connect', () => resolve(c))
    c.on('connect_error', reject)
  })
  await new Promise(r => setTimeout(r, 350))
  return s
}

/** Resolves with the next payload for `name`, or rejects if it never arrives. */
export const nextEvent = <T = any>(s: ClientSocket, name: string, ms = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${name}" within ${ms}ms`)), ms)
    s.once(name, (p: T) => { clearTimeout(timer); resolve(p) })
  })
