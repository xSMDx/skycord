<script setup lang="ts">
/**
 * RTC debug — the raw WebRTC state of the current call.
 *
 * Every value here is read from `RTCPeerConnection.getStats()`; anything the
 * browser doesn't report shows as "—". Discord's equivalent panel has a few
 * fields that come from its own media stack rather than WebRTC (Decryption
 * Failures, Pacer Delay, Passthrough, Sink Quality Level). Those have no
 * counterpart in a LiveKit/SFU setup, so they are absent rather than faked —
 * a debug panel that invents numbers is worse than no debug panel.
 *
 * Inbound is ours, not Discord's: with an SFU the interesting failure is
 * usually "their audio stopped arriving", and that is only visible here.
 */
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { X, Download, Copy, Radio, ArrowUpFromLine, ArrowDownToLine } from 'lucide-vue-next'
import Sparkline from '@/components/ui/Sparkline.vue'
import { useVoice } from '@/composables/useVoice'
import { getRoom } from '@/composables/voiceRoom'
import {
  rtc, retainRtcStats, releaseRtcStats, snapshotRtcStats,
  fmtBitrate, fmtBytes, fmtMs, fmtNum, fmtHz, fmtBool, outLossPct, last,
} from '@/composables/useRtcStats'

const emit = defineEmits<{ close: []; toast: [msg: string] }>()

const { voice } = useVoice()
const tab = ref<'transport' | 'outbound' | 'inbound'>('transport')

onMounted(retainRtcStats)
onBeforeUnmount(releaseRtcStats)

const identity = computed(() => getRoom()?.localParticipant?.name
  || getRoom()?.localParticipant?.identity || 'You')

const stateLabel = computed(() =>
  voice.connected ? 'Connected' : voice.connecting ? 'Connecting' : 'Disconnected')

