/**
 * Voice presence survives a socket blip.
 *
 * The media and the presence are two connections to two services, and only
 * one of them notices when the network hiccups. A dropped socket makes the
 * server drop the person from every call it had them in, so every sidebar in
 * the instance loses them — while LiveKit carries on, leaving them audible
 * and still a tile on everyone's call stage. Nothing used to tell the server
 * they were still there when the socket came back, so the two views
 * disagreed until they left for real. One API restart did it to everybody in
 * a call at the same time.
 *
 * These pin the client half: the re-announce fires on the way back up, and
 * only when there is a live call to re-announce.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'

// Same stubs, for the same reasons, as isConnectedVoiceRoom.test.ts:
// useVoice.ts reaches the mic chain (RNNoise wasm/AudioWorklet), usePresence
// (localStorage at module load) and, through usePerformance, the Material You
// colour utilities. None of the three is involved in anything here.
vi.mock('../micChain', () => ({ createMicChainProcessor: () => ({}) }))
vi.mock('../usePresence', () => ({ applySelfPresence: () => {}, holdPresence: () => {} }))
vi.mock('../materialScheme', () => ({ SCHEME_TOKEN_KEYS: [], buildSchemeTokens: () => ({}) }))

/** Everything this file asserts on: what the client said, and in what order. */
const emitted: { event: string; payload: unknown }[] = []
const fakeSocket = { emit: (event: string, payload: unknown) => { emitted.push({ event, payload }) } }

// The socket module is stubbed whole: a real one would open a connection, and
// the point here is only what useVoice asks it to send. `connected` stays a
// real ref so the watcher under test has something to watch.
vi.mock('../useSocket', async () => {
  const { ref } = await import('vue')
  return {
    connected: ref(false),
    getSocket: () => fakeSocket,
    emitCallJoin:   (conversationId: string, kind: string) => emitted.push({ event: 'call:join',   payload: { conversationId, kind } }),
    emitCallLeave:  (conversationId: string, kind: string) => emitted.push({ event: 'call:leave',  payload: { conversationId, kind } }),
    emitCallRejoin: (conversationId: string, kind: string) => emitted.push({ event: 'call:rejoin', payload: { conversationId, kind } }),
    callServerMoved: ref(null),
    soundCallJoin: () => {}, soundCallLeave: () => {},
    soundUserJoin: () => {}, soundUserLeave: () => {},
    soundMute: () => {}, soundUnmute: () => {},
    soundDeafen: () => {}, soundUndeafen: () => {},
  }
})

let voice: typeof import('../useVoice').voice
let connected: import('vue').Ref<boolean>
let nextTick: typeof import('vue').nextTick

beforeAll(async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} } as unknown as Storage
  const inertEl = () => ({ style: {}, setAttribute() {}, removeAttribute() {} })
  globalThis.document = {
    documentElement: { dataset: {} },
    createElement: inertEl,
    querySelector: () => null,
    head: inertEl(),
    addEventListener() {}, removeEventListener() {},
  } as unknown as Document
  globalThis.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia

  ;({ nextTick } = await import('vue'))
  ;({ connected } = await import('../useSocket') as unknown as { connected: import('vue').Ref<boolean> })
  ;({ voice } = await import('../useVoice'))
})

/** Module-level state, shared app-wide by design — reset, not reconstructed. */
const inCall = (on: boolean) => {
  voice.connected = on
  voice.activeConvId = on ? 'chan-1' : null
  voice.activeKind = on ? 'channel' : null
}

const blip = async () => {
  connected.value = false
  await nextTick()
  emitted.length = 0        // the drop itself is not what these assert on
  connected.value = true
  await nextTick()
}

beforeEach(async () => {
  inCall(false)
  voice.localMuted = false
  voice.localDeafened = false
  connected.value = false
  await nextTick()
  emitted.length = 0
})

describe('re-announcing a call after the socket comes back', () => {
  it('rejoins the call it was in', async () => {
    inCall(true)
    await blip()
    expect(emitted.filter(e => e.event === 'call:rejoin')).toEqual([
      { event: 'call:rejoin', payload: { conversationId: 'chan-1', kind: 'channel' } },
    ])
  })

  it('never sends call:join, which would announce the call a second time', async () => {
    inCall(true)
    await blip()
    expect(emitted.some(e => e.event === 'call:join')).toBe(false)
  })

  it('re-sends mute and deafen, which the dropped socket took with it', async () => {
    inCall(true)
    voice.localMuted = true
    voice.localDeafened = true
    await blip()
    expect(emitted.find(e => e.event === 'voice:state')?.payload)
      .toMatchObject({ muted: true, deafened: true })
  })

  it('says nothing when there was no call — most reconnects are not in one', async () => {
    inCall(false)
    await blip()
    expect(emitted.filter(e => e.event === 'call:rejoin')).toEqual([])
  })

  it('says nothing when the media connection is down too: that path reconnects on its own', async () => {
    voice.activeConvId = 'chan-1'
    voice.activeKind = 'channel'
    voice.connected = false
    await blip()
    expect(emitted.filter(e => e.event === 'call:rejoin')).toEqual([])
  })

  it('fires on the transition, so a redundant connect re-announces nothing', async () => {
    inCall(true)
    connected.value = true
    await nextTick()
    expect(emitted.filter(e => e.event === 'call:rejoin')).toHaveLength(1)
    emitted.length = 0
    // Still connected. Without the transition check this would re-announce on
    // every stray signal, and the server would fan occupancy out each time.
    connected.value = true
    await nextTick()
    expect(emitted.filter(e => e.event === 'call:rejoin')).toEqual([])
  })
})
