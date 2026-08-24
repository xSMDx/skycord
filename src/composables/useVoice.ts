/**
 * useVoice — one active LiveKit Room at a time, for DM/group voice calls.
 * Phase 1 is audio only: publish the mic, subscribe + play remote audio, expose
 * reactive participant/mute/deafen state, and keep the server presence in sync
 * (call:join / call:leave) so others see the call.
 */
import { reactive, watch } from 'vue'
import {
  Room, RoomEvent, Track,
  type RemoteTrack, type RemoteParticipant, type Participant, type LocalAudioTrack,
} from 'livekit-client'
import { createMicChainProcessor, type MicChainProcessor } from './micChain'
import { holdPresence } from './usePresence'
import { useApi } from './useApi'
import { getRoom, setRoom } from './voiceRoom'
import {
  emitCallJoin, emitCallLeave, getSocket,
  soundCallJoin, soundCallLeave, soundUserJoin, soundUserLeave,
  soundMute, soundUnmute, soundDeafen, soundUndeafen,
} from './useSocket'
import { voiceSettings, setVoiceSettings, micCaptureOptions, gateThreshold, micChainNeeded } from './useVoiceSettings'
import { addRemoteVideo, removeRemoteVideo, onRemoteVideoMuted, onRemoteVideoUnmuted, purgeParticipantVideos, onLocalTrackUnpublished, stopMedia, media } from './useVoiceMedia'
import { resetRtcStats } from './useRtcStats'

export interface VoiceParticipant {
  id:       string   // userId (LiveKit identity)
  name:     string
  speaking: boolean
  muted:    boolean
  local:    boolean
}

export type VoiceQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'
// Granular join progress, surfaced to the UI while connecting. 'no-route' is the
// red "couldn't reach the server" flash shown between auto-retry attempts.
export type ConnectStage = 'finding-server' | 'connecting' | 'authenticating' | 'rtc-connecting' | 'no-route' | 'failed' | 'connected' | null

interface VoiceState {
  activeConvId: string | null
  activeKind:   'dm' | 'group' | 'channel' | null
  activeName:   string
  connecting:   boolean
  connectStage: ConnectStage       // which step of the join we're on
  connectAttempt: number           // 1 = first try, >1 = auto-retrying ("Trying again…")
  connectingConvId: string | null  // which conv is mid-join (activeConvId isn't set until connected)
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
  connecting: false, connectStage: null, connectAttempt: 0, connectingConvId: null, connected: false,
  localMuted: false, localDeafened: false, participants: [],
  ping: null, quality: 'unknown', micBlocked: false,
})

const audioEls = new Map<string, HTMLAudioElement>()   // trackSid -> <audio>
let muteBeforeDeafen = false
let pttBound = false
let statsTimer: ReturnType<typeof setInterval> | null = null
let connectSeq = 0   // bumped per connect() attempt; lets a superseded join bail out
let retryTimer: ReturnType<typeof setTimeout> | null = null
let failTimer: ReturnType<typeof setTimeout> | null = null
let intentionalLeave = false  // true while WE tear the room down, so the Disconnected
                              // handler doesn't try to reconnect our own hangup
const RETRY_DELAY_MS = 1600   // pause on the red "No route" flash before retrying
const MAX_ATTEMPTS   = 14     // keep retrying this many times before giving up
const FAIL_HOLD_MS   = 10000  // show "Couldn't connect" this long, then auto-leave

// Disconnect + drop audio/stats WITHOUT clearing the call identity, so a retry or
// auto-reconnect can reuse activeConvId/activeName. (cleanup() does the full reset.)
const teardownRoom = () => {
  const r = getRoom(); setRoom(null)
  if (r) r.disconnect().catch(() => {})
  audioEls.forEach(el => el.remove()); audioEls.clear()
  unbindPtt()
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null }
  stopLocalLevel()
  stopMedia()
}

