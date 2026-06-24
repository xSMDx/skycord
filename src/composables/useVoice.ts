/**
 * useVoice — one active LiveKit Room at a time, for DM/group voice calls.
 * Phase 1 is audio only: publish the mic, subscribe + play remote audio, expose
 * reactive participant/mute/deafen state, and keep the server presence in sync
 * (call:join / call:leave) so others see the call.
 */
import { reactive } from 'vue'
import {
  Room, RoomEvent, Track,
  type RemoteTrack, type RemoteParticipant, type Participant,
} from 'livekit-client'
import { useApi } from './useApi'
import {
  useSocket,
  soundCallJoin, soundCallLeave, soundUserJoin, soundUserLeave,
  soundMute, soundUnmute, soundDeafen, soundUndeafen,
} from './useSocket'
import { voiceSettings, micCaptureOptions } from './useVoiceSettings'

export interface VoiceParticipant {
  id:       string   // userId (LiveKit identity)
  name:     string
  speaking: boolean
  muted:    boolean
  local:    boolean
}

export type VoiceQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'

interface VoiceState {
  activeConvId: string | null
  activeKind:   'dm' | 'group' | null
  activeName:   string
  connecting:   boolean
  connected:    boolean
  localMuted:   boolean
  localDeafened: boolean
  participants: VoiceParticipant[]
  ping:         number | null      // round-trip ms, null until first sample
  quality:      VoiceQuality       // LiveKit connection quality
  micBlocked:   boolean            // joined listen-only (no mic — needs HTTPS/localhost)
}

export const voice = reactive<VoiceState>({
  activeConvId: null, activeKind: null, activeName: '',
  connecting: false, connected: false,
  localMuted: false, localDeafened: false, participants: [],
  ping: null, quality: 'unknown', micBlocked: false,
})

let room: Room | null = null
const audioEls = new Map<string, HTMLAudioElement>()   // trackSid -> <audio>
let muteBeforeDeafen = false
let pttBound = false
let statsTimer: ReturnType<typeof setInterval> | null = null
let connectSeq = 0   // bumped per connect() attempt; lets a superseded join bail out

// Best-effort round-trip time from the underlying WebRTC peer connection. The
// engine internals are private + version-specific, so this is all guarded and
// simply leaves ping null if the path isn't there.
const readRtt = async () => {
  try {
    const eng: any = (room as any)?.engine
    const pc: RTCPeerConnection | undefined =
      eng?.pcManager?.publisher?.pc ?? eng?.pcManager?.subscriber?.pc ??
      eng?.publisher?.pc ?? eng?.subscriber?.pc
    if (!pc?.getStats) return
    const stats = await pc.getStats()
    let rtt: number | null = null
    stats.forEach((r: any) => {
      if (r.type === 'candidate-pair' && r.nominated && typeof r.currentRoundTripTime === 'number') {
        rtt = Math.round(r.currentRoundTripTime * 1000)
      }
    })
    if (rtt !== null) voice.ping = rtt
  } catch { /* ignore */ }
}

// Room name for a conversation, matching the server (voiceController.roomFor).
export const voiceRoomName = (kind: 'dm' | 'group', convId: string, myId: string) =>
  kind === 'group' ? `group:${convId}` : `dm:${[myId, convId].sort().join('_')}`

const applyAudioEl = (el: HTMLAudioElement) => {
  el.volume = (voiceSettings.outputVolume ?? 100) / 100
  const sink = voiceSettings.outputDeviceId
  if (sink && typeof (el as any).setSinkId === 'function') (el as any).setSinkId(sink).catch(() => {})
  el.muted = voice.localDeafened
}

const attachTrack = (track: RemoteTrack) => {
  if (track.kind !== Track.Kind.Audio) return
  const el = track.attach() as HTMLAudioElement
  el.autoplay = true
  ;(el as any).playsInline = true
  el.style.display = 'none'
  applyAudioEl(el)
  document.body.appendChild(el)
  audioEls.set(track.sid!, el)
}
const detachTrack = (track: RemoteTrack) => {
  track.detach().forEach(el => el.remove())
  if (track.sid) audioEls.delete(track.sid)
}

const syncParticipants = () => {
  if (!room) { voice.participants = []; return }
  const list: VoiceParticipant[] = []
  const lp = room.localParticipant
  list.push({ id: lp.identity, name: lp.name || 'You', speaking: lp.isSpeaking, muted: !lp.isMicrophoneEnabled, local: true })
  room.remoteParticipants.forEach((p: RemoteParticipant) => {
    list.push({ id: p.identity, name: p.name || p.identity, speaking: p.isSpeaking, muted: !p.isMicrophoneEnabled, local: false })
  })
  voice.participants = list
}

const wireRoom = (r: Room) => {
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => { attachTrack(track); syncParticipants() })
  r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => { detachTrack(track); syncParticipants() })
  r.on(RoomEvent.ParticipantConnected, () => { soundUserJoin(); syncParticipants() })
  r.on(RoomEvent.ParticipantDisconnected, () => { soundUserLeave(); syncParticipants() })
  r.on(RoomEvent.TrackMuted, syncParticipants)
  r.on(RoomEvent.TrackUnmuted, syncParticipants)
  r.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    const ids = new Set(speakers.map(s => s.identity))
    voice.participants = voice.participants.map(p => ({ ...p, speaking: ids.has(p.id) }))
  })
  r.on(RoomEvent.ConnectionQualityChanged, (q: any, p: Participant) => {
    if (p?.isLocal) voice.quality = (q as VoiceQuality) || 'unknown'
  })
  r.on(RoomEvent.Disconnected, () => { cleanup() })
}

