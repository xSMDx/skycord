<script setup lang="ts">
/**
 * "Ready to video chat?" — a look at yourself before anyone else gets one.
 *
 * The preview runs on its own getUserMedia stream, deliberately separate from
 * the call's published track: opening this must never disturb a camera that's
 * already live, and closing it must never kill one.
 */
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { X, Video, TriangleAlert } from 'lucide-vue-next'
import ModalBase from '../modals/ModalBase.vue'
import { voiceSettings, setVoiceSettings } from '@/composables/useVoiceSettings'

const emit = defineEmits<{ close: []; confirm: [] }>()

const videoEl  = ref<HTMLVideoElement | null>(null)
const devices  = ref<MediaDeviceInfo[]>([])
const error    = ref('')
const starting = ref(false)
let stream: MediaStream | null = null

const stop = () => {
  stream?.getTracks().forEach(t => t.stop())
  stream = null
  if (videoEl.value) videoEl.value.srcObject = null
}

const start = async () => {
  stop()
  error.value = ''
  starting.value = true
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: voiceSettings.cameraDeviceId ? { deviceId: { exact: voiceSettings.cameraDeviceId } } : true,
    })
    if (videoEl.value) { videoEl.value.srcObject = stream; await videoEl.value.play().catch(() => {}) }
    // Labels are empty until permission is granted, so enumerate AFTER.
    devices.value = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput')
  } catch (e: any) {
    error.value = e?.name === 'NotAllowedError'
      ? 'Camera permission is blocked. Allow it in your browser’s site settings.'
      : e?.name === 'NotReadableError'
        ? 'That camera is being used by another app.'
        : 'Couldn’t open that camera.'
  } finally { starting.value = false }
}

// Switching device restarts the preview; the call's own track is untouched.
watch(() => voiceSettings.cameraDeviceId, () => { void start() })

onMounted(start)
onBeforeUnmount(stop)

const confirm = () => { stop(); emit('confirm') }
const close   = () => { stop(); emit('close') }
</script>

<template>
  <ModalBase width="min(480px, 100%)" :z="9500" @close="close">
    <div class="cp-card" role="dialog" aria-label="Camera preview">
        <div class="cp-head">
          <h2>Ready to video chat?</h2>
          <button class="cp-x" v-tip="'Close'" @click="close"><X :size="18" :stroke-width="2.25" /></button>
        </div>

        <div class="cp-stage">
          <video ref="videoEl" class="cp-video" autoplay playsinline muted></video>
          <div v-if="error" class="cp-err">
            <TriangleAlert :size="22" :stroke-width="2.25" /><span>{{ error }}</span>
          </div>
          <div v-else-if="starting" class="cp-err"><span>Starting camera…</span></div>
        </div>

        <select
          class="cp-select"
          :value="voiceSettings.cameraDeviceId"
          @change="setVoiceSettings({ cameraDeviceId: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">Default camera</option>
          <option v-for="d in devices" :key="d.deviceId" :value="d.deviceId">
            {{ d.label || 'Camera' }}
          </option>
        </select>

        <div class="cp-foot">
          <label class="cp-always">
            <input
              type="checkbox"
              :checked="voiceSettings.alwaysPreviewVideo"
              @change="setVoiceSettings({ alwaysPreviewVideo: ($event.target as HTMLInputElement).checked })"
            />
            <span>Always preview video</span>
          </label>
          <button class="cp-go" :disabled="!!error" @click="confirm">
            <Video :size="16" :stroke-width="2.25" /> Turn On Camera
          </button>
        </div>
    </div>
  </ModalBase>
</template>

<style scoped>
.cp-card { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
.cp-head { display: flex; align-items: center; justify-content: space-between; }
.cp-head h2 { font-size: 18px; font-weight: 700; color: var(--text-1); }
.cp-x { color: var(--text-3); display: flex; }
.cp-x:hover { color: var(--text-1); }

.cp-stage {
  position: relative; width: 100%; aspect-ratio: 16 / 9;
  background: #000; border-radius: 8px; overflow: hidden;
}
/* Mirrored, because a preview of yourself that isn't mirrored reads as wrong. */
.cp-video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
.cp-err {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px; text-align: center;
  padding: 16px; color: var(--text-2); font-size: 13px; background: rgba(0,0,0,.55);
}

.cp-select {
  width: 100%; padding: 8px 12px; border-radius: 8px;
  background: var(--bg-input); color: var(--text-1);
  border: 1px solid rgba(255,255,255,.08); font: inherit; font-size: 14px; outline: none;
}

.cp-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cp-always { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); cursor: pointer; }
.cp-always input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
.cp-go {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-radius: 8px;
  background: var(--accent); color: var(--text-on-accent);
  font-size: 14px; font-weight: 600; transition: filter var(--dur-1) var(--ease-out);
}
.cp-go:hover:not(:disabled) { filter: brightness(1.08); }
.cp-go:disabled { opacity: .5; cursor: default; }
</style>
