/**
 * useVoiceMedia — camera + screen-share for the active voice call. Publishes
 * local video tracks into the shared LiveKit Room (voiceRoom) and keeps a
 * reactive map of every video publication (local + remote) for the call stage.
 * useVoice stays the audio/connection authority; this file owns video only.
 */
import { reactive, markRaw } from 'vue'
import {
  Track,
  type RemoteTrack, type LocalVideoTrack, type LocalTrackPublication,
  type Participant, type RemoteParticipant,
} from 'livekit-client'
import { getRoom } from './voiceRoom'
import { voiceSettings } from './useVoiceSettings'

export interface VideoTrackInfo {
  participantId: string
  name:          string
  source:        'camera' | 'screen'
  track:         RemoteTrack | LocalVideoTrack
  local:         boolean
}

interface MediaState {
  localCamOn:    boolean
  localScreenOn: boolean
  videoTracks:   Map<string, VideoTrackInfo>   // key = `${identity}:${source}`
}

export const media = reactive<MediaState>({
  localCamOn: false,
  localScreenOn: false,
  videoTracks: new Map(),
})

// Fixed P1 encodings (picker is P2).
const CAM_RES    = { width: 1280, height: 720 }
const SCREEN_RES = { width: 1920, height: 1080 }

const keyFor = (identity: string, source: 'camera' | 'screen') => `${identity}:${source}`
const srcOf  = (s: Track.Source): 'camera' | 'screen' | null =>
  s === Track.Source.Camera ? 'camera' : s === Track.Source.ScreenShare ? 'screen' : null

// After a local publish resolves, read the freshly-created publication's track
// and register it so the local user sees their own tile.
const registerLocalVideo = (source: Track.Source) => {
  const room = getRoom(); if (!room) return
  const s = srcOf(source); if (!s) return
  const pub = room.localParticipant.getTrackPublication(source)
  const track = pub?.track as LocalVideoTrack | undefined
  if (!track) return
  media.videoTracks.set(keyFor(room.localParticipant.identity, s), {
    participantId: room.localParticipant.identity,
    name: room.localParticipant.name || 'You',
    source: s, track: markRaw(track), local: true,
  })
}
const unregisterLocalVideo = (source: 'camera' | 'screen') => {
  const room = getRoom(); if (!room) return
  media.videoTracks.delete(keyFor(room.localParticipant.identity, source))
}

// Friendly message for a failed camera start (returned to the UI for a toast).
const cameraErrorMessage = (e: unknown): string => {
  const name = (e as DOMException)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found'
  if (name === 'NotReadableError' || name === 'AbortError') return 'Camera is in use by another app'
  return "Couldn't start the camera"
}

// Both toggles resolve to null on success, or a user-facing error message the
// caller should surface (toast) — a silent no-op button reads as "broken".
export const toggleCamera = async (): Promise<string | null> => {
  const room = getRoom(); if (!room) return null
  const next = !room.localParticipant.isCameraEnabled
  try {
    await room.localParticipant.setCameraEnabled(next, {
      deviceId: voiceSettings.cameraDeviceId || undefined,
      resolution: CAM_RES,
    })
    media.localCamOn = next
    next ? registerLocalVideo(Track.Source.Camera) : unregisterLocalVideo('camera')
    return null
  } catch (e) {
    console.warn('[voice-media] camera toggle failed', e)
    media.localCamOn = room.localParticipant.isCameraEnabled
    // Only the enable direction warrants a toast; a failed disable is invisible.
    return next ? cameraErrorMessage(e) : null
  }
}

export const toggleScreenShare = async (): Promise<string | null> => {
  const room = getRoom(); if (!room) return null
  const next = !room.localParticipant.isScreenShareEnabled
  try {
    await room.localParticipant.setScreenShareEnabled(next, {
      audio: voiceSettings.screenAudio,
      resolution: SCREEN_RES,
      // Keep the call's own audio out of the capture: hide Skycord's tab from
      // the share picker, and drop the "share system audio" option on monitor
      // captures (system audio always contains the call → far side hears
      // themselves). Tab shares still offer that tab's audio, which is safe.
      selfBrowserSurface: 'exclude',
      systemAudio: 'exclude',
    })
    media.localScreenOn = next
    next ? registerLocalVideo(Track.Source.ScreenShare) : unregisterLocalVideo('screen')
    return null
  } catch (e) {
    console.warn('[voice-media] screen share toggle cancelled/failed', e)
    media.localScreenOn = room.localParticipant.isScreenShareEnabled
    // Cancelling the OS picker rejects with NotAllowedError — that's a user
    // choice, not a failure; stay silent. Anything else deserves a toast.
    const name = (e as DOMException)?.name
    if (!next || name === 'NotAllowedError') return null
    return "Couldn't start screen share"
  }
}

export const addRemoteVideo = (track: RemoteTrack, participant: RemoteParticipant) => {
  if (track.kind !== Track.Kind.Video) return
  const s = srcOf(track.source); if (!s) return
  media.videoTracks.set(keyFor(participant.identity, s), {
    participantId: participant.identity,
    name: participant.name || participant.identity,
    source: s, track: markRaw(track), local: false,
  })
}

export const removeRemoteVideo = (track: RemoteTrack, participant?: Participant) => {
  if (!participant) return
  const s = srcOf(track.source); if (!s) return
  media.videoTracks.delete(keyFor(participant.identity, s))
}

// Sync local flags + map when a local track is unpublished OUTSIDE our toggles —
// e.g. Chrome's native "Stop sharing" bar, or a camera device ending mid-call.
// Without this the button stays green and a dead tile lingers (frozen LIVE).
// Idempotent, so it also firing for our own toggle-off path is harmless.
export const onLocalTrackUnpublished = (pub: LocalTrackPublication) => {
  const room = getRoom(); if (!room) return
  const s = srcOf(pub.source); if (!s) return
  media.videoTracks.delete(keyFor(room.localParticipant.identity, s))
  media.localCamOn = room.localParticipant.isCameraEnabled
  media.localScreenOn = room.localParticipant.isScreenShareEnabled
}

// State-only reset for teardown/cleanup. The Room disconnect (in useVoice)
// tears down the actual tracks; we just clear flags + the map, and never
// auto-republish on reconnect.
export const stopMedia = () => {
  media.localCamOn = false
  media.localScreenOn = false
  media.videoTracks.clear()
}

export const useVoiceMedia = () => ({
  media, toggleCamera, toggleScreenShare, addRemoteVideo, removeRemoteVideo, onLocalTrackUnpublished, stopMedia,
})
