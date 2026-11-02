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
import { Types } from 'mongoose'
import { Readable } from 'stream'
import http from 'http'
import type { AddressInfo } from 'net'
import { Server } from '../models/Server'
import { Track } from '../models/Track'
import { trackStore } from '../utils/trackStore'
import { config } from '../config/env'
import { forgetMusicCapabilities } from '../utils/musicService'
import { cancelAllCallEnds, musicRooms, musicTrackEnded } from '../sockets/chatSocket'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []
const track = (s: ClientSocket) => { open.push(s); return s }

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => {
  open.splice(0).forEach(s => s.disconnect())
  await new Promise(r => setTimeout(r, 50))
  cancelAllCallEnds()
  // Not just the pending closes: the channels themselves, or they count
  // against the instance-wide cap for every test after the one that made
  // them.
  musicRooms.clearAll()
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

/**
 * Join a voice channel with a socket that is already connected, and wait until
 * the join has finished talking.
 *
 * A join answers twice, back to back: `call:state` to everyone, then the
 * newcomer's own `music:state`. Resolving on the first left the second in
 * flight, and the next `nextEvent(s, 'music:state')` in a test caught THAT --
 * the join's empty list, not the change the test had just made. Both are
 * awaited here, registered before the emit so neither can be missed.
 */
const joinCall = async (s: ClientSocket, channelId: string) => {
  const call  = nextEvent(s, 'call:state')
  const music = nextEvent(s, 'music:state')
  s.emit('call:join', { conversationId: channelId, kind: 'channel' })
  await Promise.all([call, music])
  return s
}

/** In a voice channel, with a socket, ready to use music. */
const inCall = async (u: TestUser, channelId: string) =>
  joinCall(track(await connectSocket(sockets.url, u.token)), channelId)

describe('the join helper', () => {
  it("leaves nothing of the join's own in flight when it returns", async () => {
    // A join answers twice, back to back: call:state, then the newcomer's own
    // music:state. The second is easy to catch by accident as "the next
    // music:state" in a test that has just changed something. To make the gap
    // between the two deterministic, this client delivers music:state late
    // -- which is all a slow link or a split packet does on a bad run.
    const a = await register()
    const { voice } = await seed(a)
    const s = track(await connectSocket(sockets.url, a.token))
    const deliver = (s as any).onevent.bind(s)
    ;(s as any).onevent = (packet: { data: unknown[] }) =>
      packet.data[0] === 'music:state' ? void setTimeout(() => deliver(packet), 60) : deliver(packet)

    await joinCall(s, voice.id)

    const stray: unknown[] = []
    s.on('music:state', v => stray.push(v))
    await new Promise(r => setTimeout(r, 200))
    expect(stray).toEqual([])
  })
})

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

describe('library tracks', () => {
  // A library track travels as an id, never as a URL: the server checks the
  // caller owns it and the service composes the address itself. The checks
  // below are the ownership half, which is the only thing standing between
  // a guessed id and somebody else's file playing to a room.
  const giveTrack = async (owner: TestUser, title = 'Blue Monday') => {
    const ownerId = new Types.ObjectId(owner.id)
    const stored = await trackStore.put(Readable.from([Buffer.from('bytes')]), {
      ownerId, mimeType: 'audio/webm',
    })
    const doc = await Track.create({
      ownerId, title, artist: 'New Order', album: 'PCL',
      durationSec: 270, bytes: stored.bytes, store: stored.ref,
      source: 'upload', scan: 'skipped',
    })
    return String(doc._id)
  }

  it('starts a channel from a track you own, and shows its title', async () => {
    const a = await register()
    const { voice } = await seed(a)
    const sa = await inCall(a, voice.id)
    const id = await giveTrack(a, 'Temporary Secretary')

    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Chill', trackId: id })
    const v = await musicStateWhere(sa, x => x.channels.length === 1)

    expect(v.channels[0].name).toBe('Chill')
    // The client renders this; a bare link has no title and a library track
    // should never need one looked up.
    expect(v.channels[0].now?.title).toBe('Temporary Secretary')
    // And no URL leaks into the room for a library track.
    expect(v.channels[0].now?.url).toBeNull()
  })

  it('refuses a track belonging to somebody else', async () => {
    const a = await register()
    const b = await register()
    const { voice } = await seed(a, b)
    const sb = await inCall(b, voice.id)
    const theirs = await giveTrack(a, 'Private')

    sb.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Nope', trackId: theirs })
    const err = await nextEvent(sb, 'music:error') as { reason: string }
    expect(err.reason).toMatch(/no such track/i)
    expect(musicRooms.channelsHere(`voice:${voice.id}`)).toBe(0)
  })

  it('says the same thing for a track that does not exist', async () => {
    // Otherwise this is a way to find out which ids are real.
    const a = await register()
    const { voice } = await seed(a)
    const sa = await inCall(a, voice.id)

    sa.emit('music:create', {
      conversationId: voice.id, kind: 'channel', name: 'Nope',
      trackId: new Types.ObjectId().toHexString(),
    })
    const err = await nextEvent(sa, 'music:error') as { reason: string }
    expect(err.reason).toMatch(/no such track/i)
  })

  it('refuses an id that is not an id, without asking the database', async () => {
    const a = await register()
    const { voice } = await seed(a)
    const sa = await inCall(a, voice.id)

    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Nope', trackId: 'drop table' })
    const err = await nextEvent(sa, 'music:error') as { reason: string }
    expect(err.reason).toMatch(/no such track/i)
  })

  it('queues a library track behind a link, and keeps both kinds straight', async () => {
    const a = await register()
    const { voice } = await seed(a)
    const sa = await inCall(a, voice.id)
    const id = await giveTrack(a, 'Second')

    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Mix', url: MP3 })
    const made = await musicStateWhere(sa, x => x.channels.length === 1)
    const ch = made.channels[0].id

    sa.emit('music:queue', { conversationId: voice.id, kind: 'channel', channelId: ch, trackId: id })
    const queued = await musicStateWhere(sa, x => x.channels[0]?.queued === 1)
    expect(queued.channels[0].now?.url).toBe(MP3)

    // Skipping advances onto the library track — the branch that decides
    // whether to send a URL or an id runs again here, and used to exist in
    // three copies.
    sa.emit('music:skip', { conversationId: voice.id, kind: 'channel', channelId: ch })
    const next = await musicStateWhere(sa, x => x.channels[0]?.now?.title === 'Second')
    expect(next.channels[0].now?.url).toBeNull()
    expect(next.channels[0].queued).toBe(0)
  })

  it('advances the queue when a track ends on its own', async () => {
    // What the service reports over the internal endpoint. The same branch
    // again, reached from the other direction.
    const a = await register()
    const { voice } = await seed(a)
    const sa = await inCall(a, voice.id)
    const id = await giveTrack(a, 'Up Next')

    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Mix', url: MP3 })
    const made = await musicStateWhere(sa, x => x.channels.length === 1)
    const ch = made.channels[0].id
    sa.emit('music:queue', { conversationId: voice.id, kind: 'channel', channelId: ch, trackId: id })
    await musicStateWhere(sa, x => x.channels[0]?.queued === 1)

    musicTrackEnded(`voice:${voice.id}`, ch)
    const after = await musicStateWhere(sa, x => x.channels[0]?.now?.title === 'Up Next')
    expect(after.channels[0].queued).toBe(0)
  })
})

describe('moving through a shared song', () => {
  // Anyone in the call may move the song or play a queued one now, as anyone
  // may skip: a shared channel has one position and it belongs to the room.
  const giveTrack = async (owner: TestUser, title: string) => {
    const ownerId = new Types.ObjectId(owner.id)
    const stored = await trackStore.put(Readable.from([Buffer.from('bytes')]), { ownerId, mimeType: 'audio/webm' })
    const doc = await Track.create({
      ownerId, title, artist: 'New Order', album: 'PCL',
      durationSec: 270, bytes: stored.bytes, store: stored.ref, source: 'upload', scan: 'skipped',
    })
    return String(doc._id)
  }
  type Now = { title?: string; elapsedMs?: number } | null
  type Ch = { id: string; now: Now; queue: { id: string; title: string | null }[] }
  const chans = (v: MusicView) => v.channels as unknown as Ch[]

  it('seek moves the song for everyone, not only the one who asked', async () => {
    const a = await register(); const b = await register()
    const { voice } = await seed(a, b)
    const sa = await inCall(a, voice.id); const sb = await inCall(b, voice.id)
    const id = await giveTrack(a, 'Long One')
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: id })
    const v = await musicStateWhere(sb, x => x.channels.length === 1)
    sb.emit('music:seek', { conversationId: voice.id, kind: 'channel', channelId: v.channels[0].id, sec: 120 })
    const after = await musicStateWhere(sa, x => (chans(x)[0]?.now?.elapsedMs ?? 0) >= 119_000)
    expect(chans(after)[0].now!.elapsedMs!).toBeLessThan(125_000)
  })

  it('refuses a seek that is not a number, to the asker', async () => {
    const a = await register()
    const { voice } = await seed(a)
    const sa = await inCall(a, voice.id)
    const id = await giveTrack(a, 'One')
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: id })
    const v = await musicStateWhere(sa, x => x.channels.length === 1)
    sa.emit('music:seek', { conversationId: voice.id, kind: 'channel', channelId: v.channels[0].id, sec: 'soon' })
    const err = await nextEvent(sa, 'music:error') as { reason: string }
    expect(err.reason).toMatch(/point in the song/i)
  })

  it('play now plays that entry for everyone and keeps the rest', async () => {
    const a = await register(); const b = await register()
    const { voice } = await seed(a, b)
    const sa = await inCall(a, voice.id); const sb = await inCall(b, voice.id)
    const one = await giveTrack(a, 'One'); const two = await giveTrack(a, 'Two'); const three = await giveTrack(a, 'Three')
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: one })
    const v = await musicStateWhere(sa, x => x.channels.length === 1)
    const ch = v.channels[0].id
    sa.emit('music:queue', { conversationId: voice.id, kind: 'channel', channelId: ch, trackId: two })
    await musicStateWhere(sa, x => chans(x)[0]?.queue.length === 1)
    sa.emit('music:queue', { conversationId: voice.id, kind: 'channel', channelId: ch, trackId: three })
    const q = await musicStateWhere(sb, x => chans(x)[0]?.queue.length === 2)
    const third = chans(q)[0].queue[1]
    expect(third.title).toBe('Three')
    sb.emit('music:play-now', { conversationId: voice.id, kind: 'channel', channelId: ch, entryId: third.id })
    const after = await musicStateWhere(sa, x => chans(x)[0]?.now?.title === 'Three')
    expect(chans(after)[0].queue.map(e => e.title)).toEqual(['Two'])
  })

  it('refuses play-now for an entry that is gone', async () => {
    const a = await register()
    const { voice } = await seed(a)
    const sa = await inCall(a, voice.id)
    const id = await giveTrack(a, 'One')
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: id })
    const v = await musicStateWhere(sa, x => x.channels.length === 1)
    sa.emit('music:play-now', { conversationId: voice.id, kind: 'channel', channelId: v.channels[0].id, entryId: 'gone' })
    const err = await nextEvent(sa, 'music:error') as { reason: string }
    expect(err.reason).toMatch(/not in the queue/i)
  })
})

