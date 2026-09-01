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
  type TrackPublication, type Participant, type RemoteParticipant,
} from 'livekit-client'
import { getRoom } from './voiceRoom'
import { voiceSettings } from './useVoiceSettings'
import { useViewport } from './useViewport'

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

export const keyFor = (identity: string, source: 'camera' | 'screen') => `${identity}:${source}`
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

// Both toggles resolve to null on success, or a user-facing error message the
// caller should surface (toast). Device-in-use failures are deliberately
// SILENT in the UI (per user request) — details go to the console instead.
export const toggleCamera = async (): Promise<string | null> => {
  const room = getRoom(); if (!room) return null
  const next = !room.localParticipant.isCameraEnabled

  if (!next) {
    try {
      await room.localParticipant.setCameraEnabled(false)
      media.localCamOn = false
      unregisterLocalVideo('camera')
    } catch (e) {
      console.warn('[voice-media] camera disable failed', e)
      media.localCamOn = room.localParticipant.isCameraEnabled
    }
    return null
  }

  // Enable: try the preferred device first, then EVERY other camera device.
  // One physical camera can't be shared across two apps on Windows, but when a
  // second device exists (virtual cam + real webcam), fall through to it
  // instead of failing.
  const candidates: (string | undefined)[] = [voiceSettings.cameraDeviceId || undefined]
  try {
    const devs = await navigator.mediaDevices.enumerateDevices()
    for (const d of devs) {
      if (d.kind === 'videoinput' && d.deviceId && d.deviceId !== voiceSettings.cameraDeviceId) {
        candidates.push(d.deviceId)
      }
    }
  } catch { /* enumeration denied — preferred/default attempt still runs */ }

  let lastErr: unknown = null
  const tried: string[] = []
  for (const id of candidates) {
    try {
      await room.localParticipant.setCameraEnabled(true, { deviceId: id, resolution: CAM_RES })
      media.localCamOn = true
      registerLocalVideo(Track.Source.Camera)
      return null
    } catch (e) {
      lastErr = e
      tried.push(id || 'default')
      const name = (e as DOMException)?.name
      // Permission denials apply to all devices — don't spam retries.
      if (name === 'NotAllowedError' || name === 'SecurityError') break
    }
  }

  console.warn('[voice-media] camera enable failed on every device', { tried, lastErr })
  media.localCamOn = room.localParticipant.isCameraEnabled
  const name = (lastErr as DOMException)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found'
  return null   // in-use/unknown: silent by design — see console for the device list tried
}

/**
 * Whether this browser can actually capture a screen.
 *
 * Feature detection ALONE lies here, and the lie is the whole reason the share
 * button appeared to do nothing on a phone. iOS Safari has no getDisplayMedia
 * at all, which detects correctly — but **Android Chrome defines the method and
 * then always rejects with NotAllowedError**. `toggleScreenShare` treats that
 * name as "the user dismissed the picker" and deliberately stays silent, which
 * is right on a desktop and useless on a phone: the button did nothing and said
 * nothing.
 *
 * So: the method must exist AND the device must not be a phone. There is no
 * capability flag that distinguishes "will really work" from "will pretend" —
 * a coarse pointer at phone width is the best available proxy, and it errs
 * toward hiding a button that would have failed anyway.
 *
 * Not fixable in a browser. Screen capture from a mobile web page needs the
 * platform's own APIs (ReplayKit / MediaProjection), i.e. the native apps.
 */
export const canScreenShare = (): boolean => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) return false
  const { isMobile, isCoarse } = useViewport()
  return !(isMobile.value && isCoarse.value)
}

export const toggleScreenShare = async (): Promise<string | null> => {
  if (!canScreenShare()) return 'Screen sharing needs the desktop app — phone browsers cannot capture a screen'
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

// Turning a camera OFF doesn't unpublish in LiveKit — it MUTES the track, so
// the far side never gets TrackUnsubscribed and would keep a frozen black tile.
// Mirror mute/unmute into the tile map: muted video = no tile (back to avatar),
// unmuted = tile returns.
export const onRemoteVideoMuted = (pub: TrackPublication, participant: Participant) => {
  if (participant.isLocal) return
  const s = srcOf(pub.source); if (!s) return
  media.videoTracks.delete(keyFor(participant.identity, s))
}
export const onRemoteVideoUnmuted = (pub: TrackPublication, participant: Participant) => {
  if (participant.isLocal) return
  const s = srcOf(pub.source); if (!s) return
  const track = pub.track as RemoteTrack | undefined
  if (!track) return
  media.videoTracks.set(keyFor(participant.identity, s), {
    participantId: participant.identity,
    name: participant.name || participant.identity,
    source: s, track: markRaw(track), local: false,
  })
}

// A participant leaving must never strand their tiles — TrackUnsubscribed
// usually handles it, but abrupt drops can skip it (the "doesn't fully
// disconnect" ghost). Purge everything they published.
export const purgeParticipantVideos = (identity: string) => {
  media.videoTracks.delete(keyFor(identity, 'camera'))
  media.videoTracks.delete(keyFor(identity, 'screen'))
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
  media, toggleCamera, toggleScreenShare, addRemoteVideo, removeRemoteVideo,
  onRemoteVideoMuted, onRemoteVideoUnmuted, purgeParticipantVideos,
  onLocalTrackUnpublished, stopMedia,
})
