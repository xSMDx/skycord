/**
 * useVoice — one active LiveKit Room at a time, for DM/group voice calls.
 * Phase 1 is audio only: publish the mic, subscribe + play remote audio, expose
 * reactive participant/mute/deafen state, and keep the server presence in sync
 * (call:join / call:leave) so others see the call.
 */
import { reactive, ref, watch } from 'vue'
import {
  Room, RoomEvent, Track, VideoQuality,
  type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant, type Participant,
  type LocalAudioTrack, type LocalParticipant,
} from 'livekit-client'
import { createMicChainProcessor, type MicChainProcessor } from './micChain'
import { micFailureReason, micIsLive, micAfterToggle, micStepOnPermitChange, type MicState } from './micState'
import { holdPresence } from './usePresence'
import { useAuth } from './useAuth'
import { useApi } from './useApi'
import { getRoom, setRoom } from './voiceRoom'
import { MUSIC_IDENTITY, music, musicAvailable, setMusicTarget } from './useMusic'
import { applySubscriptions } from './subscriptionPolicy'
import {
  volumePlan, sinkRoutable, sinkRefused, gainSupport, userVolumeMaxFor,
  amplify, release as releaseGain, stageGain, onGainStateChange, wakeGain, sleepGain,
} from './remoteGain'
import { qualityFor } from './callLimits'
import { perf } from './usePerformance'
import {
  emitCallJoin, emitCallLeave, emitCallRejoin, getSocket, callServerMoved,
  connected as socketConnected,
  soundCallJoin, soundCallLeave, soundUserJoin, soundUserLeave,
  soundMute, soundUnmute, soundDeafen, soundUndeafen,
} from './useSocket'
import {
  voiceSettings, setVoiceSettings, micCaptureOptions, gateThreshold, micChainNeeded,
  effectiveInputMode, noPushToTalkKey, noiseNodeFor,
} from './useVoiceSettings'
import { permits, setPermits, resetPermits, permitsFromGrant } from './voicePermits'
import { addRemoteVideo, removeRemoteVideo, onRemoteVideoMuted, onRemoteVideoUnmuted, purgeParticipantVideos, onLocalTrackUnpublished, stopMedia, syncRemoteStreams, media } from './useVoiceMedia'
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
  // When this call first connected (ms since the epoch): what the call timer
  // counts from. A reconnect to the same conversation keeps it, because the
  // media connection dropping and coming back is still one call, not a new one
  // starting at 0:00. null while not in a call.
  connectedAt:  number | null
  localMuted:   boolean
  localDeafened: boolean
  participants: VoiceParticipant[]
  ping:         number | null      // round-trip ms, null until first sample
  quality:      VoiceQuality       // LiveKit connection quality
  // What the microphone is actually doing. Replaces a `micBlocked` boolean that
  // was derived from whether the browser HAS getUserMedia, not from whether
  // publishing worked — so a refused or absent microphone read as connected
  // and unmuted, and the member talked into nothing.
  mic:          MicState
  // Where this call actually landed, as the SERVER resolved it — not what
  // was asked for. A request can fall back (the entry was deleted, the
  // channel points at another guild), and the UI must name the room people
  // are really on. null while not in a call, or on an instance with no
  // registered servers.
  voiceServer:  { id: string; name: string } | null
  /*
   * Imposed by a moderator, as opposed to merely never permitted.
   *
   * What this channel ALLOWS lives in `voicePermits`, not here — one fact, one
   * home. These two are a different fact: not "you cannot", but "somebody
   * decided you may not", which needs different words in front of the person
   * and is worth surfacing even when the capability was absent anyway.
   */
  serverMuted:   boolean
  serverDeafened: boolean
}

export const voice = reactive<VoiceState>({
  activeConvId: null, activeKind: null, activeName: '',
  connecting: false, connectStage: null, connectAttempt: 0, connectingConvId: null, connected: false,
  connectedAt: null,
  localMuted: false, localDeafened: false, participants: [],
  ping: null, quality: 'unknown', mic: 'muted', voiceServer: null,
  serverMuted: false, serverDeafened: false,
})

const audioEls = new Map<string, HTMLAudioElement>()   // trackSid -> <audio>
let muteBeforeDeafen = false
/** Whether the microphone goes back on the air when a server mute is lifted:
 *  true when the person was talking as it was imposed, or joined to talk while
 *  it was already in force. See micStepOnPermitChange. */
let liveWhenAllowed = false
let pttBound = false
let statsTimer: ReturnType<typeof setInterval> | null = null
let connectSeq = 0   // bumped per connect() attempt; lets a superseded join bail out
let retryTimer: ReturnType<typeof setTimeout> | null = null
let failTimer: ReturnType<typeof setTimeout> | null = null
// The media server the CURRENT call asked for, remembered across retries and
// auto-reconnects: a drop must rejoin the same room, not silently fall back
// to the default and split the call in two.
let preferredVoiceServer: string | null = null
/**
 * The active channel's audio ceiling, in kbps, as the server reported it.
 *
 * Held across the whole session rather than passed to one call: the mic is
 * republished on unmute, on undeafen and after a reconnect, and a cap applied
 * at only the first of those is a cap that quietly stops applying.
 */
let channelBitrate: number | null = null

/** Publish the mic within the channel's ceiling. Every place that turns the
 *  microphone on goes through here — there are four, and a cap applied at only
 *  some of them is not a cap. */
const publishMic = (p: LocalParticipant) => {
  // The one place that can refuse for everyone. The token would reject the
  // publish anyway, but the rejection is asynchronous and arrives after the UI
  // has already drawn an open microphone — so it is caught here instead, at
  // the choke point the comment above promises.
  if (!permits.audio) return Promise.resolve(undefined)
  return p.setMicrophoneEnabled(
    true,
    micCaptureOptions(),
    // audioPreset, not a bare bitrate: LiveKit takes the ceiling through the
    // preset, and kbps -> bps because the channel setting is in kbps.
    channelBitrate ? { audioPreset: { maxBitrate: channelBitrate * 1000 } } : undefined,
  )
}

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
  audioEls.forEach(dropAudioEl); audioEls.clear(); streamSids.clear()
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
 *
 * This comment used to claim a reconnect re-sends. It did not: the watcher
 * below fires on the four things it reads, and a dropped socket changes none
 * of them, so a restored occupant came back with their flags cleared. The
 * reconnect watcher further down calls `reportVoiceState` for exactly that,
 * which is why the body is a named function and not inline. The server drops
 * a duplicate rather than fanning it out again.
 */
