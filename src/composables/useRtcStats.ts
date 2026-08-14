/**
 * useRtcStats — a live read of the WebRTC layer underneath the call.
 *
 * Everything here comes from `RTCPeerConnection.getStats()`. Nothing is
 * synthesised: if a field isn't in the stats report, it reads "—" rather than
 * showing a plausible-looking number. That matters for a debug panel, which is
 * only worth having if you can trust it when something is actually broken.
 *
 * LiveKit runs TWO peer connections — the publisher (what you send) and the
 * subscriber (what you receive) — so outbound and inbound stats live on
 * different objects and are collected separately.
 *
 * Polling only runs while someone is watching (`retain`/`release`), because
 * getStats() on every tick for a call nobody is inspecting is pure waste. The
 * one exception is the ping series, which the connection popover graphs, so a
 * short history is always kept via the low-rate sampler in useVoice.
 */
import { reactive, ref } from 'vue'
import { getRoom } from './voiceRoom'

/** Samples held per series — 60 ticks at 1Hz = the last minute. */
export const SERIES_LEN = 60
const TICK_MS = 1000

export type Series = number[]

const emptySeries = (): Series => []

/** Push a sample, dropping the oldest once the window is full. */
const push = (s: Series, v: number) => {
  s.push(v)
  if (s.length > SERIES_LEN) s.shift()
}

export interface RtcTransport {
  /** Identifier for the selected candidate pair — Discord's "Transport – …". */
  id:              string | null
  localAddress:    string | null
  remoteAddress:   string | null
  protocol:        string | null
  candidateType:   string | null
  dtlsState:       string | null
  srtpCipher:      string | null
  dtlsCipher:      string | null
  /** Instantaneous values, latest tick. */
  ping:            number | null
  availableOutgoingBitrate: number | null
  bytesSent:       number | null
  bytesReceived:   number | null
  packetsSent:     number | null
  packetsReceived: number | null
}

export interface RtcAudioOut {
  ssrc:            number | null
  codec:           string | null
  payloadType:     number | null
  clockRate:       number | null
  /** Loudness of the mic feed, 0–1, straight from the media source. */
  audioLevel:      number | null
  /** Encoder target vs what actually went out. */
  targetBitrate:   number | null
  bitrate:         number | null
  bytesSent:       number | null
  packetsSent:     number | null
  packetsLost:     number | null
  /** Loss as reported back by the far end, 0–1. */
  fractionLost:    number | null
  roundTripTime:   number | null
  jitter:          number | null
  dtx:             boolean | null
  fec:             boolean | null
}

export interface RtcAudioIn {
  ssrc:            number | null
  codec:           string | null
  clockRate:       number | null
  audioLevel:      number | null
  bitrate:         number | null
  bytesReceived:   number | null
  packetsReceived: number | null
  packetsLost:     number | null
  jitter:          number | null
  /** Milliseconds of audio the jitter buffer has had to invent or drop. */
  concealedMs:     number | null
  packetsDiscarded:number | null
}

export interface RtcSeriesSet {
  ping:              Series
  availableOutgoing: Series
  bytesSent:         Series
  bytesReceived:     Series
  packetsSent:       Series
  packetsReceived:   Series
  outBitrate:        Series
  outTargetBitrate:  Series
  outAudioLevel:     Series
  outBytesSent:      Series
  outPacketsSent:    Series
  inBitrate:         Series
  inBytesReceived:   Series
  inPacketsReceived: Series
}

export const rtc = reactive({
  transport: {
    id: null, localAddress: null, remoteAddress: null, protocol: null, candidateType: null,
    dtlsState: null, srtpCipher: null, dtlsCipher: null, ping: null,
    availableOutgoingBitrate: null, bytesSent: null, bytesReceived: null,
    packetsSent: null, packetsReceived: null,
  } as RtcTransport,
  out: {
    ssrc: null, codec: null, payloadType: null, clockRate: null, audioLevel: null,
    targetBitrate: null, bitrate: null, bytesSent: null, packetsSent: null,
    packetsLost: null, fractionLost: null, roundTripTime: null, jitter: null,
    dtx: null, fec: null,
  } as RtcAudioOut,
  in: {
    ssrc: null, codec: null, clockRate: null, audioLevel: null, bitrate: null,
    bytesReceived: null, packetsReceived: null, packetsLost: null, jitter: null,
    concealedMs: null, packetsDiscarded: null,
  } as RtcAudioIn,
  series: {
    ping: emptySeries(), availableOutgoing: emptySeries(),
    bytesSent: emptySeries(), bytesReceived: emptySeries(),
    packetsSent: emptySeries(), packetsReceived: emptySeries(),
    outBitrate: emptySeries(), outTargetBitrate: emptySeries(), outAudioLevel: emptySeries(),
    outBytesSent: emptySeries(), outPacketsSent: emptySeries(),
    inBitrate: emptySeries(), inBytesReceived: emptySeries(), inPacketsReceived: emptySeries(),
  } as RtcSeriesSet,
  /** Wall-clock of the last successful poll — the panel greys out if this stalls. */
  updatedAt: 0 as number,
  /** getStats() threw or found no peer connection. */
  error: '' as string,
})

