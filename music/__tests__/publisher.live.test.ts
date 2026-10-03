/// <reference types="node" />
/**
 * The claim every other test in this service takes on faith: that audio
 * actually crosses LiveKit from the publisher to a subscriber.
 *
 * Everything below this is provable with the audio stubbed out — the guard
 * judges addresses, the fetcher moves bytes, the state machine tracks who is
 * listening. None of it says a note is ever heard. This does, and it needs a
 * real media server to say it.
 *
 * SKIPPED when there is no LiveKit at LIVEKIT_TEST_URL (default
 * ws://127.0.0.1:7880), so the suite stays green on a machine without one.
 * Skipped is not passed, and the skip reason says so.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { spawn } from 'child_process'
import { Room, RoomEvent, AudioStream, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from '@livekit/rtc-node'
import { AccessToken } from 'livekit-server-sdk'
import { MusicPublisher, MUSIC_IDENTITY } from '../src/publisher'

const URL_ = process.env.LIVEKIT_TEST_URL ?? 'ws://127.0.0.1:7880'

/** The dev container's key pair, read from its config rather than hardcoded. */
const keys = (): { key: string; secret: string } | null => {
  for (const p of [process.env.LIVEKIT_TEST_CONFIG, 'C:/livekit/livekit.yaml', '/etc/livekit.yaml']) {
    if (!p || !existsSync(p)) continue
    const after = readFileSync(p, 'utf8').split('keys:')[1]
    const m = after && /^\s*([A-Za-z0-9_-]+)\s*:\s*(\S+)\s*$/m.exec(after)
    if (m) return { key: m[1], secret: m[2] }
  }
  if (process.env.LIVEKIT_TEST_KEY && process.env.LIVEKIT_TEST_SECRET) {
    return { key: process.env.LIVEKIT_TEST_KEY, secret: process.env.LIVEKIT_TEST_SECRET }
  }
  return null
}

const reachable = async (): Promise<boolean> => {
  try {
    const http = URL_.replace(/^ws/, 'http')
    const res = await fetch(http, { signal: AbortSignal.timeout(1500) })
    return res.status < 500
  } catch { return false }
}

const creds = keys()
const live = creds !== null && await reachable()

/** ffmpeg generates its own input, so no audio fixture lives in the repo. */
const tone = (freq: number, seconds: number) => spawn('ffmpeg', [
  '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`,
  '-f', 'mp3', 'pipe:1',
], { windowsHide: true }).stdout

let pub: MusicPublisher | null = null
afterAll(async () => { await pub?.shutdown() })

describe.skipIf(!live)('audio reaches a subscriber', () => {
  it('publishes two channels and delivers only the one subscribed to', async () => {
    const room = `test-music-${Date.now()}`
    pub = new MusicPublisher({ url: URL_, apiKey: creds!.key, apiSecret: creds!.secret })

    await pub.open(room, 'chill')
    await pub.open(room, 'metal')
    expect(pub.openChannels(room).sort()).toEqual(['chill', 'metal'])

    const at = new AccessToken(creds!.key, creds!.secret, { identity: 'listener-1' })
    at.addGrant({ roomJoin: true, room, canPublish: false, canSubscribe: true })

    const listener = new Room()
    const published: string[] = []
    const identities = new Set<string>()
    let framesIn = 0

    listener.on(RoomEvent.TrackPublished, (p: RemoteTrackPublication, who: RemoteParticipant) => {
      published.push(`${who.identity}/${p.name}`)
      identities.add(who.identity)
      // Exactly one: this IS the feature. Nobody downloads what they did not
      // choose, which is why the cost is per channel and not per listener.
      if (p.name === 'chill') void p.setSubscribed(true)
    })
    listener.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      void (async () => {
        for await (const _f of new AudioStream(track)) { framesIn++; if (framesIn > 300) break }
      })()
    })

    await listener.connect(URL_, await at.toJwt(), { autoSubscribe: false, dynacast: true })
    await new Promise(r => setTimeout(r, 1500))

    /*
     * The tracks that already existed when this listener joined.
     *
     * TrackPublished fires only for publications made AFTER connecting, so
     * a listener that relies on the event alone never sees the channels that
     * were already playing. That is not a quirk of this test — the real
     * client had exactly this bug until this test found it, and a member
     * walking into a call with three channels running was subscribed to all
     * three.
     */
    listener.remoteParticipants.forEach((who) => {
      who.trackPublications.forEach((p) => {
        const label = `${who.identity}/${p.name}`
        if (!published.includes(label)) { published.push(label); identities.add(who.identity) }
        void p.setSubscribed(p.name === 'chill')
      })
    })
    await new Promise(r => setTimeout(r, 800))

    const outcome = await pub.play(room, 'chill', tone(440, 1.2))
    await new Promise(r => setTimeout(r, 1200))

    expect(outcome).toBe('ended')
    // One participant with two tracks, not two participants.
    expect(identities.size).toBe(1)
    expect([...identities][0]).toBe(MUSIC_IDENTITY)
    expect(published.sort()).toEqual([`${MUSIC_IDENTITY}/chill`, `${MUSIC_IDENTITY}/metal`])
    // The point of the whole exercise.
    expect(framesIn).toBeGreaterThan(20)

    await listener.disconnect()
  }, 60_000)

  it('closing the last channel leaves the room, rather than lingering as a ghost', async () => {
    const room = `test-music-leave-${Date.now()}`
    const p = new MusicPublisher({ url: URL_, apiKey: creds!.key, apiSecret: creds!.secret })
    await p.open(room, 'only')
    expect(p.openChannels(room)).toEqual(['only'])
    await p.close(room, 'only')
    // A connection with nothing to carry is exactly the ghost participant the
    // voice work spent a day removing.
    expect(p.openChannels(room)).toEqual([])
    await p.shutdown()
  }, 40_000)
})

describe.skipIf(live)('skipped', () => {
  it('says why, so a skip is never mistaken for a pass', () => {
    const why = creds === null ? 'no LiveKit key pair found' : `nothing answering at ${URL_}`
    // eslint-disable-next-line no-console
    console.log(`publisher.live: SKIPPED — ${why}. The audio path is unproven in this run.`)
    expect(live).toBe(false)
  })
})
