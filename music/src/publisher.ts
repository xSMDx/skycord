/**
 * Publish music channels into a LiveKit room.
 *
 * One connection per voice room, one TRACK per music channel, which is the
 * shape the whole feature rests on: members subscribe to the one track they
 * chose, so nobody receives audio they are not listening to and the cost is
 * per channel rather than per listener.
 *
 * The service joins as a single participant, `svc:music`. One participant
 * with several tracks rather than one participant per channel, so the member
 * list stays honest — the client filters this identity out of it, and
 * filtering five fake people would be five chances to miss one.
 */
import {
  AudioFrame, AudioSource, LocalAudioTrack, Room,
  TrackPublishOptions, TrackSource,
} from '@livekit/rtc-node'
import { AccessToken, TrackSource as GrantSource } from 'livekit-server-sdk'
import type { Readable } from 'stream'
import { SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME, decode, frames } from './decode'

/** Must match the client's MUSIC_IDENTITY. The colon is what makes it unforgeable. */
export const MUSIC_IDENTITY = 'svc:music'

export interface PublisherConfig {
  url: string
  apiKey: string
  apiSecret: string
  ffmpegPath?: string
  log?: (msg: string) => void
}

interface Channel {
  source: AudioSource
  track: LocalAudioTrack
  /** Stops whatever is currently playing, if anything. */
  stop: () => void
}

interface RoomEntry {
  room: Room
  channels: Map<string, Channel>
}

export class MusicPublisher {
  private readonly rooms = new Map<string, RoomEntry>()
  constructor(private readonly cfg: PublisherConfig) {}

  private log(msg: string): void { this.cfg.log?.(msg) }

  /**
   * A token that can speak and cannot listen.
   *
   * `canSubscribe: false` is the important half: a service that fetches
   * attacker-chosen URLs has no business receiving the room's microphones,
   * and the token is where that is guaranteed rather than assumed. Sources
   * are narrowed to the microphone so it cannot publish video either.
   */
  private async token(room: string): Promise<string> {
    const at = new AccessToken(this.cfg.apiKey, this.cfg.apiSecret, {
      identity: MUSIC_IDENTITY,
      name: 'Music',
    })
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: false,
      canPublishData: false,
      // The server SDK has its own TrackSource, distinct from rtc-node's —
      // same idea, different enum, and mixing them typechecks nowhere.
      canPublishSources: [GrantSource.MICROPHONE],
    })
    return at.toJwt()
  }

  private async entry(roomName: string): Promise<RoomEntry> {
    const existing = this.rooms.get(roomName)
    if (existing) return existing

    const room = new Room()
    // autoSubscribe false as well as canSubscribe false in the grant: one is
    // the server refusing, the other is this process not asking. Either
    // alone would do; both means a change to one does not quietly re-enable
    // a thing this service should never do.
    await room.connect(this.cfg.url, await this.token(roomName), {
      autoSubscribe: false,
      dynacast: true,
    })
    const created: RoomEntry = { room, channels: new Map() }
    this.rooms.set(roomName, created)
    this.log(`joined ${roomName}`)
    return created
  }

  /** Open a music channel: publish a silent track ready to be fed. */
  async open(roomName: string, channelId: string): Promise<void> {
    const entry = await this.entry(roomName)
    if (entry.channels.has(channelId)) return

    const source = new AudioSource(SAMPLE_RATE, CHANNELS)
    // The track NAME is the channel id, because that is what the client
    // matches against when deciding what to subscribe to. The human name
    // lives in the server's state and never needs to reach LiveKit.
    const track = LocalAudioTrack.createAudioTrack(channelId, source)
    // Optional until the room finishes connecting. entry() awaited connect,
    // so this holds — but an assertion here would be a crash in the one case
    // it does not.
    const me = entry.room.localParticipant
    if (!me) { await source.close().catch(() => {}); throw new Error('room has no local participant') }
    await me.publishTrack(
      track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
    )
    entry.channels.set(channelId, { source, track, stop: () => {} })
    this.log(`opened ${roomName}/${channelId}`)
  }

  /**
   * Play a fetched body on a channel, replacing whatever was playing.
   *
   * Returns when the track finishes or is replaced, so the caller can
   * advance its own queue. Errors are reported rather than thrown: a bad
   * file is an ordinary event here, not an exceptional one.
   */
  async play(roomName: string, channelId: string, body: Readable): Promise<'ended' | 'replaced' | 'failed'> {
    const entry = this.rooms.get(roomName)
    const channel = entry?.channels.get(channelId)
    if (!channel) return 'failed'

    channel.stop()                      // whatever was playing is over

    const dec = decode(body, {
      ffmpegPath: this.cfg.ffmpegPath,
      onStderr: l => this.log(`ffmpeg ${roomName}/${channelId}: ${l}`),
    })

    let replaced = false
    channel.stop = () => { replaced = true; dec.stop() }

    try {
      for await (const frame of frames(dec.pcm)) {
        if (replaced) break
        /*
         * captureFrame is awaited, and that await is the clock.
         *
         * AudioSource paces itself to real time, so awaiting each frame is
         * what makes a four-minute track take four minutes instead of
         * being flung into the room as fast as the file can be read. There
         * is no separate timer, and adding one would fight this.
         */
        await channel.source.captureFrame(
          new AudioFrame(frame, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME),
        )
      }
    } catch (e) {
      this.log(`play ${roomName}/${channelId} failed: ${String(e).slice(0, 200)}`)
      dec.stop()
      return 'failed'
    }

    dec.stop()
    await dec.done
    return replaced ? 'replaced' : 'ended'
  }

  /** Stop a channel and unpublish its track. */
  async close(roomName: string, channelId: string): Promise<void> {
    const entry = this.rooms.get(roomName)
    const channel = entry?.channels.get(channelId)
    if (!entry || !channel) return
    channel.stop()
    try { await entry.room.localParticipant?.unpublishTrack(channel.track.sid ?? channelId) } catch { /* already gone */ }
    await channel.source.close().catch(() => {})
    entry.channels.delete(channelId)
    this.log(`closed ${roomName}/${channelId}`)

    // A room with no channels is a connection with nothing to carry. Left
    // open it would hold a participant in every call that ever played
    // anything, which is exactly the ghost the voice work spent today
    // removing.
    if (entry.channels.size === 0) await this.leave(roomName)
  }

  async leave(roomName: string): Promise<void> {
    const entry = this.rooms.get(roomName)
    if (!entry) return
    for (const [id, c] of entry.channels) { c.stop(); await c.source.close().catch(() => {}); entry.channels.delete(id) }
    this.rooms.delete(roomName)
    await entry.room.disconnect().catch(() => {})
    this.log(`left ${roomName}`)
  }

  async shutdown(): Promise<void> {
    for (const name of [...this.rooms.keys()]) await this.leave(name)
  }

  /** Test seam. */
  openChannels(roomName: string): string[] {
    return [...(this.rooms.get(roomName)?.channels.keys() ?? [])]
  }
}
