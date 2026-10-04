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
import { Server } from '../models/Server'
import { Track } from '../models/Track'
import { trackStore } from '../utils/trackStore'
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
