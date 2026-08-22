import { describe, it, expect, vi } from 'vitest'

// useVoice.ts pulls in the full mic processing chain (micChain -> the RNNoise
// wasm/AudioWorklet package), which only exists in a browser. voiceRoomName
// itself is a pure string function that never touches any of that, so stub
// the heavy import out rather than letting vitest's node environment choke on
// AudioWorkletNode while loading the module.
vi.mock('../micChain', () => ({ createMicChainProcessor: () => ({}) }))
// Same story: usePresence reads localStorage at module load (idle-timeout
// setting), which doesn't exist in vitest's node environment.
vi.mock('../usePresence', () => ({ applySelfPresence: () => {} }))

import { voiceRoomName } from '../useVoice'

// Pins the client's copy of the room-naming rule. There are two more copies of
// this exact rule server-side — roomFor (server/controllers/voiceController.ts)
// and callRoom (server/sockets/chatSocket.ts) — and all three must agree
// character-for-character, or two people each believe they're connected while
// sitting in different LiveKit rooms with no error and no log. If you change
// the naming here, change both of those too (and vice versa).
describe('voiceRoomName', () => {
  it('a channel room is voice:<channelId>', () => {
    expect(voiceRoomName('channel', 'chan1', 'u1')).toBe('voice:chan1')
  })

  it('a group room is group:<conversationId>', () => {
    expect(voiceRoomName('group', 'group1', 'u1')).toBe('group:group1')
  })

  it('a DM room is dm:<sorted participant ids joined by _>', () => {
    expect(voiceRoomName('dm', 'u2', 'u1')).toBe('dm:u1_u2')
  })

  it('a DM room is order-independent: both participants derive the same room', () => {
    // Alice calling Bob (myId=alice, convId=bob) and Bob calling Alice
    // (myId=bob, convId=alice) must land in the identical room, or the two
    // sides silently connect to different LiveKit rooms.
    const fromAlice = voiceRoomName('dm', 'bob', 'alice')
    const fromBob   = voiceRoomName('dm', 'alice', 'bob')
    expect(fromAlice).toBe(fromBob)
    expect(fromAlice).toBe('dm:alice_bob')
  })

  it('channel and group rooms ignore myId entirely', () => {
    expect(voiceRoomName('channel', 'chan1', 'u1')).toBe(voiceRoomName('channel', 'chan1', 'u2'))
    expect(voiceRoomName('group', 'group1', 'u1')).toBe(voiceRoomName('group', 'group1', 'u2'))
  })
})
