import { describe, it, expect } from 'vitest'
import { permitsFromGrant } from '../voicePermits'

// The media server's live grant, read the way the token mint writes it
// (server/utils/voiceModeration.ts publishGrantFor): canPublish false stops
// everything, an empty source list means every source, and a narrowed list
// names what is left. Sources are passed in so this needs no LiveKit import.
const MIC = 2, CAMERA = 1, SCREEN = 3

describe('permitsFromGrant', () => {
  it('allows both when publishing is open to every source', () => {
    expect(permitsFromGrant({ canPublish: true, canPublishSources: [] }, MIC, CAMERA)).toEqual({ audio: true, video: true })
  })

  it('allows neither when publishing is closed, as a deafen does', () => {
    expect(permitsFromGrant({ canPublish: false, canPublishSources: [] }, MIC, CAMERA)).toEqual({ audio: false, video: false })
  })

  it('reads a server mute: camera and screen left, microphone gone', () => {
    expect(permitsFromGrant({ canPublish: true, canPublishSources: [CAMERA, SCREEN] }, MIC, CAMERA)).toEqual({ audio: false, video: true })
  })

  it('reads a channel without Video: microphone only', () => {
    expect(permitsFromGrant({ canPublish: true, canPublishSources: [MIC] }, MIC, CAMERA)).toEqual({ audio: true, video: false })
  })
})