/** Nothing to upload to — a self-hosted app shouldn't pretend it has a log sink. */
const download = () => {
  const blob = new Blob([JSON.stringify(snapshotRtcStats(), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `skycord-rtc-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  emit('toast', 'Stats saved')
}
const copy = () => {
  navigator.clipboard.writeText(JSON.stringify(snapshotRtcStats(), null, 2))
    .then(() => emit('toast', 'Stats copied'))
    .catch(() => emit('toast', 'Couldn’t copy the stats'))
}

const kbps = (v: number) => `${Math.round(v / 1000)}k`
const lossPct = computed(() => outLossPct())
</script>

<template>
  <Teleport to="body">
    <div class="ov" @click.self="emit('close')">
      <div class="dbg">
        <button class="dbg-x" @click="emit('close')" v-tip="'Close'"><X :size="18" :stroke-width="2.25" /></button>

        <!-- Nav -->
        <aside class="dbg-nav">
          <div class="dbg-who">
            <strong>{{ identity }}</strong>
            <span :class="{ ok: voice.connected }">{{ stateLabel }}</span>
          </div>
          <div class="dbg-navlabel">RTC Debug</div>
          <button :class="{ on: tab === 'transport' }" @click="tab = 'transport'">
            <Radio :size="14" :stroke-width="2" /> Transport
          </button>
          <button :class="{ on: tab === 'outbound' }" @click="tab = 'outbound'">
            <ArrowUpFromLine :size="14" :stroke-width="2" /> Outbound
          </button>
          <button :class="{ on: tab === 'inbound' }" @click="tab = 'inbound'">
            <ArrowDownToLine :size="14" :stroke-width="2" /> Inbound
          </button>
          <div class="dbg-navfoot">
            <button class="dbg-act" @click="copy"><Copy :size="13" :stroke-width="2" /> Copy</button>
            <button class="dbg-act" @click="download"><Download :size="13" :stroke-width="2" /> Save</button>
          </div>
        </aside>

        <!-- Body -->
        <section class="dbg-body">
          <p v-if="rtc.error" class="dbg-err">{{ rtc.error }}</p>

          <!-- ── Transport ─────────────────────────────────────────────── -->
          <template v-if="tab === 'transport'">
            <h3 class="dbg-h">Transport <span v-if="rtc.transport.id">– {{ rtc.transport.id }}</span></h3>
            <div class="dbg-grid">
              <Sparkline label="Available Outgoing Bitrate" :data="rtc.series.availableOutgoing"
                         :value="fmtBitrate(rtc.transport.availableOutgoingBitrate)" :fmt-tick="kbps" />
              <Sparkline label="Ping" :data="rtc.series.ping" :value="fmtMs(rtc.transport.ping)" color="var(--accent)" />
            </div>
            <div class="dbg-rows">
              <div><span>Local Address</span><strong>{{ rtc.transport.localAddress ?? '—' }}</strong></div>
              <div><span>Remote Address</span><strong>{{ rtc.transport.remoteAddress ?? '—' }}</strong></div>
              <div><span>Protocol</span><strong>{{ rtc.transport.protocol?.toUpperCase() ?? '—' }}</strong></div>
              <div><span>Candidate Type</span><strong>{{ rtc.transport.candidateType ?? '—' }}</strong></div>
              <div><span>DTLS State</span><strong>{{ rtc.transport.dtlsState ?? '—' }}</strong></div>
              <div><span>SRTP Cipher</span><strong class="mono">{{ rtc.transport.srtpCipher ?? '—' }}</strong></div>
              <div><span>Bytes Sent (total)</span><strong>{{ fmtBytes(rtc.transport.bytesSent) }}</strong></div>
              <div><span>Bytes Received (total)</span><strong>{{ fmtBytes(rtc.transport.bytesReceived) }}</strong></div>
            </div>
            <div class="dbg-grid">
              <Sparkline label="Packets Sent /s" :data="rtc.series.packetsSent"
                         :value="fmtNum(last(rtc.series.packetsSent))" />
              <Sparkline label="Packets Received /s" :data="rtc.series.packetsReceived"
                         :value="fmtNum(last(rtc.series.packetsReceived))" />
              <Sparkline label="Bytes Sent /s" :data="rtc.series.bytesSent"
                         :value="fmtBytes(last(rtc.series.bytesSent))" :fmt-tick="v => fmtBytes(v)" />
              <Sparkline label="Bytes Received /s" :data="rtc.series.bytesReceived"
                         :value="fmtBytes(last(rtc.series.bytesReceived))" :fmt-tick="v => fmtBytes(v)" />
            </div>
          </template>

          <!-- ── Outbound ──────────────────────────────────────────────── -->
          <template v-else-if="tab === 'outbound'">
            <h3 class="dbg-h">Outbound <span>· Audio</span></h3>
            <div class="dbg-rows">
              <div><span>SSRC</span><strong>{{ fmtNum(rtc.out.ssrc) }}</strong></div>
              <div><span>Codec</span><strong>{{ rtc.out.codec ?? '—' }}<template v-if="rtc.out.payloadType !== null"> ({{ rtc.out.payloadType }})</template></strong></div>
              <div><span>Sample Rate</span><strong>{{ fmtHz(rtc.out.clockRate) }}</strong></div>
              <div><span>Audio Detected</span><strong>{{ rtc.out.audioLevel === null ? '—' : (rtc.out.audioLevel > 0.001 ? 'Yes' : 'No') }}</strong></div>
              <div><span>In-band FEC</span><strong>{{ fmtBool(rtc.out.fec) }}</strong></div>
              <div><span>DTX</span><strong>{{ fmtBool(rtc.out.dtx) }}</strong></div>
              <div><span>Packets Lost</span><strong>{{ fmtNum(rtc.out.packetsLost) }}</strong></div>
              <div><span>Loss Rate</span><strong :class="{ bad: (lossPct ?? 0) > 5 }">{{ lossPct === null ? '—' : lossPct + '%' }}</strong></div>
              <div><span>Jitter</span><strong>{{ fmtMs(rtc.out.jitter) }}</strong></div>
              <div><span>Round Trip Time</span><strong>{{ fmtMs(rtc.out.roundTripTime) }}</strong></div>
            </div>
            <div class="dbg-grid">
              <Sparkline label="Bitrate" :data="rtc.series.outBitrate" :value="fmtBitrate(rtc.out.bitrate)" :fmt-tick="kbps" />
              <Sparkline label="Bitrate (Target)" :data="rtc.series.outTargetBitrate" :value="fmtBitrate(rtc.out.targetBitrate)" :fmt-tick="kbps" />
              <Sparkline label="Audio Level" :data="rtc.series.outAudioLevel" :max="1" color="var(--state-live)"
                         :value="rtc.out.audioLevel === null ? '—' : rtc.out.audioLevel.toFixed(3)"
                         :fmt-tick="v => v.toFixed(1)" />
              <Sparkline label="Packets Sent /s" :data="rtc.series.outPacketsSent" :value="fmtNum(last(rtc.series.outPacketsSent))" />
            </div>
          </template>

          <!-- ── Inbound ───────────────────────────────────────────────── -->
          <template v-else>
            <h3 class="dbg-h">Inbound <span>· Audio, all speakers</span></h3>
            <div class="dbg-rows">
              <div><span>SSRC</span><strong>{{ fmtNum(rtc.in.ssrc) }}</strong></div>
              <div><span>Codec</span><strong>{{ rtc.in.codec ?? '—' }}</strong></div>
              <div><span>Sample Rate</span><strong>{{ fmtHz(rtc.in.clockRate) }}</strong></div>
              <div><span>Packets Received</span><strong>{{ fmtNum(rtc.in.packetsReceived) }}</strong></div>
              <div><span>Packets Lost</span><strong>{{ fmtNum(rtc.in.packetsLost) }}</strong></div>
              <div><span>Packets Discarded</span><strong>{{ fmtNum(rtc.in.packetsDiscarded) }}</strong></div>
              <div><span>Jitter</span><strong>{{ fmtMs(rtc.in.jitter) }}</strong></div>
              <!-- Concealment is the jitter buffer papering over gaps; a rising
                   number is what "they sound robotic" actually looks like. -->
              <div><span>Concealed Audio</span><strong>{{ rtc.in.concealedMs === null ? '—' : rtc.in.concealedMs + ' ms' }}</strong></div>
            </div>
            <div class="dbg-grid">
              <Sparkline label="Bitrate" :data="rtc.series.inBitrate" :value="fmtBitrate(rtc.in.bitrate)" :fmt-tick="kbps" />
              <Sparkline label="Bytes Received /s" :data="rtc.series.inBytesReceived"
                         :value="fmtBytes(last(rtc.series.inBytesReceived))" :fmt-tick="v => fmtBytes(v)" />
              <Sparkline label="Packets Received /s" :data="rtc.series.inPacketsReceived"
                         :value="fmtNum(last(rtc.series.inPacketsReceived))" />
            </div>
          </template>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ov {
  position: fixed; inset: 0; background: rgba(0,0,0,.78);
  display: flex; align-items: center; justify-content: center; z-index: 1200;
  animation: dbg-fade .15s ease;
}
@keyframes dbg-fade { from { opacity: 0 } to { opacity: 1 } }

.dbg {
  position: relative; display: flex;
  width: 940px; max-width: 96vw; height: 640px; max-height: 90vh;
  background: var(--bg-panel); border-radius: 12px; overflow: hidden;
  box-shadow: 0 24px 80px rgba(0,0,0,.7);
  animation: dbg-in .18s cubic-bezier(.4,0,.2,1);
}
@keyframes dbg-in { from { transform: translateY(16px); opacity: 0 } to { transform: none; opacity: 1 } }

.dbg-x {
  position: absolute; top: 12px; right: 12px; z-index: 2;
  width: 30px; height: 30px; border: none; border-radius: 8px; cursor: pointer;
  background: transparent; color: var(--text-3);
  display: flex; align-items: center; justify-content: center; transition: background .12s, color .12s;
}
.dbg-x:hover { background: var(--hover); color: var(--text-1); }

/* Nav */
.dbg-nav {
  width: 210px; flex-shrink: 0; background: var(--bg-deep);
  padding: 20px 10px 10px; display: flex; flex-direction: column; gap: 2px;
}
.dbg-who { padding: 0 8px 14px; display: flex; flex-direction: column; gap: 2px; }
.dbg-who strong { font-size: 15px; color: var(--text-1); }
.dbg-who span { font-size: 12px; color: var(--text-3); }
.dbg-who span.ok { color: var(--state-live); }
.dbg-navlabel {
  font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  color: var(--text-faint); padding: 0 8px 6px;
}
.dbg-nav > button {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border: none; border-radius: 6px; cursor: pointer;
  background: transparent; color: var(--text-2); font-size: 13px; text-align: left;
  transition: background .12s, color .12s;
}
.dbg-nav > button:hover { background: var(--hover); color: var(--text-1); }
.dbg-nav > button.on { background: var(--active, rgba(255,255,255,.09)); color: var(--text-1); font-weight: 600; }

.dbg-navfoot { margin-top: auto; display: flex; gap: 6px; padding-top: 10px; }
.dbg-act {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
  padding: 7px 6px; border: none; border-radius: 6px; cursor: pointer;
  background: rgba(255,255,255,.06); color: var(--text-2); font-size: 12px;
  transition: background .12s, color .12s;
}
.dbg-act:hover { background: rgba(255,255,255,.12); color: var(--text-1); }
.dbg-act:active { transform: scale(.97); }

/* Body */
.dbg-body { flex: 1; min-width: 0; overflow-y: auto; padding: 20px 24px 24px; }
.dbg-h { font-size: 14px; color: var(--text-1); margin: 0 0 16px; font-weight: 600; }
.dbg-h span { color: var(--text-faint); font-weight: 400; font-size: 12px; }
.dbg-err {
  background: rgba(242,63,67,.12); border: 1px solid rgba(242,63,67,.3);
  color: var(--state-fault); border-radius: 8px; padding: 8px 10px; font-size: 12px; margin: 0 0 14px;
}

.dbg-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 28px; margin-bottom: 20px; }
.dbg-rows {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 28px; margin-bottom: 20px;
}
.dbg-rows > div {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px; min-width: 0;
}
.dbg-rows span { color: var(--text-2); flex-shrink: 0; }
.dbg-rows strong {
  color: var(--text-1); font-weight: 600; font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dbg-rows strong.bad { color: var(--state-fault); }
.dbg-rows strong.mono { font-family: ui-monospace, monospace; font-size: 11px; }

@media (max-width: 720px) {
  .dbg { flex-direction: column; height: 92vh; }
  .dbg-nav { width: auto; flex-direction: row; flex-wrap: wrap; align-items: center; padding: 12px; }
  .dbg-who { padding: 0 8px 0 0; }
  .dbg-navlabel { display: none; }
  .dbg-navfoot { margin: 0 0 0 auto; padding: 0; }
  .dbg-grid, .dbg-rows { grid-template-columns: minmax(0, 1fr); }
}
</style>