describe('arriving in a call where music is already playing', () => {
  // A member who joins mid-song used to see "nothing playing" until the next
  // change — a skip, a queue, the song ending. With a four-minute song that
  // is four minutes of a room that looks silent while everyone listens.
  const startChannel = async () => {
    const a = await register(); const b = await register()
    const { voice } = await seed(a, b)
    const sa = await inCall(a, voice.id)
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'Chill', url: MP3 })
    await musicStateWhere(sa, x => x.channels.length === 1)
    return { b, voice }
  }

  it('tells a newcomer what is playing the moment they join', async () => {
    const { b, voice } = await startChannel()
    // Connected after the last broadcast, so nothing reached this socket yet.
    const sb = track(await connectSocket(sockets.url, b.token))
    const told = musicStateWhere(sb, x => x.channels.length === 1)
    sb.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    expect((await told).channels[0].name).toBe('Chill')
  })

  it('tells someone coming back from a dropped connection too', async () => {
    const { b, voice } = await startChannel()
    const sb = track(await connectSocket(sockets.url, b.token))
    const told = musicStateWhere(sb, x => x.channels.length === 1)
    sb.emit('call:rejoin', { conversationId: voice.id, kind: 'channel' })
    expect((await told).channels[0].name).toBe('Chill')
  })
})