// Best-effort round-trip time from the underlying WebRTC peer connection. The
// engine internals are private + version-specific, so this is all guarded and
// simply leaves ping null if the path isn't there.
const readRtt = async () => {
  try {
    const eng: any = (getRoom() as any)?.engine
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

// ── Local speaking detection ────────────────────────────────────────────────
// LiveKit's ActiveSpeakersChanged round-trips through the server (~300ms+),
// which makes your own ring feel laggy. Run a local analyser over the mic
// track instead: your ring reacts within a frame; remote rings keep the
// server-driven path. Rebinds automatically when the mic track is replaced
// (device switch), and goes quiet when muted/deafened.
let levelCtx: AudioContext | null = null
let levelAnalyser: AnalyserNode | null = null
let levelSrc: MediaStreamAudioSourceNode | null = null
let levelData: Uint8Array<ArrayBuffer> | null = null
let levelTrack: MediaStreamTrack | null = null
let levelRaf = 0
let lastLoudAt = 0
const SPEAK_HANGOVER_MS = 250

const setLocalSpeaking = (on: boolean) => {
  const me = voice.participants.find(p => p.local)
  if (me && me.speaking !== on)
    voice.participants = voice.participants.map(p => (p.local ? { ...p, speaking: on } : p))
}

const bindLevelSource = async (t: MediaStreamTrack | null) => {
  levelSrc?.disconnect(); levelSrc = null
  levelAnalyser = null; levelData = null
  levelTrack = t
  if (!t) return
  try {
    if (!levelCtx) levelCtx = new AudioContext()
    await levelCtx.resume()
    if (levelTrack !== t) return   // superseded by a newer bind while resuming
    levelSrc = levelCtx.createMediaStreamSource(new MediaStream([t]))
    levelAnalyser = levelCtx.createAnalyser()
    levelAnalyser.fftSize = 512
    levelSrc.connect(levelAnalyser)   // analysis only — never to destination
    levelData = new Uint8Array(new ArrayBuffer(levelAnalyser.frequencyBinCount))
  } catch { /* bind failed — local ring stays off until the next track change */ }
}

const levelTick = () => {
  levelRaf = requestAnimationFrame(levelTick)
  const room = getRoom(); if (!room) return
  const t = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack ?? null
  if (t !== levelTrack) { void bindLevelSource(t) }
  if (!levelAnalyser || !levelData) { setLocalSpeaking(false); return }
  levelAnalyser.getByteTimeDomainData(levelData)
  let peak = 0
  for (const v of levelData) peak = Math.max(peak, Math.abs(v - 128))
  // Same 0..1 scale, and the same maths, the gate and the settings meter use —
  // so the ring lights exactly when you are actually transmitting. (This reads
  // the PUBLISHED track, which is the gate's output once the chain is on.) The
  // floor stops sensitivity 0, a gate that never closes, pinning the ring lit.
  const level     = Math.min(1, (peak / 128) * 1.6)
  const threshold = Math.max(gateThreshold(), 0.02)
  const now = performance.now()
  if (level >= threshold) lastLoudAt = now
  setLocalSpeaking(!voice.localMuted && !voice.localDeafened && now - lastLoudAt < SPEAK_HANGOVER_MS)
}

const startLocalLevel = () => { if (!levelRaf) levelTick() }
const stopLocalLevel = () => {
  cancelAnimationFrame(levelRaf); levelRaf = 0
  levelSrc?.disconnect(); levelSrc = null
  levelAnalyser = null; levelData = null; levelTrack = null
  levelCtx?.close().catch(() => {}); levelCtx = null
}

// Room name for a conversation, matching the server. Two server-side copies of
// this exact rule: voiceController.roomFor and chatSocket's callRoom — if you
// change the naming here, change both of those too (see
// src/composables/__tests__/voiceRoomName.test.ts).
/**
 * Being in a call vouches for you.
 *
 * The idle watcher can only see this tab: it counts mouse moves and key
 * presses, so alt-tabbing to a game while talking used to mark you idle
 * while people were listening to you. A live call is better evidence of
 * presence than any of that, so it holds the countdown open.
 *
 * A watcher rather than a call beside each of the five places that assign
 * `connected` — those drift, and a missed one leaves presence pinned open
 * for the rest of the session.
 */
watch(() => voice.connected, held => holdPresence(held), { immediate: true })

/**
 * Tell the server what we are doing in the call, so everyone else can see it.
 *
 * Mute, deafen and screen-share are all invisible to other clients from where
 * they sit: LiveKit only reports on the room you are personally connected to,
 * and deafening publishes nothing at all because it is a decision about
 * playback. The sidebar has to show these for every voice channel in the
 * server, so the facts go to the server and come back with the occupancy.
 *
 * Only while connected. The server ignores state from someone not in a call,
 * and emitting on the way out would be a payload that describes nothing.
 * Reconnecting re-sends, because the socket that held it is gone; the server
 * drops a duplicate rather than fanning it out again.
 */
watch(
  () => [voice.connected, voice.localMuted, voice.localDeafened, media.localScreenOn] as const,
  ([connected, muted, deafened, sharing]) => {
    if (!connected) return
    getSocket()?.emit('voice:state', { muted, deafened, sharing })
  },
  { immediate: true },
)
export const voiceRoomName = (kind: 'dm' | 'group' | 'channel', convId: string, myId: string) =>
  kind === 'channel' ? `voice:${convId}`
  : kind === 'group' ? `group:${convId}`
  : `dm:${[myId, convId].sort().join('_')}`

/**
 * Is `channelId` the ONE voice channel you're actually connected to right now?
 *
 * `voice.participants` only ever holds the occupants of your own call, but
 * that alone doesn't stop a caller from applying it to the wrong room: if
 * server presence ever lists the same user in two rooms at once — a stale
 * `call:join` whose matching `call:leave` never arrived — a speaking lookup
 * keyed purely on user id would light that person up as speaking in a
 * channel you aren't even in. Scoping every such lookup through this check
 * first (see ChatApp.vue's `voiceOccupants`) closes that: a row only ever
 * reflects live speaking state for the room LiveKit actually has you in.
 */
export const isConnectedVoiceRoom = (channelId: string) => voice.activeConvId === channelId

// ── Per-participant local controls ──────────────────────────────────────────
// Purely local: muting someone or dropping their volume affects only your ears,
// and disabling their video only your screen. Nothing is sent to the server, so
// the other person is never told — which is the point.
export interface UserAudioPref { volume: number; muted: boolean; videoOff: boolean }
export const userPrefs = reactive<Record<string, UserAudioPref>>({})

export const userPref = (identity: string): UserAudioPref =>
  userPrefs[identity] ?? { volume: 100, muted: false, videoOff: false }

// audioEls is keyed by track sid; this maps a sid back to whose track it is, so
// a per-user volume change can find the right elements.
const audioOwner = new Map<string, string>()

export const setUserPref = (identity: string, patch: Partial<UserAudioPref>) => {
  userPrefs[identity] = { ...userPref(identity), ...patch }
  // Re-apply to EVERY element, not just the ones audioOwner claims belong to
  // this identity. Each element is recomputed from its own owner, so this is
  // idempotent for the others — and it means a missing owner entry (a track
  // subscribed before the map existed, a reconnect) degrades to "applies late"
  // rather than "unmute silently does nothing".
  audioEls.forEach((el, sid) => applyAudioEl(el, audioOwner.get(sid)))
}

/**
 * Diagnostic for the per-user audio controls, callable from the console during
 * a call: `(await import('/src/composables/useVoice.ts')).debugAudio()`.
 *
 * Reports the whole chain at once — who the room thinks is present, what the
 * owner map believes each audio element belongs to, the prefs recorded against
 * each identity, and the element's ACTUAL live muted/volume state. A mismatch
 * between any two of those localises the bug immediately, which reading the
 * code could not.
 */
export const debugAudio = () => {
  const room = getRoom()
  const els: any[] = []
  audioEls.forEach((el, sid) => {
    const owner = audioOwner.get(sid)
    els.push({
      sid,
      owner: owner ?? '(NO OWNER — mute cannot target this element)',
      prefForOwner: owner ? userPref(owner) : null,
      liveElementMuted:  el.muted,
      liveElementVolume: +el.volume.toFixed(3),
      elementInDom: document.body.contains(el),
      readyState: el.readyState,
      paused: el.paused,
      srcObjectTracks: (el.srcObject as MediaStream | null)?.getAudioTracks().length ?? 0,
    })
  })
  return {
    roomIdentities: room ? [...room.remoteParticipants.values()].map(p => p.identity) : [],
    localIdentity: room?.localParticipant.identity,
    tileIdentities: voice.participants.map(p => ({ id: p.id, local: p.local })),
    prefsKeys: Object.keys(userPrefs),
    prefs: JSON.parse(JSON.stringify(userPrefs)),
    audioElements: els,
    deafened: voice.localDeafened,
  }
}

const applyAudioEl = (el: HTMLAudioElement, identity?: string) => {
  const u = identity ? userPref(identity) : { volume: 100, muted: false, videoOff: false }
  // Per-user volume multiplies the global output level rather than replacing it.
  el.volume = ((voiceSettings.outputVolume ?? 100) / 100) * (u.volume / 100)
  const sink = voiceSettings.outputDeviceId
  if (sink && typeof (el as any).setSinkId === 'function') (el as any).setSinkId(sink).catch(() => {})
  el.muted = voice.localDeafened || u.muted
}

const attachTrack = (track: RemoteTrack, identity?: string) => {
  if (track.kind !== Track.Kind.Audio) return
  const el = track.attach() as HTMLAudioElement
  el.autoplay = true
  ;(el as any).playsInline = true
  el.style.display = 'none'
  if (track.sid && identity) audioOwner.set(track.sid, identity)
  applyAudioEl(el, identity)
  document.body.appendChild(el)
  audioEls.set(track.sid!, el)
}
const detachTrack = (track: RemoteTrack) => {
  track.detach().forEach(el => el.remove())
  if (track.sid) { audioEls.delete(track.sid); audioOwner.delete(track.sid) }
}

const syncParticipants = () => {
  const room = getRoom()
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
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
    if (track.kind === Track.Kind.Video) addRemoteVideo(track, participant)
    else attachTrack(track, participant.identity)
    syncParticipants()
  })
  r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant) => {
    if (track.kind === Track.Kind.Video) removeRemoteVideo(track, participant)
    else detachTrack(track)
    syncParticipants()
  })
  r.on(RoomEvent.LocalTrackUnpublished, (pub) => { onLocalTrackUnpublished(pub); syncParticipants() })
  // Catches EVERY way a mic track appears — normal join, a push-to-talk keypress
  // (which publishes on demand, and so never hit the join-time call), or a device
  // switch — so the chain is always applied to the live track.
  r.on(RoomEvent.LocalTrackPublished, (pub) => {
    if (pub.source === Track.Source.Microphone) void applyMicChain()
  })
  r.on(RoomEvent.ParticipantConnected, () => { soundUserJoin(); syncParticipants() })
  r.on(RoomEvent.ParticipantDisconnected, (p) => { purgeParticipantVideos(p.identity); soundUserLeave(); syncParticipants() })
  // Camera-off MUTES the publication (no unpublish → no TrackUnsubscribed on the
  // far side), so mirror video mute/unmute into the tile map or remote viewers
  // keep a frozen black tile.
  r.on(RoomEvent.TrackMuted, (pub, p) => { if (pub.kind === Track.Kind.Video) onRemoteVideoMuted(pub, p); syncParticipants() })
  r.on(RoomEvent.TrackUnmuted, (pub, p) => { if (pub.kind === Track.Kind.Video) onRemoteVideoUnmuted(pub, p); syncParticipants() })
  r.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    const ids = new Set(speakers.map(s => s.identity))
    // Local ring is analyser-driven (instant); server list only updates remotes.
    voice.participants = voice.participants.map(p => (p.local ? p : { ...p, speaking: ids.has(p.id) }))
  })
  r.on(RoomEvent.ConnectionQualityChanged, (q: any, p: Participant) => {
    if (p?.isLocal) voice.quality = (q as VoiceQuality) || 'unknown'
  })
  r.on(RoomEvent.Disconnected, () => {
    // Our own hangup, or a failure during the initial join (handled by
    // attemptConnect's catch): let those paths finish, don't reconnect.
    if (intentionalLeave || !voice.connected) return
    // An ESTABLISHED call dropped unexpectedly → self-heal: tear down the dead
    // room (keeping the call identity) and run the same retry cycle to rejoin.
    const convId = voice.activeConvId, kind = voice.activeKind, name = voice.activeName
    teardownRoom()
    voice.connected = false
    if (convId && kind) { void attemptConnect(convId, kind, name, 1) }
    else cleanup()
  })
}