const reportVoiceState = () => {
  getSocket()?.emit('voice:state', {
    muted: voice.localMuted, deafened: voice.localDeafened, sharing: media.localScreenOn,
  })
}

watch(
  () => [voice.connected, voice.localMuted, voice.localDeafened, media.localScreenOn] as const,
  ([connected]) => { if (connected) reportVoiceState() },
  { immediate: true },
)

/**
 * Put ourselves back in the call the moment the socket is back.
 *
 * The media and the presence are two separate connections to two separate
 * services, and only one of them notices a blip. A dropped socket makes the
 * server run `leaveCall` for every room we held, so every sidebar in the
 * instance loses us at once — while LiveKit carries on and we stay audible
 * and keep our tile on everyone's stage. Socket.IO reconnects with a new
 * socket, and before this nothing told the server we were still here: the
 * two views disagreed until we left for real. A single API restart did it to
 * everybody in a call simultaneously.
 *
 * The state goes with it. The watcher above only fires when one of the four
 * things it reads changes, and a reconnect changes none of them — so without
 * this line a restored occupant came back with their mute, deafen and
 * screen-share flags cleared.
 */
watch(socketConnected, (up, wasUp) => {
  if (!up || wasUp) return
  if (!voice.connected || !voice.activeConvId || !voice.activeKind) return
  emitCallRejoin(voice.activeConvId, voice.activeKind)
  reportVoiceState()
})

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
//
// `volume` and `muted` are the person's VOICE. `streamVolume` is the sound of
// the screen they share, 0–100: it only needs to go down (spec 12), and it is
// its own number because a game turned down to hear the person over it must
// not turn the person down with it.
export interface UserAudioPref { volume: number; muted: boolean; videoOff: boolean; streamVolume: number }
export const userPrefs = reactive<Record<string, UserAudioPref>>({})

const DEFAULT_PREF: Readonly<UserAudioPref> = { volume: 100, muted: false, videoOff: false, streamVolume: 100 }

export const userPref = (identity: string): UserAudioPref =>
  userPrefs[identity] ?? { ...DEFAULT_PREF }

// audioEls is keyed by track sid; this maps a sid back to whose track it is, so
// a per-user volume change can find the right elements.
const audioOwner = new Map<string, string>()

/**
 * The elements in audioEls that are a screen share's sound rather than a
 * voice, by track sid. Same map, same lifecycle — every path that removes or
 * re-applies an element covers both — but different rules; see applyAudio.
 */
const streamSids = new Set<string>()

export const setUserPref = (identity: string, patch: Partial<UserAudioPref>) => {
  userPrefs[identity] = { ...userPref(identity), ...patch }
  // Re-apply to EVERY element, not just the ones audioOwner claims belong to
  // this identity. Each element is recomputed from its own owner, so this is
  // idempotent for the others — and it means a missing owner entry (a track
  // subscribed before the map existed, a reconnect) degrades to "applies late"
  // rather than "unmute silently does nothing".
  applyAllAudio()
}

/** How loud this person's shared screen is for you, 0–100. */
export const streamVolumeOf = (identity: string): number => userPref(identity).streamVolume

