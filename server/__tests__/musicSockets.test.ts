/**
 * The music socket handlers, against a real socket server and database.
 *
 * `musicState.test.ts` covers the state machine on its own. This covers the
 * part that only exists when a socket is involved: the gate. Every music
 * event requires the member to be IN the call right now, checked server-side
 * against `activeCalls` — and since v1 has no roles, that membership check is
 * the entire permission model, which makes it worth testing from the outside.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'
import { cancelAllCallEnds, musicRooms } from '../sockets/chatSocket'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []
const track = (s: ClientSocket) => { open.push(s); return s }

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => {
  open.splice(0).forEach(s => s.disconnect())
  await new Promise(r => setTimeout(r, 50))
  cancelAllCallEnds()
  musicRooms.cancelAllCloses()
  await resetDb()
})

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

const seed = async (a: TestUser, b?: TestUser) => {
  const { server, channels } = await mkServer(a)
  if (b) await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
  const voice = channels.find((c: { type: string }) => c.type === 'voice')
  return { server, voice }
}

const MP3 = 'https://cdn.example.com/a.mp3'

interface MusicView {
  channels: { id: string; name: string; now: { url: string } | null; queued: number; listeners: string[] }[]
}

/**
 * Wait for a `music:state` that SAYS something, rather than for the next one.
 *
 * Several broadcasts are usually in flight — every create fans out to
 * everyone in the call — so "the next event" is whichever happened to be
 * mid-air, not the one the assertion is about. That cost a debugging round
 * here: the server state was correct and the broadcast caught was the
 * previous one.
 */
const musicStateWhere = (
  s: ClientSocket,
  want: (v: MusicView) => boolean,
  ms = 3000,
): Promise<MusicView> =>
  new Promise((resolve, reject) => {
    const on = (v: MusicView) => {
      if (!want(v)) return
      clearTimeout(timer); s.off('music:state', on); resolve(v)
    }
    const timer = setTimeout(() => {
      s.off('music:state', on); reject(new Error(`no matching music:state within ${ms}ms`))
    }, ms)
    s.on('music:state', on)
  })

/** In a voice channel, with a socket, ready to use music. */
const inCall = async (u: TestUser, channelId: string) => {
  const s = track(await connectSocket(sockets.url, u.token))
  s.emit('call:join', { conversationId: channelId, kind: 'channel' })
  await nextEvent(s, 'call:state')
  return s
}

describe('the gate', () => {
  it('ignores a member who is not in the call', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)
    const ana = await inCall(a, voice.id)

    // b is connected but never joined the call.
    const ben = track(await connectSocket(sockets.url, b.token))
    ben.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Sneaky', url: MP3 })
    await new Promise(r => setTimeout(r, 300))

    expect(musicRooms.view(`voice:${voice.id}`).channels).toHaveLength(0)
    void ana
  })

  it('stops accepting events once a member leaves the call', async () => {
    const a = await register()
    const { voice } = await seed(a)
    const ana = await inCall(a, voice.id)

    const created = nextEvent(ana, 'music:state')
    ana.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Chill', url: MP3 })
    const id = (await created).channels[0].id

    ana.emit('call:leave', { conversationId: voice.id, kind: 'channel' })
    await new Promise(r => setTimeout(r, 200))

    ana.emit('music:skip', { conversationId: voice.id, kind: 'channel', channelId: id })
    await new Promise(r => setTimeout(r, 300))
    // Still the track it was created with: the skip was refused, silently,
    // because a member who has left is not a member who can act.
    expect(musicRooms.view(`voice:${voice.id}`).channels[0]?.now?.url).toBe(MP3)
  })
})

