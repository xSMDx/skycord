<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ChevronRight, Check, Settings, Eye, EyeOff } from 'lucide-vue-next'
import { Track } from 'livekit-client'
import CallFlyout from './CallFlyout.vue'
import { useCallDevices } from '@/composables/useCallDevices'
import { useVoiceSettings } from '@/composables/useVoiceSettings'
import { useVoiceMedia } from '@/composables/useVoiceMedia'
import { getRoom } from '@/composables/voiceRoom'

const emit = defineEmits<{ close: []; openSettings: [] }>()
const { cameras, refreshDevices, deviceLabel, setCameraDevice } = useCallDevices()
const { voiceSettings } = useVoiceSettings()
const { media } = useVoiceMedia()

const showDevices = ref(false)
const currentCamLabel = () => {
  const d = cameras.value.find(x => x.deviceId === voiceSettings.cameraDeviceId)
  return d ? deviceLabel(d, 'Camera') : 'Default'
}

// Inline preview: reuse the LIVE camera track when publishing; otherwise open a
// temporary capture that is stopped when the preview or flyout closes.
const previewing = ref(false)
const videoEl = ref<HTMLVideoElement | null>(null)
let tempStream: MediaStream | null = null
let disposed = false

let startingPreview = false
const startPreview = async () => {
  if (previewing.value || startingPreview) return
  startingPreview = true
  const live = getRoom()?.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack
  try {
    if (live) {
      if (videoEl.value) videoEl.value.srcObject = new MediaStream([live])
    } else {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: voiceSettings.cameraDeviceId || undefined },
      })
      if (disposed) { s.getTracks().forEach(t => t.stop()); return }
      // Never orphan a previous capture, whatever path produced it.
      tempStream?.getTracks().forEach(t => t.stop())
      tempStream = s
      if (videoEl.value) videoEl.value.srcObject = tempStream
    }
    await videoEl.value?.play().catch(() => {})
    previewing.value = true
  } catch { previewing.value = false }
  finally { startingPreview = false }
}
const stopPreview = () => {
  tempStream?.getTracks().forEach(t => t.stop()); tempStream = null
  if (videoEl.value) videoEl.value.srcObject = null
  previewing.value = false
}
const togglePreview = () => { previewing.value ? stopPreview() : startPreview() }

onMounted(refreshDevices)
onBeforeUnmount(() => {
  disposed = true
  stopPreview()
})
</script>

<template>
  <CallFlyout @close="emit('close')">
    <button class="fr" @click="showDevices = !showDevices">
      <span>Camera<span class="fr-sub">{{ currentCamLabel() }}</span></span>
      <ChevronRight :size="13" :stroke-width="2.25" :style="showDevices ? 'transform:rotate(90deg)' : ''" />
    </button>
    <template v-if="showDevices">
      <button class="fr" @click="setCameraDevice('')">
        <span>Default</span><Check v-if="!voiceSettings.cameraDeviceId" class="fr-check" :size="15" :stroke-width="2.25" />
      </button>
      <button v-for="(d,i) in cameras" :key="d.deviceId" class="fr" @click="setCameraDevice(d.deviceId)">
        <span>{{ deviceLabel(d, `Camera ${i+1}`) }}</span>
        <Check v-if="voiceSettings.cameraDeviceId===d.deviceId" class="fr-check" :size="15" :stroke-width="2.25" />
      </button>
    </template>

    <div class="fr-sep" />
    <button class="fr" @click="togglePreview">
      <span>{{ previewing ? 'Hide Preview' : 'Preview Camera' }}<span v-if="media.localCamOn" class="fr-sub">Showing your live camera</span></span>
      <component :is="previewing ? EyeOff : Eye" :size="15" :stroke-width="2.25" />
    </button>
    <div v-show="previewing" class="cf-prevbox">
      <video ref="videoEl" class="cf-video" muted playsinline />
    </div>

    <div class="fr-sep" />
    <button class="fr" @click="emit('openSettings'); emit('close')">
      <span>Video Settings</span><Settings :size="15" :stroke-width="2.25" />
    </button>
  </CallFlyout>
</template>

<style scoped>
.cf-prevbox {
  margin: 4px 2px; border-radius: 6px; overflow: hidden;
  background: #000; aspect-ratio: 16 / 9;
}
.cf-video { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