const cleanup = () => {
  // Always disconnect the LiveKit room — dropping the reference without
  // disconnecting leaves an orphaned session that auto-reconnects forever
  // (the "data channel closed → connecting → repeat" loop) and keeps the
  // half-joined user visible to everyone else.
  const r = getRoom()
  setRoom(null)
  if (r) r.disconnect().catch(() => {})
  audioEls.forEach(el => el.remove())
  audioEls.clear()
  unbindPtt()
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  if (failTimer)  { clearTimeout(failTimer);  failTimer = null }
  intentionalLeave = false
  stopLocalLevel()
  stopMedia()
  // Clear server-side call presence even when LiveKit dropped on its own
  // (RoomEvent.Disconnected → cleanup, NOT via leave()). Without this, an
  // unexpected media drop leaves you a ghost participant in everyone else's
  // call banner until your whole socket disconnects. Idempotent server-side.
  if (voice.activeConvId && voice.activeKind) emitCallLeave(voice.activeConvId, voice.activeKind)
  voice.connected = false
  voice.connecting = false
  voice.connectStage = null
  voice.connectAttempt = 0
  voice.connectingConvId = null
  voice.activeConvId = null
  voice.activeKind = null
  voice.activeName = ''
  voice.participants = []
  voice.localMuted = false
  voice.localDeafened = false
  voice.ping = null
  voice.quality = 'unknown'
  voice.micBlocked = false
  // Graphs and counters belong to one call; the next one starts empty.
  resetRtcStats()
}