describe('going back, from the socket', () => {
  const giveTrack = async (owner: TestUser, title: string) => {
    const ownerId = new Types.ObjectId(owner.id)
    const stored = await trackStore.put(Readable.from([Buffer.from('bytes')]), { ownerId, mimeType: 'audio/webm' })
    const doc = await Track.create({
      ownerId, title, artist: 'X', album: 'Y', durationSec: 270,
      bytes: stored.bytes, store: stored.ref, source: 'upload', scan: 'skipped',
    })
    return String(doc._id)
  }
  type Ch = { id: string; now: { title?: string } | null; queue: { title: string | null }[]; previous: boolean }
  const chans = (v: MusicView) => v.channels as unknown as Ch[]

  it('anyone in the call can go back, and everyone hears it', async () => {
    const a = await register(); const b = await register()
    const { voice } = await seed(a, b)
    const sa = await inCall(a, voice.id); const sb = await inCall(b, voice.id)
    const one = await giveTrack(a, 'One'); const two = await giveTrack(a, 'Two')
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: one })
    const ch = (await musicStateWhere(sa, x => x.channels.length === 1)).channels[0].id
    sa.emit('music:queue', { conversationId: voice.id, kind: 'channel', channelId: ch, trackId: two })
    await musicStateWhere(sa, x => chans(x)[0]?.queue.length === 1)
    sa.emit('music:skip', { conversationId: voice.id, kind: 'channel', channelId: ch })
    await musicStateWhere(sb, x => chans(x)[0]?.now?.title === 'Two' && chans(x)[0].previous)
    sb.emit('music:previous', { conversationId: voice.id, kind: 'channel', channelId: ch })
    const back = await musicStateWhere(sa, x => chans(x)[0]?.now?.title === 'One')
    expect(chans(back)[0].queue.map(e => e.title)).toEqual(['Two'])
  })

  it('says so when there is nothing to go back to', async () => {
    const a = await register()
    const { voice } = await seed(a)
    const sa = await inCall(a, voice.id)
    const one = await giveTrack(a, 'One')
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: one })
    const ch = (await musicStateWhere(sa, x => x.channels.length === 1)).channels[0].id
    sa.emit('music:previous', { conversationId: voice.id, kind: 'channel', channelId: ch })
    const err = await nextEvent(sa, 'music:error') as { reason: string }
    expect(err.reason).toMatch(/nothing played before/i)
  })
})

