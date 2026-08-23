import { describe, it, expect, beforeEach } from 'vitest'

// Same reasoning as voiceRoomName.test.ts: useVoice.ts pulls in the mic
// processing chain (RNNoise wasm/AudioWorklet) and usePresence (reads
// localStorage at module load), neither of which exists in vitest's node
// environment. isConnectedVoiceRoom never touches either — it only reads
// `voice.activeConvId` — so the heavy imports are stubbed out rather than
// reached.
import { vi } from 'vitest'
vi.mock('../micChain', () => ({ createMicChainProcessor: () => ({}) }))
vi.mock('../usePresence', () => ({ applySelfPresence: () => {}, holdPresence: () => {} }))

import { voice, isConnectedVoiceRoom } from '../useVoice'

/**
 * Pins fix #3 from the whole-branch review: the sidebar's speaking lookup
 * (ChatApp.vue's `voiceOccupants`) used to be keyed on user id alone, with no
 * notion of WHICH room that speaking state belongs to. If presence ever lists
 * the same user in two rooms at once — a `call:join` whose matching
 * `call:leave` never arrived — that let them render as speaking in a channel
 * the local user isn't even connected to. `isConnectedVoiceRoom` is the one
 * check that closes that gap, so it's pinned directly against `voice`'s
 * module-level state rather than through ChatApp.vue, which has no test
 * harness.
 */
describe('isConnectedVoiceRoom', () => {
  beforeEach(() => {
    // Module-level state, shared across the whole app by design (same as
    // useServers' refs) — reset before each test rather than reconstructed.
    voice.activeConvId = null
  })

  it('is false when not connected to any voice channel', () => {
    expect(isConnectedVoiceRoom('general')).toBe(false)
  })

  it('is true for the one channel you are actually connected to', () => {
    voice.activeConvId = 'general'
    expect(isConnectedVoiceRoom('general')).toBe(true)
  })

  it('is false for a channel you are NOT connected to, even if presence lists you there', () => {
    // The exact scenario fix #3 guards against: server presence can list a
    // stale membership (a call:join whose call:leave never arrived) for a
    // room that isn't the one LiveKit actually has you in.
    voice.activeConvId = 'general'
    expect(isConnectedVoiceRoom('off-topic')).toBe(false)
  })
})