// ── Push-to-talk ────────────────────────────────────────────────────────────
const onPttDown = (e: KeyboardEvent) => {
  if (e.code !== voiceSettings.pttKey || e.repeat) return
  const room = getRoom()
  if (room && !voice.localDeafened) room.localParticipant.setMicrophoneEnabled(true).catch(() => {})
}
const onPttUp = (e: KeyboardEvent) => {
  if (e.code !== voiceSettings.pttKey) return
  const room = getRoom()
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

// ── Mic processing chain ────────────────────────────────────────────────────
// RNNoise, the sensitivity gate and the input-volume stage all ride on the mic
// publication as one LiveKit processor, so mute, PTT, device switching and the
// speaking analyser keep working on the same track.
// A failure here must never cost the user their microphone: drop back to the
// raw capture (plus the browser's own suppression) instead.
// Serialised: toggling twice quickly would otherwise let the second call read
// getProcessor() before the first setProcessor() resolved, leaving the pipeline
// out of sync with the setting. Each run re-reads the CURRENT settings, so the
// last intent always wins.
let micChainQueue: Promise<void> = Promise.resolve()

const applyMicChainNow = async () => {
  const room = getRoom(); if (!room) return
  const mic = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined
  if (!mic) return
  const want    = micChainNeeded()
  const wantRnn = voiceSettings.noiseMode === 'rnnoise'
  const current = mic.getProcessor() as MicChainProcessor | undefined
  const has     = current?.name === 'mic-chain'
  try {
    if (want && has) {
      // Adding or removing RNNoise changes the shape of the graph, so that one
      // needs a rebuild. Slider moves are just parameter changes — updating in
      // place avoids a rebuild's brief gap in the outgoing audio.
      if (current!.usesRnnoise !== wantRnn) await mic.setProcessor(createMicChainProcessor(wantRnn))
      else current!.update()
    }
    else if (want && !has) await mic.setProcessor(createMicChainProcessor(wantRnn))
    else if (!want && has) await mic.stopProcessor()
  } catch (e) {
    console.warn('[voice] mic chain unavailable — publishing the raw capture', e)
    // Only the RNNoise leg can realistically fail (wasm/worklet load). Fall back
    // to the browser filter rather than leaving the user on a dead processor.
    if (wantRnn) setVoiceSettings({ noiseMode: 'standard' })
    try { await mic.stopProcessor() } catch { /* ignore */ }
    // Re-apply capture constraints so the browser filter actually comes back on.
    try { await room.localParticipant.setMicrophoneEnabled(true, micCaptureOptions()) } catch { /* ignore */ }
  }
}

const applyMicChain = (): Promise<void> => {
  micChainQueue = micChainQueue.then(applyMicChainNow, applyMicChainNow)
  return micChainQueue
}

// Every one of these takes effect immediately mid-call — no rejoin. Sensitivity
// and volume in particular were previously wired only into the mic test, so
// moving them did nothing to what the other side actually heard.
watch(() => [voiceSettings.noiseMode, voiceSettings.sensitivity,
             voiceSettings.inputVolume, voiceSettings.inputMode],
      () => { void applyMicChain() })

// Module-scoped (not inside useVoice) so wireRoom's Disconnected handler can
// reach attemptConnect to auto-reconnect. useApi/useAuth are plain singletons,
// safe to read here at import time; getVoiceToken reads the token at call time.
const { getVoiceToken } = useApi()

const connect = async (convId: string, kind: 'dm' | 'group' | 'channel', name: string) => {
    // Already in — or already joining — this exact call: no-op. Guarding the
    // join window (connectingConvId, since activeConvId isn't set until success)
    // is what stops a second click/accept during the ~1s join from spinning up a
    // duplicate LiveKit session with the same identity (the DUPLICATE_IDENTITY
    // reconnect loop).
    if (voice.connecting && voice.connectingConvId === convId) return
    if (voice.connected  && voice.activeConvId     === convId && voice.activeKind === kind) return
    // Switching calls (or recovering from a stale attempt): fully tear the old
    // room down before opening a new one, so we never hold two sessions at once.
    if (getRoom() || voice.connected || voice.connecting) await leave()
    void attemptConnect(convId, kind, name, 1)
  }

  // One join attempt. On failure it flashes "No route" (red) and schedules the
  // next attempt automatically — so the user never has to spam the call button;
  // they just watch it retry until it lands (or hit Cancel).
  const attemptConnect = async (convId: string, kind: 'dm' | 'group' | 'channel', name: string, attempt: number) => {
    const seq = ++connectSeq
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    if (failTimer)  { clearTimeout(failTimer);  failTimer = null }
    intentionalLeave = false
    voice.connecting = true
    voice.connectAttempt = attempt
    voice.connectStage = attempt === 1 ? 'finding-server' : 'connecting'
    voice.connectingConvId = convId
    voice.activeName = name   // set now so the "Connecting…" strip can label the call
    try {
      const { token, url } = await getVoiceToken(convId, kind)
      if (seq !== connectSeq) return                                  // superseded while fetching token
      voice.connectStage = 'connecting'
      const r = new Room({ adaptiveStream: true, dynacast: true })
      wireRoom(r)
      // Signal channel up (token accepted by the server) → past auth, now negotiating media.
      r.on(RoomEvent.SignalConnected, () => { if (seq === connectSeq) voice.connectStage = 'rtc-connecting' })
      voice.connectStage = 'authenticating'
      await r.connect(url, token)
      if (seq !== connectSeq) { r.disconnect().catch(() => {}); return } // superseded mid-connect
      setRoom(r)
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
        await applyMicChain()
      }
      voice.connected = true
      voice.connecting = false
      voice.connectStage = 'connected'
      voice.connectAttempt = 0
      voice.connectingConvId = null
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
      startLocalLevel()
    } catch (err) {
      if (seq !== connectSeq) return            // superseded by a newer attempt / cancel
      console.warn(`[voice] attempt ${attempt} failed`, err)
      teardownRoom()                            // drop the half-open room, keep the call target
      voice.connected = false
      if (attempt < MAX_ATTEMPTS) {
        voice.connectStage = 'no-route'         // red flash; voice.connecting stays true so the strip persists
        retryTimer = setTimeout(() => { void attemptConnect(convId, kind, name, attempt + 1) }, RETRY_DELAY_MS)
      } else {
        giveUp()                                 // out of tries → "Couldn't connect", auto-leave after a hold
      }
    }
  }

  // Exhausted all attempts: stop trying, show a terminal red "Couldn't connect"
  // in the network strip, then auto-leave the call after FAIL_HOLD_MS.
  const giveUp = () => {
    voice.connecting = false
    voice.connected = false
    voice.connectStage = 'failed'
    voice.connectAttempt = 0
    if (failTimer) clearTimeout(failTimer)
    failTimer = setTimeout(() => { void leave() }, FAIL_HOLD_MS)
  }

  const leave = async () => {
    // Cancel any pending retry/fail-hold + invalidate in-flight attempts, and mark
    // this as deliberate so the Disconnected handler won't try to reconnect.
    intentionalLeave = true
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    if (failTimer)  { clearTimeout(failTimer);  failTimer = null }
    connectSeq++
    if (voice.connected) soundCallLeave()   // only the leave chime if we were actually in
    // call:leave is emitted by cleanup() (covers both this path and unexpected
    // LiveKit drops), so we don't emit it here too.
    try { await getRoom()?.disconnect() } catch { /* ignore */ }
    cleanup()
  }

  const toggleMute = () => {
    const room = getRoom()
    if (!room) return
    voice.localMuted = !voice.localMuted
    voice.localMuted ? soundMute() : soundUnmute()
    room.localParticipant.setMicrophoneEnabled(!voice.localMuted, micCaptureOptions()).catch(() => {})
    if (!voice.localMuted && voice.localDeafened) voice.localDeafened = false
    syncParticipants()
  }

  const toggleDeafen = () => {
    const room = getRoom()
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
      // Not a blanket unmute: someone you muted individually must STAY muted
      // when you undeafen, or undeafening silently undoes those choices.
      audioEls.forEach((el, sid) => applyAudioEl(el, audioOwner.get(sid)))
    }
    syncParticipants()
  }

// Re-apply output volume / sink to live audio elements (called from settings).
const applyOutput = () => audioEls.forEach((el, sid) => applyAudioEl(el, audioOwner.get(sid)))

export const useVoice = () => ({ voice, voiceRoomName, connect, leave, toggleMute, toggleDeafen, applyOutput })