describe('pausing a shared song', () => {
  // Pause needs the music service to hold the song, so these run against a
  // stand-in service on a real port: it records what it was asked and
  // answers whatever status a test sets — one status, or a sequence whose
  // last entry then repeats — optionally holding the answer until a test
  // lets it go. The server is told about it the way a host tells it,
  // through the music config.
  const stub = {
    calls: [] as { path: string; body: Record<string, unknown> }[],
    status: {} as Record<string, number | number[]>,
    hold: {} as Record<string, Promise<void>>,
  }
  let service: http.Server
  const saved = { url: config.music.url, secret: config.music.secret }

  beforeAll(async () => {
    service = http.createServer((req, res) => {
      let raw = ''
      req.on('data', c => { raw += c })
      req.on('end', async () => {
        const path = new URL(req.url ?? '/', 'http://music').pathname
        let body: Record<string, unknown> = {}
        try { body = raw ? JSON.parse(raw) : {} } catch { /* recorded as empty */ }
        stub.calls.push({ path, body })
        if (stub.hold[path]) await stub.hold[path]
        const set = stub.status[path]
        const status = Array.isArray(set) ? (set.length > 1 ? set.shift()! : set[0]) : (set ?? 200)
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(path === '/capabilities' && status === 200 ? { ok: true, pause: true } : { ok: status === 200 }))
      })
    })
    await new Promise<void>(r => service.listen(0, '127.0.0.1', () => r()))
    Object.assign(config.music, {
      url: `http://127.0.0.1:${(service.address() as AddressInfo).port}`,
      secret: 'stub-secret',
    })
  })
  afterAll(async () => {
    Object.assign(config.music, saved)
    forgetMusicCapabilities()
    await new Promise<void>(r => service.close(() => r()))
  })
  beforeEach(() => {
    stub.calls.length = 0
    stub.status = {}
    stub.hold = {}
    forgetMusicCapabilities()
  })

  const giveTrack = async (owner: TestUser, title: string) => {
    const ownerId = new Types.ObjectId(owner.id)
    const stored = await trackStore.put(Readable.from([Buffer.from('bytes')]), { ownerId, mimeType: 'audio/webm' })
    const doc = await Track.create({
      ownerId, title, artist: 'X', album: 'Y', durationSec: 270,
      bytes: stored.bytes, store: stored.ref, source: 'upload', scan: 'skipped',
    })
    return String(doc._id)
  }
  type Ch = {
    id: string; now: { title?: string; elapsedMs?: number } | null
    queue: { title: string | null }[]; queued: number; paused?: boolean; pausable?: boolean
  }
  const chans = (v: MusicView) => v.channels as unknown as Ch[]
  const paths = () => stub.calls.map(c => c.path)
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  /** Two members in a call with a song playing that the service says it can pause. */
  const playing = async () => {
    const a = await register(); const b = await register()
    const { voice } = await seed(a, b)
    const sa = await inCall(a, voice.id); const sb = await inCall(b, voice.id)
    const one = await giveTrack(a, 'One')
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: one })
    const v = await musicStateWhere(sb, x => chans(x)[0]?.pausable === true)
    const ch = v.channels[0].id
    const at = { conversationId: voice.id, kind: 'channel', channelId: ch }
    return { a, b, sa, sb, voice, ch, at, room: `voice:${voice.id}` }
  }

  it('pause and resume reach everyone, and the service is asked first', async () => {
    const { sa, sb, ch, at, room } = await playing()
    stub.calls.length = 0
    sb.emit('music:pause', at)
    await musicStateWhere(sa, x => chans(x)[0]?.paused === true)
    expect(stub.calls).toContainEqual({ path: '/pause', body: { room, channelId: ch } })

    sa.emit('music:resume', at)
    await musicStateWhere(sb, x => chans(x)[0]?.paused === false)
    expect(stub.calls).toContainEqual({ path: '/resume', body: { room, channelId: ch } })
    // Released where the service held it, not started over.
    expect(paths()).not.toContain('/play-track')
  })

  it('a refused service call refuses the pause and broadcasts nothing', async () => {
    const { sa, sb, at, room } = await playing()
    stub.status['/pause'] = 500
    let benSaw = 0
    sb.on('music:state', () => { benSaw++ })
    const err = nextEvent(sa, 'music:error')
    sa.emit('music:pause', at)
    expect((await err).reason).toMatch(/could not be paused/i)
    await sleep(300)
    expect(benSaw).toBe(0)
    expect(musicRooms.view(room).channels[0].paused).toBe(false)
  })

  it('a refused resume leaves it paused', async () => {
    const { sa, at, room } = await playing()
    sa.emit('music:pause', at)
    await musicStateWhere(sa, x => chans(x)[0]?.paused === true)
    stub.status['/resume'] = 500
    const err = nextEvent(sa, 'music:error')
    sa.emit('music:resume', at)
    expect((await err).reason).toMatch(/could not be resumed/i)
    expect(musicRooms.view(room).channels[0].paused).toBe(true)
  })

  it('a refused pause or resume names its channel, so the client settles only that one', async () => {
    // Additive: `reason` is unchanged. The client keeps one pending pause per
    // channel and settles the one whose channelId the refusal carries.
    const { sa, sb, ch, at } = await playing()
    stub.status['/pause'] = 500
    let err = nextEvent(sa, 'music:error')
    sa.emit('music:pause', at)
    expect(await err).toMatchObject({ reason: expect.stringMatching(/could not be paused/i), channelId: ch })

    stub.status['/pause'] = 200
    sa.emit('music:pause', at)
    await musicStateWhere(sa, x => chans(x)[0]?.paused === true)
    stub.status['/resume'] = 500
    err = nextEvent(sa, 'music:error')
    sa.emit('music:resume', at)
    expect(await err).toMatchObject({ reason: expect.stringMatching(/could not be resumed/i), channelId: ch })

    // Refused by the rate limit, before anything else: still named.
    for (let i = 0; i < 10; i++) sb.emit('music:seek', { ...at, sec: 10 + i })
    await musicStateWhere(sb, x => (chans(x)[0]?.now?.elapsedMs ?? 0) >= 19_000)
    for (const ev of ['music:pause', 'music:resume']) {
      err = nextEvent(sb, 'music:error')
      sb.emit(ev, at)
      expect(await err).toMatchObject({ reason: expect.stringMatching(/too fast/i), channelId: ch })
    }
  })

  it('an older service (no capability) → no pausable, and a pause is refused', async () => {
    // An older service has no /capabilities route and no /pause either.
    stub.status['/capabilities'] = 404
    stub.status['/pause'] = 404
    const a = await register()
    const { voice } = await seed(a)
    const sa = await inCall(a, voice.id)
    const seen: Ch[][] = []
    sa.on('music:state', (v: MusicView) => { seen.push(chans(v)) })
    const one = await giveTrack(a, 'One')
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: one })
    await musicStateWhere(sa, x => x.channels.length === 1)
    await sleep(300)
    expect(paths()).toContain('/capabilities')
    expect(seen.flat().some(c => 'pausable' in c)).toBe(false)
    expect(musicRooms.view(`voice:${voice.id}`).channels[0]).not.toHaveProperty('pausable')

    const err = nextEvent(sa, 'music:error')
    sa.emit('music:pause', { conversationId: voice.id, kind: 'channel', channelId: seen.flat()[0].id })
    expect((await err).reason).toMatch(/could not be paused/i)
    expect(musicRooms.view(`voice:${voice.id}`).channels[0].paused).toBe(false)
  })

  it('pause is rate-limited like seek', async () => {
    // The same bucket as seek: ten moves a minute between them, then no more.
    const { sb, at, room } = await playing()
    for (let i = 0; i < 10; i++) sb.emit('music:seek', { ...at, sec: 10 + i })
    await musicStateWhere(sb, x => (chans(x)[0]?.now?.elapsedMs ?? 0) >= 19_000)
    stub.calls.length = 0
    const err = nextEvent(sb, 'music:error')
    sb.emit('music:pause', at)
    expect((await err).reason).toMatch(/too fast/i)
    await sleep(200)
    expect(paths()).not.toContain('/pause')
    expect(musicRooms.view(room).channels[0].paused).toBe(false)
  })

  it('resume is rate-limited too', async () => {
    const { sb, at } = await playing()
    sb.emit('music:pause', at)
    await musicStateWhere(sb, x => chans(x)[0]?.paused === true)
    for (let i = 0; i < 9; i++) sb.emit('music:seek', { ...at, sec: 10 + i })
    await musicStateWhere(sb, x => (chans(x)[0]?.now?.elapsedMs ?? 0) >= 18_000)
    const err = nextEvent(sb, 'music:error')
    sb.emit('music:resume', at)
    expect((await err).reason).toMatch(/too fast/i)
  })

  it('a late joiner gets paused:true and the frozen elapsed', async () => {
    const a = await register(); const b = await register()
    const { voice } = await seed(a, b)
    const sa = await inCall(a, voice.id)
    const one = await giveTrack(a, 'One')
    sa.emit('music:create', { conversationId: voice.id, kind: 'channel', name: 'C', trackId: one })
    const ch = (await musicStateWhere(sa, x => chans(x)[0]?.pausable === true)).channels[0].id
    const at = { conversationId: voice.id, kind: 'channel', channelId: ch }
    sa.emit('music:seek', { ...at, sec: 60 })
    await musicStateWhere(sa, x => (chans(x)[0]?.now?.elapsedMs ?? 0) >= 60_000)
    sa.emit('music:pause', at)
    const paused = await musicStateWhere(sa, x => chans(x)[0]?.paused === true)
    const frozen = chans(paused)[0].now!.elapsedMs!
    expect(frozen).toBeGreaterThanOrEqual(60_000)

    await sleep(400)
    // Connected after every broadcast, so the join's own state is all it gets.
    const sb = track(await connectSocket(sockets.url, b.token))
    const told = musicStateWhere(sb, x => x.channels.length === 1)
    sb.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    const late = chans(await told)[0]
    expect(late.paused).toBe(true)
    expect(late.now!.elapsedMs).toBe(frozen)
  })

  it('a song does not end while paused', async () => {
    // The service holds a paused song, so an end reported meanwhile is stale:
    // acting on it would skip the song somebody is about to resume.
    const { a, sa, ch, at, room } = await playing()
    const two = await giveTrack(a, 'Two')
    sa.emit('music:queue', { ...at, trackId: two })
    await musicStateWhere(sa, x => chans(x)[0]?.queue.length === 1)
    sa.emit('music:pause', at)
    await musicStateWhere(sa, x => chans(x)[0]?.paused === true)

    musicTrackEnded(room, ch)
    await sleep(200)
    const c = musicRooms.view(room).channels[0]
    expect(c.now?.title).toBe('One')
    expect(c.paused).toBe(true)
    expect(c.queued).toBe(1)
  })

  it('resume after the service lost the song starts it again where it stopped', async () => {
    // A service restarted during the pause holds nothing; it says so with a
    // 409, and the song is started again from the room's frozen point.
    const { sa, at, room } = await playing()
    sa.emit('music:seek', { ...at, sec: 90 })
    await musicStateWhere(sa, x => (chans(x)[0]?.now?.elapsedMs ?? 0) >= 90_000)
    sa.emit('music:pause', at)
    await musicStateWhere(sa, x => chans(x)[0]?.paused === true)

    stub.calls.length = 0
    stub.status['/resume'] = 409
    sa.emit('music:resume', at)
    await musicStateWhere(sa, x => chans(x)[0]?.paused === false)
    expect(paths()).toEqual(['/resume', '/play-track'])
    expect(stub.calls[1].body).toMatchObject({ room, startSec: 90 })
  })

  it('resume after the service was rolled back mid-pause starts the song again too', async () => {
    // An older service answers 404 to /resume. It cannot hold anything —
    // its restart lost the song — so this is a restart, not a failure.
    const { sa, at, room } = await playing()
    sa.emit('music:seek', { ...at, sec: 75 })
    await musicStateWhere(sa, x => (chans(x)[0]?.now?.elapsedMs ?? 0) >= 75_000)
    sa.emit('music:pause', at)
    await musicStateWhere(sa, x => chans(x)[0]?.paused === true)

    stub.calls.length = 0
    stub.status['/resume'] = 404
    stub.status['/capabilities'] = 404
    sa.emit('music:resume', at)
    const after = await musicStateWhere(sa, x => chans(x)[0]?.paused === false)
    expect(paths().slice(0, 2)).toEqual(['/resume', '/play-track'])
    expect(stub.calls[1].body).toMatchObject({ room, startSec: 75 })
    // And Pause goes away with it: this service cannot pause.
    expect(chans(after)[0]).not.toHaveProperty('pausable')
  })

  describe('putting the service back in line after a refused commit', () => {
    // A resume the service carried out, refused by the room because a seek
    // moved the paused point while it was being asked: the room is still
    // paused, so the service is told to pause again. If that lands while the
    // next song is still starting, the service answers 409 — and the pause
    // has to be tried again, or the song plays under a room that says Paused.
    const count = (p: string) => paths().filter(x => x === p).length
    const until = async (ok: () => boolean, ms = 3000) => {
      for (let t = 0; t < ms && !ok(); t += 25) await sleep(25)
    }
    const refusedResume = async () => {
      const ctx = await playing()
      const { sa, sb, at } = ctx
      sa.emit('music:pause', at)
      await musicStateWhere(sa, x => chans(x)[0]?.paused === true)
      let release = () => {}
      stub.hold['/resume'] = new Promise<void>(r => { release = r })
      stub.calls.length = 0
      const err = nextEvent(sa, 'music:error')
      sa.emit('music:resume', at)
      await until(() => paths().includes('/resume'))   // out, and held by the service
      sb.emit('music:seek', { ...at, sec: 30 })        // the paused point moves meanwhile
      await musicStateWhere(sa, x => chans(x)[0]?.now?.elapsedMs === 30_000)
      return { ...ctx, err, release }
    }

    it('retries a pause the service refuses while a song starts, until it holds', async () => {
      const { err, release, room } = await refusedResume()
      stub.status['/pause'] = [409, 409, 200]
      release()
      expect((await err).reason).toMatch(/changed while resuming/i)
      await until(() => count('/pause') >= 3)
      expect(count('/pause')).toBe(3)
      await sleep(600)
      expect(count('/pause')).toBe(3)                  // held: no more tries
      expect(musicRooms.view(room).channels[0].paused).toBe(true)
    })

    it('keeps retrying through a seek while paused: still paused, same song', async () => {
      const { sb, at, err, release } = await refusedResume()
      stub.status['/pause'] = [409, 409, 409, 200]
      release()
      await err
      await until(() => count('/pause') >= 2)
      sb.emit('music:seek', { ...at, sec: 50 })
      await until(() => count('/pause') >= 4)
      expect(count('/pause')).toBe(4)
    })

    it('stops retrying once the room is no longer paused on that song', async () => {
      const { sb, at, err, release } = await refusedResume()
      stub.status['/pause'] = 409
      release()
      await err
      await until(() => count('/pause') >= 2)
      sb.emit('music:skip', at)                        // nothing queued: the song is over
      await musicStateWhere(sb, x => chans(x)[0]?.now === null)
      await sleep(300)
      const settled = count('/pause')
      await sleep(700)
      expect(count('/pause')).toBe(settled)
    })
  })

  describe('two people pressing at once', () => {
    // Both presses pass the check while the service is being asked for the
    // first. One pause or resume is in flight per channel; the other waits
    // for it, and finding the room already the way it asked is a success,
    // not "It is already paused."
    const count = (p: string) => paths().filter(x => x === p).length
    const until = async (ok: () => boolean, ms = 3000) => {
      for (let t = 0; t < ms && !ok(); t += 25) await sleep(25)
    }
    const errorsOn = (...ss: ClientSocket[]) => {
      const seen: string[] = []
      for (const s of ss) s.on('music:error', (e: { reason: string }) => seen.push(e.reason))
      return seen
    }
    const holdPath = (p: string) => {
      let release = () => {}
      stub.hold[p] = new Promise<void>(r => { release = r })
      return () => release()
    }

    it('Pause twice: the service is asked once, and nobody is told it is already paused', async () => {
      const { sa, sb, at, room } = await playing()
      const errors = errorsOn(sa, sb)
      const release = holdPath('/pause')
      stub.calls.length = 0
      sa.emit('music:pause', at); sb.emit('music:pause', at)
      await until(() => paths().includes('/pause'))
      await sleep(150)                                 // both presses are in
      release()
      await musicStateWhere(sb, x => chans(x)[0]?.paused === true)
      await sleep(300)
      expect(errors).toEqual([])
      expect(count('/pause')).toBe(1)
      expect(musicRooms.view(room).channels[0].paused).toBe(true)
    })

    it('Resume twice: the service is asked once, and nobody is told it is not paused', async () => {
      const { sa, sb, at, room } = await playing()
      sa.emit('music:pause', at)
      await musicStateWhere(sa, x => chans(x)[0]?.paused === true)
      const errors = errorsOn(sa, sb)
      const release = holdPath('/resume')
      stub.calls.length = 0
      sa.emit('music:resume', at); sb.emit('music:resume', at)
      await until(() => paths().includes('/resume'))
      await sleep(150)
      release()
      await musicStateWhere(sb, x => chans(x)[0]?.paused === false)
      await sleep(300)
      expect(errors).toEqual([])
      expect(count('/resume')).toBe(1)
      expect(musicRooms.view(room).channels[0].paused).toBe(false)
    })

    it('Resume twice after a seek while paused starts the song once', async () => {
      const { sa, sb, at } = await playing()
      sa.emit('music:pause', at)
      await musicStateWhere(sa, x => chans(x)[0]?.paused === true)
      sb.emit('music:seek', { ...at, sec: 120 })
      await musicStateWhere(sa, x => chans(x)[0]?.now?.elapsedMs === 120_000)
      const errors = errorsOn(sa, sb)
      const release = holdPath('/play-track')
      stub.calls.length = 0
      sa.emit('music:resume', at); sb.emit('music:resume', at)
      await until(() => paths().includes('/play-track'))
      await sleep(150)
      release()
      await musicStateWhere(sb, x => chans(x)[0]?.paused === false)
      await sleep(300)
      expect(errors).toEqual([])
      expect(count('/play-track')).toBe(1)
    })

    it('a resume overtaken by a skip is not an error: the room is playing, as asked', async () => {
      const { a, sa, sb, at } = await playing()
      const two = await giveTrack(a, 'Two')
      sa.emit('music:queue', { ...at, trackId: two })
      await musicStateWhere(sa, x => chans(x)[0]?.queue.length === 1)
      sa.emit('music:pause', at)
      await musicStateWhere(sa, x => chans(x)[0]?.paused === true)
      const errors = errorsOn(sa)
      const release = holdPath('/resume')
      stub.calls.length = 0
      sa.emit('music:resume', at)
      await until(() => paths().includes('/resume'))
      sb.emit('music:skip', at)
      await musicStateWhere(sa, x => chans(x)[0]?.now?.title === 'Two')
      release()
      await sleep(300)
      expect(errors).toEqual([])
    })

    it('a resume that must restart the song does not, once a skip has moved on', async () => {
      // The service lost the song (409), so resume would start it again — but
      // a skip landed while the service was asked. Starting the old song now
      // could reach the service after the skip's and replace the new one.
      const { a, sa, sb, at } = await playing()
      const two = await giveTrack(a, 'Two')
      sa.emit('music:queue', { ...at, trackId: two })
      await musicStateWhere(sa, x => chans(x)[0]?.queue.length === 1)
      sa.emit('music:pause', at)
      await musicStateWhere(sa, x => chans(x)[0]?.paused === true)
      const errors = errorsOn(sa)
      stub.status['/resume'] = 409
      const release = holdPath('/resume')
      stub.calls.length = 0
      sa.emit('music:resume', at)
      await until(() => paths().includes('/resume'))
      sb.emit('music:skip', at)
      await musicStateWhere(sa, x => chans(x)[0]?.now?.title === 'Two')
      await until(() => count('/play-track') >= 1)
      release()
      await sleep(300)
      expect(count('/play-track')).toBe(1)            // the skip's, and only that
      expect(errors).toEqual([])
    })

    it('a second refused commit does not start a second retry loop', async () => {
      // Refused resume #1 leaves a retry loop pausing the service every
      // quarter second while it answers 409. Refused resume #2 starts the
      // loop again: one loop per channel, so the rate stays one loop's.
      const ctx = await playing()
      const { sa, sb, at } = ctx
      sa.emit('music:pause', at)
      await musicStateWhere(sa, x => chans(x)[0]?.paused === true)
      stub.status['/pause'] = 409
      const refuse = async (path: string, sec: number) => {
        const release = holdPath(path)
        const err = nextEvent(sa, 'music:error')
        const before = count(path)
        sa.emit('music:resume', at)
        await until(() => count(path) > before)
        sb.emit('music:seek', { ...at, sec })
        await musicStateWhere(sa, x => chans(x)[0]?.now?.elapsedMs === sec * 1000)
        release()
        expect((await err).reason).toMatch(/changed while resuming/i)
      }
      await refuse('/resume', 30)
      await until(() => count('/pause') >= 2)
      // The paused point moved, so this resume starts the song: hold that.
      await refuse('/play-track', 40)
      await sleep(300)
      const from = count('/pause')
      await sleep(1000)
      // One loop asks about four times a second; two would ask about eight.
      expect(count('/pause') - from).toBeLessThanOrEqual(5)
    })
  })

  it('seek while paused moves the point without playing, and resume starts there', async () => {
    const { sa, sb, at } = await playing()
    sa.emit('music:pause', at)
    await musicStateWhere(sa, x => chans(x)[0]?.paused === true)

    stub.calls.length = 0
    sb.emit('music:seek', { ...at, sec: 120 })
    const moved = await musicStateWhere(sa, x => chans(x)[0]?.now?.elapsedMs === 120_000)
    expect(chans(moved)[0].paused).toBe(true)
    await sleep(200)
    expect(paths()).not.toContain('/play-track')

    sa.emit('music:resume', at)
    await musicStateWhere(sb, x => chans(x)[0]?.paused === false)
    // The service still holds the old point, so it is not merely released.
    expect(paths()).toEqual(['/play-track'])
    expect(stub.calls[0].body).toMatchObject({ startSec: 120 })
  })

  it('skip while paused plays the next song, unpaused, for everyone', async () => {
    const { a, sa, sb, at } = await playing()
    const two = await giveTrack(a, 'Two')
    sa.emit('music:queue', { ...at, trackId: two })
    await musicStateWhere(sa, x => chans(x)[0]?.queue.length === 1)
    sa.emit('music:pause', at)
    await musicStateWhere(sa, x => chans(x)[0]?.paused === true)
    sb.emit('music:skip', at)
    const next = await musicStateWhere(sa, x => chans(x)[0]?.now?.title === 'Two')
    expect(chans(next)[0].paused).toBe(false)
  })

  it('ignores a member who is not in the call', async () => {
    // Connected, never joined the call: the same gate as every music event.
    const { at, room } = await playing()
    const outsider = await register()
    const so = track(await connectSocket(sockets.url, outsider.token))
    so.emit('music:pause', at)
    await sleep(300)
    expect(paths()).not.toContain('/pause')
    expect(musicRooms.view(room).channels[0].paused).toBe(false)
  })
})