const cleanup = () => {
  // Always disconnect the LiveKit room — dropping the reference without
  // disconnecting leaves an orphaned session that auto-reconnects forever
  // (the "data channel closed → connecting → repeat" loop) and keeps the
  // half-joined user visible to everyone else.
  const r = room
  room = null
  if (r) r.disconnect().catch(() => {})
  audioEls.forEach(el => el.remove())
  audioEls.clear()
  unbindPtt()
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null }
  voice.connected = false
  voice.connecting = false
  voice.activeConvId = null
  voice.activeKind = null
  voice.activeName = ''
  voice.participants = []
  voice.localMuted = false
  voice.localDeafened = false
  voice.ping = null
  voice.quality = 'unknown'
  voice.micBlocked = false
}

// ── Push-to-talk ────────────────────────────────────────────────────────────
const onPttDown = (e: KeyboardEvent) => {
  if (e.code !== voiceSettings.pttKey || e.repeat) return
  if (room && !voice.localDeafened) room.localParticipant.setMicrophoneEnabled(true).catch(() => {})
}
const onPttUp = (e: KeyboardEvent) => {
  if (e.code !== voiceSettings.pttKey) return
  if (room) room.localParticipant.setMicrophoneEnabled(false).catch(() => {})
}
const bindPtt = () => {
  if (pttBound) return
  window.addEventListener('keydown', onPttDown)
  window.addEventListener('keyup', onPttUp)
  pttBound = true
}
const unbindPtt = () => {
  if (!pttBound) return
  window.removeEventListener('keydown', onPttDown)
  window.removeEventListener('keyup', onPttUp)
  pttBound = false
}

export const useVoice = () => {
  const { getVoiceToken } = useApi()
  const { emitCallJoin, emitCallLeave } = useSocket()

  const connect = async (convId: string, kind: 'dm' | 'group', name: string) => {
    // Already in — or already joining — this exact call: no-op. Guarding on
    // `connecting` (not just `connected`) is what stops a second click/accept
    // during the ~1s join window from spinning up a duplicate LiveKit session
    // with the same identity (the DUPLICATE_IDENTITY reconnect loop).
    if ((voice.connected || voice.connecting) && voice.activeConvId === convId && voice.activeKind === kind) return
    // Switching calls (or recovering from a stale attempt): fully tear the old
    // room down before opening a new one, so we never hold two sessions at once.
    if (room || voice.connected || voice.connecting) await leave()

    const seq = ++connectSeq
    voice.connecting = true
    try {
      const { token, url } = await getVoiceToken(convId, kind)
      if (seq !== connectSeq) return                                  // superseded while fetching token
      const r = new Room({ adaptiveStream: true, dynacast: true })
      wireRoom(r)
      await r.connect(url, token)
      if (seq !== connectSeq) { r.disconnect().catch(() => {}); return } // superseded mid-connect
      room = r
      // Mic capture needs a secure context (HTTPS or localhost); over plain
      // http on an IP, navigator.mediaDevices is undefined. Rather than throw
      // (which orphaned the room → reconnect loop), join LISTEN-ONLY so the user
      // can still hear the call, flagged so the UI can nudge them to use HTTPS.
      const canCapture = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
      if (voiceSettings.inputMode === 'ptt') {
        bindPtt()
      } else if (canCapture) {
        try { await r.localParticipant.setMicrophoneEnabled(true, micCaptureOptions()) }
        catch (e) { console.warn('[voice] mic unavailable — joining listen-only', e) }
      }
      voice.connected = true
      voice.connecting = false
      voice.activeConvId = convId
      voice.activeKind = kind
      voice.activeName = name
      voice.micBlocked = !canCapture
      voice.localMuted = voiceSettings.inputMode === 'ptt' || !canCapture
      syncParticipants()
      emitCallJoin(convId, kind)
      soundCallJoin()
      readRtt()
      statsTimer = setInterval(readRtt, 3000)
    } catch (err) {
      console.error('[voice] connect failed', err)
      if (seq === connectSeq) cleanup()
      throw err
    }
  }

  const leave = async () => {
    if (voice.activeConvId && voice.activeKind) emitCallLeave(voice.activeConvId, voice.activeKind)
    soundCallLeave()
    try { await room?.disconnect() } catch { /* ignore */ }
    cleanup()
  }

  const toggleMute = () => {
    if (!room) return
    voice.localMuted = !voice.localMuted
    voice.localMuted ? soundMute() : soundUnmute()
    room.localParticipant.setMicrophoneEnabled(!voice.localMuted, micCaptureOptions()).catch(() => {})
    if (!voice.localMuted && voice.localDeafened) voice.localDeafened = false
    syncParticipants()
  }

  const toggleDeafen = () => {
    if (!room) return
    voice.localDeafened = !voice.localDeafened
    voice.localDeafened ? soundDeafen() : soundUndeafen()
    if (voice.localDeafened) {
      muteBeforeDeafen = voice.localMuted
      voice.localMuted = true
      room.localParticipant.setMicrophoneEnabled(false).catch(() => {})
      audioEls.forEach(el => (el.muted = true))
    } else {
      voice.localMuted = muteBeforeDeafen
      room.localParticipant.setMicrophoneEnabled(!voice.localMuted, micCaptureOptions()).catch(() => {})
      audioEls.forEach(el => (el.muted = false))
    }
    syncParticipants()
  }

  // Re-apply output volume / sink to live audio elements (called from settings).
  const applyOutput = () => audioEls.forEach(applyAudioEl)

  return { voice, voiceRoomName, connect, leave, toggleMute, toggleDeafen, applyOutput }
}