/** Set it. Clamped to 0–100 and whole, since it is a slider's percentage. */
export const setStreamVolume = (identity: string, v: number): void => {
  if (!Number.isFinite(v)) return
  setUserPref(identity, { streamVolume: Math.round(Math.min(100, Math.max(0, v))) })
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
      kind: streamSids.has(sid) ? 'stream' : 'voice',
      owner: owner ?? '(NO OWNER — mute cannot target this element)',
      prefForOwner: owner ? userPref(owner) : null,
      liveElementMuted:  el.muted,
      liveElementVolume: +el.volume.toFixed(3),
      // Not null: turned up past 100 % and heard through the gain stage, so
      // the element is muted on purpose and this is the level that counts.
      stageGain: stageGain(el),
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

/** The output device the member chose, where the browser lets an element pick one. */
const routeToOutput = (el: HTMLAudioElement) => {
  const sink = voiceSettings.outputDeviceId
  if (sink && typeof (el as any).setSinkId === 'function') (el as any).setSinkId(sink).catch(() => {})
}

/**
 * Whether a voice turned past 100 % can still come out of the output the
 * member chose: the browser can point the stage there, and when it tried,
 * the device did not refuse. A refusal re-applies everything (through
 * onGainStateChange), so the slider and the voices drop to 100 together.
 */
const canRouteSink = () =>
  sinkRoutable(voiceSettings.outputDeviceId, gainSupport()) && !sinkRefused(voiceSettings.outputDeviceId)

/**
 * The top of the User Volume slider: 200, or 100 where going past 100 %
 * would move the voice off the chosen output device (spec 12). The menus
 * read it inside their builders, so it follows an output change live.
 */
export const userVolumeMax = (): number => userVolumeMaxFor(canRouteSink())

/*
 * A voice: User Volume times the output level, Mute and Deafen.
 *
 * Up to 100 % that is the element's own volume. Past it, the element
 * cannot go (it throws), so the voice is played through the gain stage in
 * remoteGain.ts and the element is muted under it; when the stage cannot
 * play, it stays on the element at 100 %. The element's volume is set in
 * both cases, so it is right the moment the stage lets go of it.
 */
const applyAudioEl = (el: HTMLAudioElement, identity?: string) => {
  const u = identity ? userPref(identity) : DEFAULT_PREF
  const muted = voice.localDeafened || u.muted
  const plan = volumePlan(voiceSettings.outputVolume ?? 100, u.volume, canRouteSink())
  el.volume = plan.elVolume
  // Even while amplified, as livekit-client's webAudioMix does: Chromium's
  // echo cancellation with a chosen output needs the element pointed at it too.
  routeToOutput(el)
  if (plan.gain > 1 && amplify(el, plan.gain, muted, voiceSettings.outputDeviceId)) return
  releaseGain(el)
  el.muted = muted
}

/*
 * A screen share's sound: the sharer's Stream Volume and the global output
 * level, and Deafen. Not their User Volume, and not muting them — those are
 * about their voice. Muting someone who talks over a film they are showing
 * is a reason to want the film, not a reason to lose it.
 *
 * Clamped into 0..1 because the element throws outside it; Stream Volume
 * tops out at 100 and the output level at 100, so the clamp is a guard.
 */
const applyStreamEl = (el: HTMLAudioElement, identity?: string) => {
  const pct = identity ? streamVolumeOf(identity) : DEFAULT_PREF.streamVolume
  el.volume = Math.min(1, Math.max(0, ((voiceSettings.outputVolume ?? 100) / 100) * (pct / 100)))
  routeToOutput(el)
  el.muted = voice.localDeafened
}

/** Apply whichever rules this element is under, from its own owner. */
const applyAudio = (el: HTMLAudioElement, sid: string) =>
  streamSids.has(sid) ? applyStreamEl(el, audioOwner.get(sid)) : applyAudioEl(el, audioOwner.get(sid))
const applyAllAudio = () => audioEls.forEach((el, sid) => applyAudio(el, sid))
// The gain stage started or stopped running: amplified voices move onto it,
// or back onto their elements, rather than going silent with it.
onGainStateChange(applyAllAudio)

/** An element this app stored, off the gain stage and out of the page. */
const dropAudioEl = (el: HTMLMediaElement) => { releaseGain(el); el.remove() }

/**
 * A remote audio track, played. `source` says whose rules it is under: a
 * ScreenShareAudio track is a stream, everything else a voice.
 */
const attachTrack = (track: RemoteTrack, identity?: string, source: Track.Source = track.source) => {
  if (track.kind !== Track.Kind.Audio) return
  const el = track.attach() as HTMLAudioElement
  el.autoplay = true
  ;(el as any).playsInline = true
  el.style.display = 'none'
  const sid = track.sid!
  if (identity) audioOwner.set(sid, identity)
  if (source === Track.Source.ScreenShareAudio) streamSids.add(sid)
  applyAudio(el, sid)
  document.body.appendChild(el)
  audioEls.set(sid, el)
}
/*
 * The element is removed by the one this app stored, not by what
 * `track.detach()` returns. On TrackUnsubscribed that is always nothing:
 * livekit-client detaches the track's elements itself before it emits
 * Unsubscribed (RemoteTrackPublication.setTrack), so removing the returned
 * list removed nothing, and every voice gone and every stream left stayed in
 * the body as a hidden, paused <audio>. The detach stays for any element the
 * SDK has not got to, and removing an element twice is harmless.
 */
const detachTrack = (track: RemoteTrack) => {
  track.detach().forEach(dropAudioEl)
  if (track.sid) {
    const el = audioEls.get(track.sid)
    if (el) dropAudioEl(el)
    audioEls.delete(track.sid); audioOwner.delete(track.sid); streamSids.delete(track.sid)
  }
}

/**
 * Everything someone was heard through, for a departure that skipped
 * TrackUnsubscribed — the abrupt drop purgeParticipantVideos exists for. A
 * stream element left behind would be a dead node per share; a voice one, the
 * same per voice. LiveKit's ordinary leave unsubscribes first, and
 * detachTrack removes those, so this usually finds nothing.
 */
const purgeParticipantAudio = (identity: string) => {
  audioOwner.forEach((owner, sid) => {
    if (owner !== identity) return
    const el = audioEls.get(sid)
    if (el) dropAudioEl(el)
    audioEls.delete(sid); audioOwner.delete(sid); streamSids.delete(sid)
  })
}

/*
 * Music audio, on its own path.
 *
 * Deliberately not attachTrack. That one applies the per-person volume map
 * and the deafen state, which are the wrong rules here in two ways: a music
 * channel is not a person, so it has no entry in the volume map, and muting
 * somebody must not silence the music they happen to be listening to
 * alongside. Deafen DOES silence it, because deafen means "I hear nothing".
 *
 * A plain <audio> element with .volume is enough. A GainNode would mean
 * routing through the AudioContext the mic chain already owns, for a
 * multiplier an element gives for free.
 */
const musicEls = new Map<string, HTMLAudioElement>()

const applyMusicVolume = (): void => {
  for (const el of musicEls.values()) {
    el.volume = music.volume
    el.muted = voice.localDeafened
  }
}

const attachMusicTrack = (track: RemoteTrack): void => {
  if (track.kind !== Track.Kind.Audio || !track.sid) return
  const el = track.attach() as HTMLAudioElement
  el.autoplay = true
  ;(el as any).playsInline = true
  el.style.display = 'none'
  document.body.appendChild(el)
  musicEls.set(track.sid, el)
  applyMusicVolume()
}

// The stored element, for the reason given at detachTrack: by Unsubscribed
// the SDK has already detached it, and `track.detach()` returns nothing.
const detachMusicTrack = (track: RemoteTrack): void => {
  track.detach().forEach(el => el.remove())
  if (track.sid) { musicEls.get(track.sid)?.remove(); musicEls.delete(track.sid) }
}

watch(() => [music.volume, voice.localDeafened], applyMusicVolume)

/*
 * Music follows the call.
 *
 * One watcher rather than a call in every join and leave path. There are
 * several ways into a call and several out, and the rejoin fix earlier today
 * existed precisely because one of them had been missed — watching the state
 * the whole app already agrees on cannot be forgotten at a new call site.
 */
watch(
  () => (voice.connected && voice.activeConvId && voice.activeKind
    ? { conversationId: voice.activeConvId, kind: voice.activeKind }
    : null),
  t => setMusicTarget(t, t ? voiceRoomName(t.kind, t.conversationId, useAuth().user.value?.id ?? '') : null),
  { immediate: true },
)

/**
 * Whose screen share this member chose to watch, by identity.
 *
 * A shared screen is not downloaded until you tap Join stream on it — no
 * video, no stream audio — and this set is that choice. It belongs to one
 * call: cleared when you leave, kept across a reconnect, because a dropped
 * connection coming back is still the same call. See subscriptionPolicy.ts.
 */
export const joinedStreams = reactive(new Set<string>())

/**
 * Which share each joined stream is, by the sid of its screen publication.
 *
 * Joining is a choice about one share, not about one person (spec 18): stop
 * sharing and share again, and everyone who was watching is asked again
 * rather than pulled into whatever comes next. A publication's sid is the
 * server's name for one share — the same for every viewer, the same across
 * this member's reconnects, new each time the sharer starts again — so it
 * is what tells "the share I joined" from "a share by the same person".
 */
const joinedShare = new Map<string, string>()

const screenSidOf = (p: RemoteParticipant | undefined): string | undefined => {
  if (!p) return undefined
  for (const pub of p.trackPublications.values()) {
    if (pub.source === Track.Source.ScreenShare) return pub.trackSid
  }
  return undefined
}

/**
 * The stream this member joined last, for as long as it stays joined: an
 * explicit choice of what to watch, from whichever surface it was made. The
 * phone stage gives it the slot at once and keeps it there through anyone
 * talking (ruling T4-3). Joining another replaces it; leaving it clears it,
 * by hand or because its share ended (forgetEndedShares leaves it), and so
 * does leaving the call. Nothing older takes its place: once it is gone, the
 * stage picks as it always does.
 */
export const chosenStream = ref<string | null>(null)

/** Join stream: download this person's shared screen and its sound. */
export const joinStream = (identity: string): void => {
  const sid = screenSidOf(getRoom()?.remoteParticipants.get(identity))
  if (sid) joinedShare.set(identity, sid)
  joinedStreams.add(identity)
  chosenStream.value = identity
}

/** Leave stream: stop downloading it. The call, and their voice, carry on. */
export const leaveStream = (identity: string): void => {
  joinedShare.delete(identity)
  joinedStreams.delete(identity)
  if (chosenStream.value === identity) chosenStream.value = null
}

/**
 * Forget every joined stream whose share has ended.
 *
 * Compared against what the room holds, not driven by the event that ended
 * it, because the one case that matters most raises no event at all: a share
 * that stopped and started again while this member's own connection was
 * down. The rejoined room just holds a different publication, and without
 * this the old choice would quietly join the new share.
 *
 * - The sharer is here with no screen: the share stopped. Forget it.
 * - The sharer is here with a different screen: a new share. Forget it.
 * - The sharer is not in the room: say nothing yet. LiveKit's own full
 *   reconnect removes every participant before rebuilding them with the
 *   same publications, and a stream must survive that; if they really left,
 *   whatever they publish on return is compared when it arrives.
 * - A stream joined before its share could be seen (no sid on record)
 *   adopts the first screen that appears.
 */
const forgetEndedShares = (r: Room) => {
  for (const id of [...joinedShare.keys()]) if (!joinedStreams.has(id)) joinedShare.delete(id)
  for (const id of [...joinedStreams]) {
    const p = r.remoteParticipants.get(id)
    if (!p) continue
    const now = screenSidOf(p), chosen = joinedShare.get(id)
    if (!chosen) { if (now) joinedShare.set(id, now) }
    else if (now !== chosen) leaveStream(id)
  }
}

/** The member's choices, as the subscription policy reads them. */
const subscriptionChoices = () => ({ listeningTo: music.listeningTo, joinedStreams })

/**
 * Bring this member's view of the room up to date and download what the
 * policy says: who is sharing (for the stage's Join stream tiles), which
 * joined streams have ended, then every subscription. In that order — a
 * stream that ended must be forgotten before the sweep, or the sweep would
 * subscribe the share that replaced it.
 */
const sweepRoom = (r: Room) => {
  syncRemoteStreams(r)
  forgetEndedShares(r)
  applySubscriptions(r, subscriptionChoices())
}

/*
 * A changed choice re-sweeps the room.
 *
 * Tuning in is subscribing to one music track and dropping the rest, which
 * is why nobody downloads audio they are not listening to and why the cost
 * is per channel rather than per listener. Join stream works the same way
 * for a screen. The room events that sweep too are in wireRoom.
 */
watch([() => music.listeningTo, () => [...joinedStreams]], () => {
  const room = getRoom()
  if (room) sweepRoom(room)
})

const syncParticipants = () => {
  const room = getRoom()
  if (!room) { voice.participants = []; return }
  const list: VoiceParticipant[] = []
  const lp = room.localParticipant
  list.push({ id: lp.identity, name: lp.name || 'You', speaking: lp.isSpeaking, muted: !lp.isMicrophoneEnabled, local: true })
  room.remoteParticipants.forEach((p: RemoteParticipant) => {
    // The music service publishes into this room as a participant. It is not
    // a person, and the sidebar, the stage and the member count all read this
    // list — so without this it appears as an extra occupant in every call
    // that has music on.
    if (p.identity === MUSIC_IDENTITY) return
    list.push({ id: p.identity, name: p.name || p.identity, speaking: p.isSpeaking, muted: !p.isMicrophoneEnabled, local: false })
  })
  voice.participants = list
}

// ── Call limits: incoming video quality + pause-when-hidden ────────────────
// Both apply only to REMOTE video publications: your own outgoing camera is
// untouched, and audio is never in scope, at any level — publishMic and the
// audio track lifecycle above don't participate in any of this.
const QUALITY = { high: VideoQuality.HIGH, medium: VideoQuality.MEDIUM, low: VideoQuality.LOW } as const

const applyQuality = (pub: RemoteTrackPublication) => {
  const q = qualityFor(perf.incomingVideo)
  // null = leave it to adaptiveStream's own judgement, which is what 'auto' means.
  if (q) pub.setVideoQuality(QUALITY[q])
}

// Only the ones this member subscribes to. A screen share nobody joined is a
// video publication too, and LiveKit refuses track settings on it with a
// warning per call; a join gets quality and pause from TrackSubscribed.
const remoteVideoPubs = (r: Room) => [...r.remoteParticipants.values()]
  .flatMap(p => [...p.videoTrackPublications.values()])
  .filter(pub => pub.isDesired)

const applyQualityToAll = () => {
  const r = getRoom(); if (!r) return
  for (const pub of remoteVideoPubs(r)) applyQuality(pub)
}
watch(() => perf.incomingVideo, applyQualityToAll)

/**
 * Video is expensive and unwatched while the window is hidden; audio never
 * pauses. The setting is folded into `hidden` itself rather than an early
 * `if (!perf.pauseVideoWhenHidden) return` — that would leave tiles paused
 * after the level drops back to Full while the window is STILL hidden, since
 * nothing else would fire until the next visibilitychange. Folding it in means
 * turning the switch off resumes video immediately, on the same code path.
 */
const applyHiddenPause = () => {
  const r = getRoom(); if (!r) return
  const hidden = perf.pauseVideoWhenHidden && document.visibilityState === 'hidden'
  for (const pub of remoteVideoPubs(r)) pub.setEnabled(!hidden)
}
// Module-scoped and permanent, like the watchers elsewhere in this file:
// useVoice is a singleton for the app's whole lifetime, not a resource created
// per call, and both functions above already no-op via getRoom() when there is
// no active room — so there is nothing to tear down between calls. Guarded for
// the tests that import this module under Node, where `document` is absent.
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', applyHiddenPause)
watch(() => perf.pauseVideoWhenHidden, applyHiddenPause)

/**
 * A moderator muted, deafened or lifted either while this person is in the
 * call. The server changes what the media server lets them publish — no new
 * token — so the permits read at join are refreshed from the live grant here.
 *
 * Without this, a lifted server mute left the person silent: the server had
 * also muted their microphone track, and the permits still said "forbidden",
 * so the microphone button refused to unmute until they left and rejoined.
 */
const onLocalPermissionsChanged = (r: Room) => {
  const grant = r.localParticipant.permissions
  if (!grant) return
  const next = permitsFromGrant(
    grant,
    Track.sourceToProto(Track.Source.Microphone),
    Track.sourceToProto(Track.Source.Camera),
  )
  const step = micStepOnPermitChange(permits.audio, next.audio, {
    liveWhenAllowed,
    deafened: voice.localDeafened,
    ptt: effectiveInputMode() === 'ptt',
  })
  setPermits(next)

  if (step === 'forbid') {
    liveWhenAllowed = !voice.localMuted && !voice.localDeafened
    voice.localMuted = true
    voice.mic = 'forbidden'
    r.localParticipant.setMicrophoneEnabled(false).catch(() => {})
  } else if (step === 'restore-live') {
    liveWhenAllowed = false
    voice.localMuted = false
    // publishMic both unmutes the track the server muted and republishes one
    // that was never published (joined while muted).
    publishMic(r.localParticipant)
      .then(() => { voice.mic = 'live' })
      .catch(e => { voice.mic = micFailureReason(e); voice.localMuted = true })
  } else if (step === 'restore-muted') {
    liveWhenAllowed = false
    voice.mic = 'muted'
  }
  if (step !== 'none') syncParticipants()
}

const wireRoom = (r: Room) => {
  r.on(RoomEvent.ParticipantPermissionsChanged, (_prev, p) => {
    if (p === r.localParticipant) onLocalPermissionsChanged(r)
  })
  /*
   * Every point a publication can appear, swept through the one policy.
   *
   * The room connects with autoSubscribe off, so these are the only way
   * anything — a voice included — reaches this member. Each is a different
   * door, and a missed one is silence:
   * - Connected: everything already in the room. It arrives with the join,
   *   raising no TrackPublished.
   * - Reconnected: a full reconnect inside LiveKit rebuilds every remote
   *   participant, so every publication is new and unsubscribed.
   * - ParticipantConnected: someone joining after us. LiveKit 2.20 follows
   *   it with a TrackPublished per track, but its own source comment says
   *   it does not, and older versions did not; sweeping on arrival too means
   *   an upgrade that changes the order again cannot cost anyone a voice.
   * - TrackPublished: a mic, camera, screen or song published later.
   * - TrackUnpublished and ParticipantDisconnected: nothing to subscribe,
   *   but a share that stopped leaves the stage's Join stream tiles and
   *   ends a joined stream (sweepRoom).
   *
   * `r`, never getRoom(): Connected fires inside r.connect(), before
   * setRoom. Reading getRoom() there is exactly how the old music sweep
   * found no room, did nothing, and let autoSubscribe play everyone the song.
   */
  const sweep = () => sweepRoom(r)
  r.on(RoomEvent.Connected, sweep)
  r.on(RoomEvent.Reconnected, sweep)
  r.on(RoomEvent.ParticipantConnected, sweep)
  r.on(RoomEvent.TrackPublished, sweep)
  r.on(RoomEvent.TrackUnpublished, sweep)

  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
    // Music has its own gain, so that music volume is not voice volume and
    // muting a PERSON does not silence the music.
    if (participant.identity === MUSIC_IDENTITY) { attachMusicTrack(track); syncParticipants(); return }
    if (track.kind === Track.Kind.Video) {
      addRemoteVideo(track, participant)
      applyQuality(pub)
      // A track that subscribes while the window is already hidden (a late
      // camera-on, or the tail of an initial join) must start paused too, not
      // just tracks that were already live when visibility last changed.
      applyHiddenPause()
    } else {
      attachTrack(track, participant.identity, pub.source)
    }
    syncParticipants()
  })
  r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant) => {
    if (participant.identity === MUSIC_IDENTITY) { detachMusicTrack(track); syncParticipants(); return }
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
  r.on(RoomEvent.ParticipantDisconnected, (p) => {
    purgeParticipantVideos(p.identity)
    purgeParticipantAudio(p.identity)
    sweep()
    soundUserLeave()
    syncParticipants()
  })
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
  audioEls.forEach(dropAudioEl)
  audioEls.clear()
  streamSids.clear()
  // Nothing plays through the gain stage between calls; joining wakes it.
  sleepGain()
  unbindPtt()
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  if (failTimer)  { clearTimeout(failTimer);  failTimer = null }
  // Back to unrestricted, or a channel that forbade video would keep the camera
  // button dead in the next call — including in a DM, where nobody has the
  // authority to have forbidden anything.
  resetPermits()
  // Joining a stream is a choice for this call. The next one asks again.
  joinedStreams.clear()
  joinedShare.clear()
  chosenStream.value = null
  liveWhenAllowed = false
  voice.serverMuted = false
  voice.serverDeafened = false
  intentionalLeave = false
  stopLocalLevel()
  stopMedia()
  // Clear server-side call presence even when LiveKit dropped on its own
  // (RoomEvent.Disconnected → cleanup, NOT via leave()). Without this, an
  // unexpected media drop leaves you a ghost participant in everyone else's
  // call banner until your whole socket disconnects. Idempotent server-side.
  if (voice.activeConvId && voice.activeKind) emitCallLeave(voice.activeConvId, voice.activeKind)
  voice.connected = false
  voice.connectedAt = null
  voice.connecting = false
  voice.connectStage = null
  voice.connectAttempt = 0
  voice.connectingConvId = null
  voice.activeConvId = null
  voice.activeKind = null
  voice.activeName = ''
  voice.voiceServer = null
  preferredVoiceServer = null
  channelBitrate = null
  voice.participants = []
  voice.localMuted = false
  voice.localDeafened = false
  voice.ping = null
  voice.quality = 'unknown'
  voice.mic = 'muted'
  // Graphs and counters belong to one call; the next one starts empty.
  resetRtcStats()
}