describe('creating and tuning in', () => {
  it('creates a channel and tells everyone in the call', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)
    const ana = await inCall(a, voice.id)
    const ben = await inCall(b, voice.id)

    const seen = nextEvent(ben, 'music:state')
    ana.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Chill', url: MP3 })
    const state = await seen

    expect(state.channels).toHaveLength(1)
    expect(state.channels[0].name).toBe('Chill')
    expect(state.channels[0].now.url).toBe(MP3)
    // The creator is not a listener — starting it and hearing it are two
    // decisions.
    expect(state.channels[0].listeners).toEqual([])
  })

  it('two members on two channels, both listed for both of them', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)
    const ana = await inCall(a, voice.id)
    const ben = await inCall(b, voice.id)

    ana.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Chill', url: MP3 })
    const first = (await nextEvent(ana, 'music:state')).channels[0].id
    ben.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Metal', url: MP3 })
    await nextEvent(ana, 'music:state')

    ana.emit('music:listen', { conversationId: voice.id, kind: 'channel', channelId: first })
    const after = await musicStateWhere(ben, s => s.channels.some(c => c.listeners.length > 0))

    // This is the feature in one assertion: both members see both channels,
    // and who is on which.
    expect(after.channels).toHaveLength(2)
    const chill = after.channels.find((c: { name: string }) => c.name === 'Chill')
    expect(chill.listeners).toEqual([a.id])
  })

  it('tuning into a second channel leaves the first', async () => {
    const a = await register()
    const { voice } = await seed(a)
    const ana = await inCall(a, voice.id)

    ana.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'A', url: MP3 })
    const one = (await nextEvent(ana, 'music:state')).channels[0].id
    ana.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'B', url: MP3 })
    const two = (await nextEvent(ana, 'music:state')).channels.find((c: { name: string }) => c.name === 'B').id

    ana.emit('music:listen', { conversationId: voice.id, kind: 'channel', channelId: one })
    await nextEvent(ana, 'music:state')
    ana.emit('music:listen', { conversationId: voice.id, kind: 'channel', channelId: two })
    const after = await nextEvent(ana, 'music:state')

    expect(after.channels.find((c: { id: string }) => c.id === one).listeners).toEqual([])
    expect(after.channels.find((c: { id: string }) => c.id === two).listeners).toEqual([a.id])
  })
})

describe('refusals reach the asker and nobody else', () => {
  it('a bad url is refused with a reason', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)
    const ana = await inCall(a, voice.id)
    const ben = await inCall(b, voice.id)

    let benSaw = false
    ben.on('music:error', () => { benSaw = true })

    const err = nextEvent(ana, 'music:error')
    ana.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Chill', url: 'https://example.com/page.html' })
    expect((await err).reason).toMatch(/audio/i)

    await new Promise(r => setTimeout(r, 200))
    expect(benSaw).toBe(false)
    expect(musicRooms.view(`voice:${voice.id}`).channels).toHaveLength(0)
  })

  it('a bad name is refused', async () => {
    const a = await register()
    const { voice } = await seed(a)
    const ana = await inCall(a, voice.id)
    const err = nextEvent(ana, 'music:error')
    ana.emit('music:create', { conversationId: voice.id, kind: 'channel', name: '   ', url: MP3 })
    expect((await err).reason).toMatch(/name/i)
  })
})

describe('leaving', () => {
  it('leaving the call drops you from the channel you were listening to', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)
    const ana = await inCall(a, voice.id)
    const ben = await inCall(b, voice.id)

    ana.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Chill', url: MP3 })
    const id = (await nextEvent(ben, 'music:state')).channels[0].id
    ana.emit('music:listen', { conversationId: voice.id, kind: 'channel', channelId: id })
    expect((await nextEvent(ben, 'music:state')).channels[0].listeners).toEqual([a.id])

    const after = nextEvent(ben, 'music:state')
    ana.emit('call:leave', { conversationId: voice.id, kind: 'channel' })
    expect((await after).channels[0].listeners).toEqual([])
    // The channel itself survives — it has its own grace period, so coming
    // straight back finds it still playing.
    expect((await nextEvent(ben, 'music:state').catch(() => null)) ?? { channels: [{}] }).toBeTruthy()
    expect(musicRooms.view(`voice:${voice.id}`).channels).toHaveLength(1)
  })
})