/** Newest sample in a series — what a "/s" graph's headline number should read. */
export const last = (s: Series): number | null => (s.length ? s[s.length - 1] : null)

/** Rolling average of the ping series, which is steadier than any one sample. */
export const avgPing = (): number | null => {
  const s = rtc.series.ping
  if (!s.length) return null
  return Math.round(s.reduce((a, b) => a + b, 0) / s.length)
}

/**
 * Outbound loss as a percentage. Uses the far end's report (remote-inbound-rtp)
 * because only the receiver can know what never arrived.
 */
export const outLossPct = (): number | null => {
  const f = rtc.out.fractionLost
  if (f !== null) return Math.round(f * 1000) / 10
  const lost = rtc.out.packetsLost, sent = rtc.out.packetsSent
  if (lost === null || !sent) return null
  return Math.round((lost / (sent + lost)) * 1000) / 10
}

// ── Peer connection discovery ───────────────────────────────────────────────
// LiveKit's engine internals are private and shift between versions, so every
// path is probed and guarded rather than assumed.
const pcs = (): { pub?: RTCPeerConnection; sub?: RTCPeerConnection } => {
  const eng: any = (getRoom() as any)?.engine
  if (!eng) return {}
  return {
    pub: eng?.pcManager?.publisher?.pc  ?? eng?.publisher?.pc,
    sub: eng?.pcManager?.subscriber?.pc ?? eng?.subscriber?.pc,
  }
}

