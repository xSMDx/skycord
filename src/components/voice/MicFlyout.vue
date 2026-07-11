<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { PhCaretRight, PhCheck, PhGear } from '@phosphor-icons/vue'
import { Track } from 'livekit-client'
import CallFlyout from './CallFlyout.vue'
import { useCallDevices } from '@/composables/useCallDevices'
import { useVoiceSettings } from '@/composables/useVoiceSettings'
import { useVoice } from '@/composables/useVoice'
import { getRoom } from '@/composables/voiceRoom'

const emit = defineEmits<{ close: []; openSettings: [] }>()
const { mics, speakers, supportsSinkId, refreshDevices, deviceLabel, setMicDevice, setSpeakerDevice } = useCallDevices()
const { voiceSettings, setVoiceSettings } = useVoiceSettings()
const { voice, toggleDeafen, applyOutput } = useVoice()

const openSection = ref<'' | 'input' | 'output'>('')
const toggleSection = (s: 'input' | 'output') => { openSection.value = openSection.value === s ? '' : s }

const onInputVolume  = (e: Event) => setVoiceSettings({ inputVolume: +(e.target as HTMLInputElement).value })
const onOutputVolume = (e: Event) => { setVoiceSettings({ outputVolume: +(e.target as HTMLInputElement).value }); applyOutput() }

const currentMicLabel = () => {
  const d = mics.value.find(x => x.deviceId === voiceSettings.inputDeviceId)
  return d ? deviceLabel(d, 'Microphone') : 'Default'
}
const currentSpkLabel = () => {
  const d = speakers.value.find(x => x.deviceId === voiceSettings.outputDeviceId)
  return d ? deviceLabel(d, 'Speaker') : 'Default'
}

// Live input level — reads the EXISTING LiveKit mic track through an analyser.
// No second getUserMedia, no monitor loopback, no deafen side effects (that's
// the settings page's Mic Test, deliberately untouched).
const level = ref(0)
let ctx: AudioContext | null = null
let raf = 0
let disposed = false
let boundTrack: MediaStreamTrack | null = null
let analyser: AnalyserNode | null = null
let src: MediaStreamAudioSourceNode | null = null
let data: Uint8Array | null = null

const currentMicTrack = () =>
  getRoom()?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack ?? null

const bindTrack = (t: MediaStreamTrack) => {
  if (!ctx) return
  src?.disconnect()
  src = ctx.createMediaStreamSource(new MediaStream([t]))
  analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  src.connect(analyser)   // analysis only — never to destination
  data = new Uint8Array(analyser.frequencyBinCount)
  boundTrack = t
}

onMounted(async () => {
  await refreshDevices()
  if (disposed) return                    // flyout closed during the await
  const t = currentMicTrack()
  if (!t) return                          // no mic (connecting/blocked): meter idles
  try {
    ctx = new AudioContext()
    await ctx.resume()
    if (disposed) { ctx.close().catch(() => {}); ctx = null; return }
    bindTrack(t)
    const tick = () => {
      if (disposed) return
      // Rebind if the mic track was replaced (e.g. device switched from this menu)
      const cur = currentMicTrack()
      if (cur && cur !== boundTrack) bindTrack(cur)
      if (analyser && data) {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        level.value = Math.min(1, (peak / 128) * 1.6)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
  } catch { /* meter stays idle */ }
})

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(raf)
  src?.disconnect(); src = null
  ctx?.close().catch(() => {}); ctx = null
})
</script>

<template>
  <CallFlyout @close="emit('close')">
    <button class="fr" @click="toggleSection('input')">
      <span>Input Device<span class="fr-sub">{{ currentMicLabel() }}</span></span>
      <PhCaretRight :size="13" weight="bold" :style="openSection==='input' ? 'transform:rotate(90deg)' : ''" />
    </button>
    <template v-if="openSection==='input'">
      <button class="fr" @click="setMicDevice('')">
        <span>Default</span><PhCheck v-if="!voiceSettings.inputDeviceId" class="fr-check" :size="15" weight="bold" />
      </button>
      <button v-for="(d,i) in mics" :key="d.deviceId" class="fr" @click="setMicDevice(d.deviceId)">
        <span>{{ deviceLabel(d, `Microphone ${i+1}`) }}</span>
        <PhCheck v-if="voiceSettings.inputDeviceId===d.deviceId" class="fr-check" :size="15" weight="bold" />
      </button>
    </template>

    <button class="fr" :disabled="!supportsSinkId" @click="toggleSection('output')">
      <span>Output Device<span class="fr-sub">{{ currentSpkLabel() }}</span></span>
      <PhCaretRight :size="13" weight="bold" :style="openSection==='output' ? 'transform:rotate(90deg)' : ''" />
    </button>
    <template v-if="openSection==='output'">
      <button class="fr" @click="setSpeakerDevice('')">
        <span>Default</span><PhCheck v-if="!voiceSettings.outputDeviceId" class="fr-check" :size="15" weight="bold" />
      </button>
      <button v-for="(d,i) in speakers" :key="d.deviceId" class="fr" @click="setSpeakerDevice(d.deviceId)">
        <span>{{ deviceLabel(d, `Speaker ${i+1}`) }}</span>
        <PhCheck v-if="voiceSettings.outputDeviceId===d.deviceId" class="fr-check" :size="15" weight="bold" />
      </button>
    </template>

    <div class="fr-sep" />
    <span class="fr-label">Input Volume — {{ voiceSettings.inputVolume }}%</span>
    <div class="fr static"><input class="fr-slider" type="range" min="0" max="100" :value="voiceSettings.inputVolume" @input="onInputVolume" /></div>
    <span class="fr-label">Input Level</span>
    <div class="fr static"><div class="mf-meter"><div class="mf-fill" :style="{ width: (level*100).toFixed(0) + '%' }" /></div></div>
    <span class="fr-label">Output Volume — {{ voiceSettings.outputVolume }}%</span>
    <div class="fr static"><input class="fr-slider" type="range" min="0" max="100" :value="voiceSettings.outputVolume" @input="onOutputVolume" /></div>

    <div class="fr-sep" />
    <div class="fr" role="button" @click="toggleDeafen()">
      <span>Deafen</span>
      <span class="fr-tog" :class="{ on: voice.localDeafened }"><span /></span>
    </div>
    <button class="fr" @click="emit('openSettings'); emit('close')">
      <span>Voice Settings</span><PhGear :size="15" weight="fill" />
    </button>
  </CallFlyout>
</template>

<style scoped>
.mf-meter { width: 100%; height: 8px; border-radius: 4px; background: var(--bg-input); overflow: hidden; }
.mf-fill  { height: 100%; background: linear-gradient(90deg, #23a55a, #f0b232 70%, #ed4245); transition: width .05s linear; }
</style>
