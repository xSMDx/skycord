<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ChevronRight, Check, Settings, Eye } from 'lucide-vue-next'
import CallFlyout from './CallFlyout.vue'
import { useCallDevices } from '@/composables/useCallDevices'
import { useVoiceSettings } from '@/composables/useVoiceSettings'
import { useVoiceMedia } from '@/composables/useVoiceMedia'

/**
 * `previewCamera` rather than a preview of our own.
 *
 * This flyout used to grow a live `<video>` inside itself, which put a camera
 * feed in a 200px-wide menu anchored to the call bar — and meant this file
 * owned a `getUserMedia` capture it had to remember to stop on every exit
 * path. `CameraPreviewModal` already exists, is already mounted in ChatApp
 * behind `showCameraPreview`, and already owns that lifecycle; CallBar already
 * declares the `previewCamera` event and ChatApp already listens for it, so
 * the whole route was in place and this was the one caller not using it.
 */
const emit = defineEmits<{ close: []; openSettings: []; previewCamera: [] }>()
const { cameras, refreshDevices, deviceLabel, setCameraDevice } = useCallDevices()
const { voiceSettings } = useVoiceSettings()
const { media } = useVoiceMedia()

const showDevices = ref(false)
const currentCamLabel = () => {
  const d = cameras.value.find(x => x.deviceId === voiceSettings.cameraDeviceId)
  return d ? deviceLabel(d, 'Camera') : 'Default'
}

onMounted(refreshDevices)
</script>

<template>
  <CallFlyout @close="emit('close')">
    <button class="fr" @click="showDevices = !showDevices">
      <span>Camera<span class="fr-sub">{{ currentCamLabel() }}</span></span>
      <ChevronRight :size="14" :stroke-width="2.25" :style="showDevices ? 'transform:rotate(90deg)' : ''" />
    </button>
    <template v-if="showDevices">
      <button class="fr" @click="setCameraDevice('')">
        <span>Default</span><Check v-if="!voiceSettings.cameraDeviceId" class="fr-check" :size="16" :stroke-width="2.25" />
      </button>
      <button v-for="(d,i) in cameras" :key="d.deviceId" class="fr" @click="setCameraDevice(d.deviceId)">
        <span>{{ deviceLabel(d, `Camera ${i+1}`) }}</span>
        <Check v-if="voiceSettings.cameraDeviceId===d.deviceId" class="fr-check" :size="16" :stroke-width="2.25" />
      </button>
    </template>

    <div class="fr-sep" />
    <!-- Closes on the way out: leaving a menu open behind a modal it launched
         gives you two dismissable layers stacked on the same click. -->
    <button class="fr" @click="emit('previewCamera'); emit('close')">
      <span>Preview Camera<span v-if="media.localCamOn" class="fr-sub">Showing your live camera</span></span>
      <Eye :size="16" :stroke-width="2.25" />
    </button>

    <div class="fr-sep" />
    <button class="fr" @click="emit('openSettings'); emit('close')">
      <span>Video Settings</span><Settings :size="16" :stroke-width="2.25" />
    </button>
  </CallFlyout>
</template>