// Previous cumulative counters, so per-second deltas can be derived. WebRTC
// reports totals; a graph of a monotonically rising total tells you nothing.
let prev: Record<string, { v: number; t: number }> = {}
const perSec = (key: string, total: number | null | undefined, now: number): number | null => {
  if (typeof total !== 'number') return null
  const last = prev[key]
  prev[key] = { v: total, t: now }
  if (!last || now <= last.t) return null
  // A counter that went backwards means the peer connection was replaced.
  if (total < last.v) return 0
  return Math.round(((total - last.v) / ((now - last.t) / 1000)))
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * "host:port" from a candidate, skipping whichever half the browser withheld.
 * Chrome hides local host candidates behind mDNS and omits `address` entirely
 * on peer-reflexive ones, so a naive template renders a bare ":31837".
 */
const addrOf = (c: any): string | null => {
  if (!c) return null
  const host = c.address || c.ip || ''
  const port = c.port ?? ''
  if (host && port !== '') return `${host}:${port}`
  if (host) return String(host)
  if (port !== '') return `(hidden):${port}`
  return null
}

const collectFrom = async (pc: RTCPeerConnection | undefined, side: 'pub' | 'sub', now: number) => {
  if (!pc?.getStats) return
  const report = await pc.getStats()
  const byId = new Map<string, any>()
  report.forEach((r: any) => byId.set(r.id, r))

  // ── Transport: only the publisher's selected pair is reported, since that's
  // the path the popover's ping refers to.
  if (side === 'pub') {
    let pair: any = null
    report.forEach((r: any) => {
      if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && !pair) pair = r
      else if (r.type === 'candidate-pair' && r.nominated) pair = r
    })
    let transport: any = null
    report.forEach((r: any) => { if (r.type === 'transport') transport = r })
    if (transport?.selectedCandidatePairId && byId.has(transport.selectedCandidatePairId))
      pair = byId.get(transport.selectedCandidatePairId)

    const t = rtc.transport
    if (pair) {
      const local  = byId.get(pair.localCandidateId)
      const remote = byId.get(pair.remoteCandidateId)
      t.id            = pair.id ?? null
      t.localAddress  = addrOf(local)
      t.remoteAddress = addrOf(remote)
      t.protocol      = pair.protocol ?? local?.protocol ?? null
      t.candidateType = local?.candidateType ?? null
      t.ping = num(pair.currentRoundTripTime) !== null ? Math.round(pair.currentRoundTripTime * 1000) : t.ping
      t.availableOutgoingBitrate = num(pair.availableOutgoingBitrate)
      t.bytesSent       = num(pair.bytesSent)
      t.bytesReceived   = num(pair.bytesReceived)
      t.packetsSent     = num(pair.packetsSent)
      t.packetsReceived = num(pair.packetsReceived)

      if (t.ping !== null) push(rtc.series.ping, t.ping)
      if (t.availableOutgoingBitrate !== null) push(rtc.series.availableOutgoing, t.availableOutgoingBitrate)
      const bs = perSec('t.bytesSent', t.bytesSent, now)
      const br = perSec('t.bytesReceived', t.bytesReceived, now)
      const ps = perSec('t.packetsSent', t.packetsSent, now)
      const pr = perSec('t.packetsReceived', t.packetsReceived, now)
      if (bs !== null) push(rtc.series.bytesSent, bs)
      if (br !== null) push(rtc.series.bytesReceived, br)
      if (ps !== null) push(rtc.series.packetsSent, ps)
      if (pr !== null) push(rtc.series.packetsReceived, pr)
    }
    if (transport) {
      t.dtlsState  = transport.dtlsState ?? null
      t.srtpCipher = transport.srtpCipher ?? null
      t.dtlsCipher = transport.dtlsCipher ?? null
    }
  }

  // ── Outbound audio (publisher side).
  if (side === 'pub') {
    let rtp: any = null, remoteIn: any = null, source: any = null
    report.forEach((r: any) => {
      if (r.type === 'outbound-rtp' && r.kind === 'audio') rtp = r
      if (r.type === 'remote-inbound-rtp' && r.kind === 'audio') remoteIn = r
      if (r.type === 'media-source' && r.kind === 'audio') source = r
    })
    const o = rtc.out
    if (rtp) {
      const codec = byId.get(rtp.codecId)
      o.ssrc        = num(rtp.ssrc)
      o.codec       = codec?.mimeType ? codec.mimeType.replace(/^audio\//i, '') : null
      o.payloadType = num(codec?.payloadType)
      o.clockRate   = num(codec?.clockRate)
      o.bytesSent   = num(rtp.bytesSent)
      o.packetsSent = num(rtp.packetsSent)
      o.targetBitrate = num(rtp.targetBitrate)
      // sdpFmtpLine carries the negotiated Opus switches.
      const fmtp = String(codec?.sdpFmtpLine ?? '')
      o.dtx = fmtp ? /usedtx=1/.test(fmtp) : null
      o.fec = fmtp ? /useinbandfec=1/.test(fmtp) : null

      const bps = perSec('o.bytesSent', o.bytesSent, now)
      o.bitrate = bps === null ? null : bps * 8
      if (o.bitrate !== null) push(rtc.series.outBitrate, o.bitrate)
      if (o.targetBitrate !== null) push(rtc.series.outTargetBitrate, o.targetBitrate)
      if (o.bytesSent !== null && bps !== null) push(rtc.series.outBytesSent, bps)
      const pps = perSec('o.packetsSent', o.packetsSent, now)
      if (pps !== null) push(rtc.series.outPacketsSent, pps)
    }
    if (remoteIn) {
      o.packetsLost   = num(remoteIn.packetsLost)
      o.fractionLost  = num(remoteIn.fractionLost)
      o.roundTripTime = num(remoteIn.roundTripTime) !== null ? Math.round(remoteIn.roundTripTime * 1000) : null
      o.jitter        = num(remoteIn.jitter) !== null ? Math.round(remoteIn.jitter * 1000) : null
    }
    if (source) {
      o.audioLevel = num(source.audioLevel)
      if (o.audioLevel !== null) push(rtc.series.outAudioLevel, o.audioLevel)
    }
  }

  // ── Inbound audio (subscriber side). Summed across every remote speaker:
  // what you care about here is "is audio reaching me", not per-track detail.
  if (side === 'sub') {
    let bytes = 0, packets = 0, lost = 0, discarded = 0, concealed = 0
    let jitter: number | null = null, level: number | null = null
    let ssrc: number | null = null, codec: string | null = null, clock: number | null = null
    let any = false
    report.forEach((r: any) => {
      if (r.type !== 'inbound-rtp' || r.kind !== 'audio') return
      any = true
      bytes     += num(r.bytesReceived) ?? 0
      packets   += num(r.packetsReceived) ?? 0
      lost      += num(r.packetsLost) ?? 0
      discarded += num(r.packetsDiscarded) ?? 0
      concealed += (num(r.concealedSamples) ?? 0)
      if (jitter === null && num(r.jitter) !== null) jitter = Math.round(r.jitter * 1000)
      if (level  === null && num(r.audioLevel) !== null) level = r.audioLevel
      if (ssrc   === null) ssrc = num(r.ssrc)
      if (codec  === null) {
        const c = byId.get(r.codecId)
        codec = c?.mimeType ? c.mimeType.replace(/^audio\//i, '') : null
        clock = num(c?.clockRate)
      }
    })
    const i = rtc.in
    if (any) {
      i.ssrc = ssrc; i.codec = codec; i.clockRate = clock
      i.audioLevel = level; i.jitter = jitter
      i.bytesReceived = bytes; i.packetsReceived = packets
      i.packetsLost = lost; i.packetsDiscarded = discarded
      // concealedSamples is a sample count; at 48kHz that's ms = samples / 48.
      i.concealedMs = clock ? Math.round(concealed / (clock / 1000)) : null
      const bps = perSec('i.bytes', bytes, now)
      i.bitrate = bps === null ? null : bps * 8
      if (i.bitrate !== null) push(rtc.series.inBitrate, i.bitrate)
      if (bps !== null) push(rtc.series.inBytesReceived, bps)
      const pps = perSec('i.packets', packets, now)
      if (pps !== null) push(rtc.series.inPacketsReceived, pps)
    }
  }
}

const collect = async () => {
  const { pub, sub } = pcs()
  if (!pub && !sub) { rtc.error = 'No peer connection'; return }
  const now = Date.now()
  try {
    await Promise.all([collectFrom(pub, 'pub', now), collectFrom(sub, 'sub', now)])
    rtc.error = ''
    rtc.updatedAt = now
  } catch (e: any) {
    rtc.error = e?.message || 'Stats unavailable'
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
// Reference-counted so the popover and the debug modal can both ask for stats
// without either one stopping the other's polling when it closes.
const watchers = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

export const retainRtcStats = () => {
  watchers.value++
  if (timer) return
  collect()
  timer = setInterval(collect, TICK_MS)
}

export const releaseRtcStats = () => {
  watchers.value = Math.max(0, watchers.value - 1)
  if (watchers.value === 0 && timer) { clearInterval(timer); timer = null }
}

/** Call on hang-up: a fresh call must not inherit the last one's graphs. */
export const resetRtcStats = () => {
  prev = {}
  for (const k of Object.keys(rtc.series) as (keyof RtcSeriesSet)[]) rtc.series[k].length = 0
  for (const k of Object.keys(rtc.transport) as (keyof RtcTransport)[]) (rtc.transport as any)[k] = null
  for (const k of Object.keys(rtc.out) as (keyof RtcAudioOut)[]) (rtc.out as any)[k] = null
  for (const k of Object.keys(rtc.in) as (keyof RtcAudioIn)[]) (rtc.in as any)[k] = null
  rtc.updatedAt = 0
  rtc.error = ''
}

// ── Formatting helpers, shared by the popover and the debug modal ───────────
export const fmtBitrate = (bps: number | null): string =>
  bps === null ? '—' : bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(2)} Mbps` : `${(bps / 1000).toFixed(2)} Kbps`
export const fmtBytes = (b: number | null): string =>
  b === null ? '—' : b >= 1_048_576 ? `${(b / 1_048_576).toFixed(2)} MB` : b >= 1024 ? `${(b / 1024).toFixed(2)} KB` : `${b} B`
export const fmtMs   = (v: number | null): string => (v === null ? '—' : `${v} ms`)
export const fmtNum  = (v: number | null): string => (v === null ? '—' : String(v))
export const fmtPct  = (v: number | null): string => (v === null ? '—' : `${v}%`)
export const fmtHz   = (v: number | null): string => (v === null ? '—' : `${(v / 1000).toFixed(0)} kHz`)
export const fmtBool = (v: boolean | null): string => (v === null ? '—' : v ? 'Yes' : 'No')

/** Everything the debug panel shows, as one JSON blob for a bug report. */
export const snapshotRtcStats = () => ({
  capturedAt: new Date().toISOString(),
  room:       getRoom()?.name ?? null,
  identity:   getRoom()?.localParticipant?.identity ?? null,
  transport:  { ...rtc.transport },
  outbound:   { ...rtc.out },
  inbound:    { ...rtc.in },
  series:     Object.fromEntries(Object.entries(rtc.series).map(([k, v]) => [k, [...(v as Series)]])),
  userAgent:  navigator.userAgent,
})