// ── Push-to-talk ────────────────────────────────────────────────────────────
// The key and the phone's Hold to talk bar share one press and one release.
// A press reports whether the microphone went on air, because the bar has to
// know: "Talking…" over a refused microphone is exactly the lie `voice.mic`
// exists to prevent. The key ignores the answer, as it always did, but a
// refusal now lands in `voice.mic` for both, so the call panel says why the
// press did nothing instead of it failing silently.

/** Whether somebody is holding the press right now. A release can arrive while
 *  the publish is still in flight — the first press waits on the browser's
 *  permission prompt — and a publish that lands after its own release would
 *  leave the microphone open with nobody holding anything. */
let pttHeld = false

/** Put the microphone on the air. True when it is; false when it cannot be —
 *  deafened, not permitted, no call, a publish that failed, or a release that
 *  beat the publish. Never rejects. */
export const pttPress = async (): Promise<boolean> => {
  const room = getRoom()
  // Deafened: the key has always done nothing then, so the bar does nothing
  // too. Not permitted: publishMic would decline as well, but quietly — and a
  // press that resolves true over a microphone that never opened is the lie.
  if (!room || voice.localDeafened || !permits.audio) return false
  pttHeld = true
  try {
    await publishMic(room.localParticipant)
  } catch (e) {
    pttHeld = false
    voice.mic = micFailureReason(e)
    return false
  }
  if (!pttHeld) {
    room.localParticipant.setMicrophoneEnabled(false).catch(() => {})
    return false
  }
  // A publish that worked is fresh evidence that whatever refused it before no
  // longer applies (the microphone was allowed since, the other app let go), so
  // that notice goes. Idle push-to-talk is 'muted', which the key never touched.
  if (voice.mic !== 'live' && voice.mic !== 'muted') voice.mic = 'muted'
  return true
}

