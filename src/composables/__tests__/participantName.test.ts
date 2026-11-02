import { describe, it, expect, afterEach } from 'vitest'
import type { Room } from 'livekit-client'
import { setRoom, participantName } from '../voiceRoom'

/**
 * A sharer the stage has no tile for yet — presence lags the room — is
 * named as LiveKit has them, as their video tiles are, rather than left blank.
 */
const roomWith = (people: Record<string, string>): Room => ({
  remoteParticipants: new Map(Object.entries(people).map(([identity, name]) => [identity, { identity, name }])),
}) as unknown as Room

afterEach(() => { setRoom(null) })

describe('participantName', () => {
  it('is the name LiveKit has for them', () => {
    setRoom(roomWith({ u1: 'Ana' }))
    expect(participantName('u1')).toBe('Ana')
  })

  it('is their identity when LiveKit has no name, or no such person, or no room', () => {
    setRoom(roomWith({ u1: '' }))
    expect(participantName('u1')).toBe('u1')
    expect(participantName('u2')).toBe('u2')
    setRoom(null)
    expect(participantName('u3')).toBe('u3')
  })
})