/** Take the microphone off the air. Called from every way a hold can end, so it
 *  must be harmless twice over, with no call, and for a microphone that will
 *  not switch off. */
export const pttRelease = (): void => {
  pttHeld = false
  getRoom()?.localParticipant.setMicrophoneEnabled(false).catch(() => {})
}

const onPttDown = (e: KeyboardEvent) => {
  if (e.code !== voiceSettings.pttKey || e.repeat) return
  void pttPress()
}
const onPttUp = (e: KeyboardEvent) => {
  if (e.code !== voiceSettings.pttKey) return
  pttRelease()
}
const bindPtt = () => {
  if (pttBound) return
  window.addEventListener('keydown', onPttDown)
  window.addEventListener('keyup', onPttUp)
  pttBound = true
}
const unbindPtt = () => {
  // A hold does not outlive its call, bound or not.
  pttHeld = false
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
  const want     = micChainNeeded()
  const wantNode = noiseNodeFor(voiceSettings.noiseMode)
  const current  = mic.getProcessor() as MicChainProcessor | undefined
  const has      = current?.name === 'mic-chain'
  try {
    if (want && has) {
      // Switching between RNNoise, DeepFilterNet and neither changes the
      // shape of the graph, so that needs a rebuild. Slider moves are just
      // parameter changes — updating in place avoids a rebuild's brief gap
      // in the outgoing audio.
      if (current!.noiseNode !== wantNode) await mic.setProcessor(createMicChainProcessor(wantNode))
      else current!.update()
    }
    else if (want && !has) await mic.setProcessor(createMicChainProcessor(wantNode))
    else if (!want && has) await mic.stopProcessor()
  } catch (e) {
    console.warn('[voice] mic chain unavailable — publishing the raw capture', e)
    // Only a model leg can realistically fail (wasm/worklet load — DeepFilterNet's
    // in particular is a large download that can fail offline or on a slow
    // link). Fall back to the browser filter rather than leaving the user on
    // a dead processor: a call nobody can hear you in is the one outcome
    // worse than losing the fancy filter.
    if (wantNode !== 'off') setVoiceSettings({ noiseMode: 'standard' })
    try { await mic.stopProcessor() } catch { /* ignore */ }
    // Re-apply capture constraints so the browser filter actually comes back on.
    try { await publishMic(room.localParticipant) } catch { /* ignore */ }
  }
}

const applyMicChain = (): Promise<void> => {
  micChainQueue = micChainQueue.then(applyMicChainNow, applyMicChainNow)
  return micChainQueue
}

// Every one of these takes effect immediately mid-call — no rejoin. Sensitivity
// and volume in particular were previously wired only into the mic test, so
// moving them did nothing to what the other side actually heard.
// `voiceActivityAllowed` is in here for the same reason: it changes the mode the
// chain runs in, so a moderator's overwrite has to reach the gate without
// waiting for a rejoin.
watch(() => [voiceSettings.noiseMode, voiceSettings.sensitivity,
             voiceSettings.inputVolume, voiceSettings.inputMode,
             permits.voiceActivity],
      () => { void applyMicChain() })

// Module-scoped (not inside useVoice) so wireRoom's Disconnected handler can
// reach attemptConnect to auto-reconnect. useApi/useAuth are plain singletons,
// safe to read here at import time; getVoiceToken reads the token at call time.
const { getVoiceToken, moveVoiceCall } = useApi()

/**
 * @param voiceServerId Preferred media server for a DM or group call — the
 * caller's own default, or whatever they picked in the call bar. Ignored for
 * a channel call, where the channel and its guild decide for everyone.
 */
const connect = async (convId: string, kind: 'dm' | 'group' | 'channel', name: string, voiceServerId?: string | null) => {
    // Already in — or already joining — this exact call: no-op. Guarding the
    // join window (connectingConvId, since activeConvId isn't set until success)
    // is what stops a second click/accept during the ~1s join from spinning up a
    // duplicate LiveKit session with the same identity (the DUPLICATE_IDENTITY
    // reconnect loop).
    if (voice.connecting && voice.connectingConvId === convId) return
    if (voice.connected  && voice.activeConvId     === convId && voice.activeKind === kind) return
    // Joining is a click: the moment a browser lets a suspended AudioContext
    // start. The gain stage for voices turned past 100 % needs it running.
    wakeGain()
    // Switching calls (or recovering from a stale attempt): fully tear the old
    // room down before opening a new one, so we never hold two sessions at once.
    // Leaving puts the gain stage to sleep, so it is woken again after.
    if (getRoom() || voice.connected || voice.connecting) { await leave(); wakeGain() }
    // Set after leave(): cleanup() clears it, and clearing it after we set it
    // would drop the choice on every call that follows another.
    preferredVoiceServer = kind === 'channel' ? null : (voiceServerId ?? voiceSettings.defaultVoiceServer) || null
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
      const {
        token, url, voiceServer, bitrate,
        mayPublishAudio, mayPublishVideo, voiceActivity, serverMute, serverDeafen,
        music: musicOnThisInstance,
      } = await getVoiceToken(convId, kind, preferredVoiceServer)
      channelBitrate = typeof bitrate === 'number' ? bitrate : null
      // Absent on an instance predating the feature, which means the same as
      // off: the panel stays hidden rather than appearing with nothing behind
      // it. Strictly `=== true`, so a missing field cannot read as enabled.
      musicAvailable.value = musicOnThisInstance === true
      // `?? true` throughout: a DM carries none of these, and neither does a
      // response from a server predating them. Absent means unrestricted, and
      // the token is the thing that actually decides — reading absence as a
      // denial would grey out working buttons for everyone on an older build.
      voice.serverMuted    = serverMute ?? false
      voice.serverDeafened = serverDeafen ?? false
      setPermits({
        audio:         mayPublishAudio ?? true,
        video:         mayPublishVideo ?? true,
        voiceActivity: voiceActivity ?? true,
      })
      if (seq !== connectSeq) return                                  // superseded while fetching token
      voice.connectStage = 'connecting'
      const r = new Room({ adaptiveStream: true, dynacast: true })
      wireRoom(r)
      // Signal channel up (token accepted by the server) → past auth, now negotiating media.
      r.on(RoomEvent.SignalConnected, () => { if (seq === connectSeq) voice.connectStage = 'rtc-connecting' })
      voice.connectStage = 'authenticating'
      // Nothing is downloaded that subscriptionPolicy did not choose: wireRoom
      // subscribes voices and cameras itself, and music and screens wait for
      // the member. See the sweep handlers there.
      await r.connect(url, token, { autoSubscribe: false })
      if (seq !== connectSeq) { r.disconnect().catch(() => {}); return } // superseded mid-connect
      setRoom(r)
      // The choice watchers read getRoom(), which was null from Connected
      // until now. A Listen or Join stream that landed in between is applied
      // here rather than lost; the sweep sends nothing if nothing changed.
      sweepRoom(r)
      // Mic capture needs a secure context (HTTPS or localhost); over plain
      // http on an IP, navigator.mediaDevices is undefined. Rather than throw
      // (which orphaned the room → reconnect loop), join LISTEN-ONLY so the
      // user can still hear the call — voice.mic below records which of the
      // possible reasons applies, instead of collapsing every failure into
      // one boolean.
      const canCapture = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
      if (effectiveInputMode() === 'ptt') {
        bindPtt()
        voice.mic = 'muted'
        // A phone's first Hold to talk must not be the moment Android asks for
        // the microphone: the prompt would open under the finger and swallow
        // the press. Asking now, at join, costs nothing — a capture stopped at
        // once is enough to be granted it, and nothing is left recording.
        // Desktop is never asked: its key press asks when it is first used.
        if (noPushToTalkKey.value && canCapture) {
          try {
            const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
            probe.getTracks().forEach(t => t.stop())
          } catch (e) {
            // Still joins listen-only, as every other mic refusal does here.
            voice.mic = micFailureReason(e)
            console.warn('[voice] microphone not available — joining listen-only', e)
          }
          // The prompt can stay open as long as the person likes; a join
          // cancelled meanwhile must stay cancelled, as with the connect above.
          if (seq !== connectSeq) { r.disconnect().catch(() => {}); return }
        }
      } else if (!canCapture) {
        // No getUserMedia at all: the page is not on a secure origin. This is
        // the one failure that is the host's to fix, not the member's.
        voice.mic = 'insecure'
      } else if (!permits.audio) {
        voice.mic = 'forbidden'
        // They joined to talk; if the mute is lifted mid-call, they are on the air.
        liveWhenAllowed = true
      } else {
        try {
          await publishMic(r.localParticipant)
          voice.mic = 'live'
        } catch (e) {
          // Still a listen-only join — throwing here orphaned the room and
          // caused a reconnect loop. What changes is that the failure now
          // reaches the UI instead of a console nobody has open.
          voice.mic = micFailureReason(e)
          console.warn('[voice] mic unavailable — joining listen-only', e)
        }
        // Outside the try, exactly where it was. Moving it inside would skip
        // the chain on a failed publish, which is a behaviour change this
        // slice has no reason to make.
        await applyMicChain()
      }
      // Before activeConvId is overwritten below, which is what tells a rejoin
      // from a first join: a drop or a media-server move comes through here with
      // the call's identity still in place (teardownRoom keeps it), and that is
      // the same call carrying on, so its clock must not restart.
      if (voice.connectedAt === null || voice.activeConvId !== convId) voice.connectedAt = Date.now()
      voice.connected = true
      voice.connecting = false
      voice.connectStage = 'connected'
      voice.connectAttempt = 0
      voice.connectingConvId = null
      voice.activeConvId = convId
      voice.activeKind = kind
      voice.activeName = name
      voice.voiceServer = voiceServer ?? null
      // Muted whenever the mic isn't actually live — denied, missing, busy,
      // insecure or forbidden all collapse to the same UI state here. Arriving
      // with an open-microphone icon over a mic that never published is the
      // exact lie publishMic exists to prevent.
      voice.localMuted = effectiveInputMode() === 'ptt' || !micIsLive(voice.mic)
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
    voice.connectedAt = null   // the call is over; the strip that remains is the failure, not a running timer
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
    /*
     * Refuse the unmute rather than let it appear to work.
     *
     * The token already forbids publishing, so `setMicrophoneEnabled(true)`
     * would be rejected by the media server — but `localMuted` would already
     * have flipped, leaving an open-microphone icon over a microphone that is
     * not open. Someone would then talk into it. Staying muted is the honest
     * state, and the callers below surface why.
     */
    if (voice.localMuted && !permits.audio) return
    const micBefore = voice.mic
    voice.localMuted = !voice.localMuted
    voice.localMuted ? soundMute() : soundUnmute()
    room.localParticipant.setMicrophoneEnabled(!voice.localMuted, micCaptureOptions())
      .then(() => { voice.mic = micAfterToggle(micBefore, voice.localMuted) })
      .catch(e => {
        // The unmute did not take. Say so rather than drawing an open
        // microphone over a device that refused.
        voice.mic = micFailureReason(e)
        voice.localMuted = true
      })
    // Unmuting undeafens — and through the element rules, as toggleDeafen
    // does, or every voice and stream would stay silent under a lifted deafen.
    if (!voice.localMuted && voice.localDeafened) {
      voice.localDeafened = false
      applyAllAudio()
    }
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
      // Through the element rules, not `el.muted = true` on each: a voice
      // turned past 100 % is heard through the gain stage with its element
      // already muted, and only applyAudioEl silences the stage.
      applyAllAudio()
    } else {
      // Undeafening restores what you had before — unless the token forbids
      // publishing, in which case "what you had before" is not available and
      // staying muted is the only truthful outcome.
      const micBefore = voice.mic
      voice.localMuted = muteBeforeDeafen || !permits.audio
      room.localParticipant.setMicrophoneEnabled(!voice.localMuted, micCaptureOptions())
        .then(() => { voice.mic = micAfterToggle(micBefore, voice.localMuted) })
        .catch(e => { voice.mic = micFailureReason(e); voice.localMuted = true })
      // Not a blanket unmute: someone you muted individually must STAY muted
      // when you undeafen, or undeafening silently undoes those choices.
      applyAllAudio()
    }
    syncParticipants()
  }

// Re-apply output volume / sink to live audio elements (called from settings).
const applyOutput = () => applyAllAudio()

/**
 * Move the call I am in to a different media server.
 *
 * Only asks the server to do it — the rejoin happens through the same
 * announcement everyone else receives, so the person who pressed the button
 * takes exactly the same path as the people who did not. Doing it locally as
 * well would move them twice.
 *
 * Refused for a channel call: that server is a channel setting, changed by
 * someone who can edit the channel, not by whoever happens to be in it.
 */
const switchVoiceServer = async (voiceServerId: string | null): Promise<void> => {
  const convId = voice.activeConvId, kind = voice.activeKind
  if (!convId || !kind || kind === 'channel') return
  await moveVoiceCall(convId, kind, voiceServerId)
}

/**
 * Someone moved the call I am in — rejoin on the new server.
 *
 * A full reconnect, because LiveKit rooms do not span servers. The token
 * endpoint reads the room's now-updated choice on its own, so nothing has to
 * be passed here; asking for the announced id explicitly would race with a
 * second move landing between the announcement and the join.
 */
watch(callServerMoved, m => {
  if (!m || !voice.connected) return
  const convId = voice.activeConvId, kind = voice.activeKind, name = voice.activeName
  const myId = useAuth().user.value?.id
  if (!convId || !kind || !myId) return
  if (voiceRoomName(kind, convId, myId) !== m.room) return
  // Same identity, new room: tear the old session down first so LiveKit never
  // sees two sessions for one identity (the DUPLICATE_IDENTITY reconnect loop).
  intentionalLeave = true
  teardownRoom()
  voice.connected = false
  intentionalLeave = false
  void attemptConnect(convId, kind, name, 1)
})

export const useVoice = () => ({ voice, voiceRoomName, connect, leave, toggleMute, toggleDeafen, applyOutput, switchVoiceServer, pttPress, pttRelease })
