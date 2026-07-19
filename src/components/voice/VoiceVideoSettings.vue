<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { PhCaretDown } from '@phosphor-icons/vue'
import { useVoiceSettings, micCaptureOptions } from '@/composables/useVoiceSettings'
import { createRnnoiseNode } from '@/composables/rnnoiseProcessor'
import { useVoice } from '@/composables/useVoice'
import { soundDeafen, soundUndeafen } from '@/composables/useSocket'

const { voiceSettings, setVoiceSettings, resetVoiceSettings } = useVoiceSettings()

const NOISE_MODES = [
  { value: 'off'      as const, label: 'None',     hint: 'Send your mic through untouched.' },
  { value: 'standard' as const, label: 'Standard', hint: "Your browser's built-in filter. Good for most setups." },
  { value: 'rnnoise'  as const, label: 'RNNoise',  hint: 'Stronger AI filter — kills fans, keyboards and hum, but can chew background music.' },
]
const { applyOutput, voice, toggleDeafen } = useVoice()

// ── Device enumeration ───────────────────────────────────────────────────────
const devices = ref<MediaDeviceInfo[]>([])
const mics     = computed(() => devices.value.filter(d => d.kind === 'audioinput'))
const speakers = computed(() => devices.value.filter(d => d.kind === 'audiooutput'))
const cameras  = computed(() => devices.value.filter(d => d.kind === 'videoinput'))
const supportsSinkId = typeof (HTMLMediaElement.prototype as any).setSinkId === 'function'

const refreshDevices = async () => {
  try { devices.value = await navigator.mediaDevices.enumerateDevices() } catch { /* denied */ }
}
const label = (d: MediaDeviceInfo, fallback: string) => d.label || fallback

// ── Mic test (monitor: deafen + hear yourself + level meter) ──────────────────
const micTesting = ref(false)
const micLevel   = ref(0)
let micStream: MediaStream | null = null
let micCtx: AudioContext | null = null
let rnNode: Awaited<ReturnType<typeof createRnnoiseNode>> | null = null
let micRaf = 0
let deafenedByTest = false

const startMicTest = async () => {
  if (micTesting.value) { stopMicTest(); return }
  try {
    // Same constraints the call publishes with — one source of truth, so the
    // test can't drift from reality (it previously read a renamed field and so
    // requested NO suppression at all).
    micStream = await navigator.mediaDevices.getUserMedia({ audio: micCaptureOptions() })
    await refreshDevices()
    // 48kHz because RNNoise assumes it; harmless for the other modes.
    micCtx = new AudioContext({ sampleRate: 48000 })
    await micCtx.resume()              // some browsers start suspended — fixes the dead meter
    const src = micCtx.createMediaStreamSource(micStream)
    const gain = micCtx.createGain()
    gain.gain.value = voiceSettings.inputVolume / 100
    const analyser = micCtx.createAnalyser()
    analyser.fftSize = 1024
    // Run the monitor through RNNoise when it's selected, so what you hear here
    // is what the call actually sends.
    if (voiceSettings.noiseMode === 'rnnoise') {
      try {
        rnNode = await createRnnoiseNode(micCtx)
        src.connect(rnNode)
        rnNode.connect(gain)
      } catch (e) {
        console.warn('[mic-test] RNNoise unavailable, monitoring raw input', e)
        src.connect(gain)
      }
    } else {
      src.connect(gain)
    }
    gain.connect(analyser)
    gain.connect(micCtx.destination)   // monitor — hear yourself
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
      micLevel.value = Math.min(1, (peak / 128) * 1.6)
      micRaf = requestAnimationFrame(tick)
    }
    tick()
    // Deafen during the test so you only hear your own mic; cue with the sound.
    soundDeafen()
    if (voice.connected && !voice.localDeafened) { toggleDeafen(); deafenedByTest = true }
    micTesting.value = true
  } catch { micTesting.value = false }
}
const stopMicTest = () => {
  cancelAnimationFrame(micRaf)
  micStream?.getTracks().forEach(t => t.stop()); micStream = null
  try { rnNode?.disconnect(); rnNode?.destroy() } catch { /* ignore */ }
  rnNode = null
  micCtx?.close().catch(() => {}); micCtx = null
  micLevel.value = 0
  if (micTesting.value) {
    soundUndeafen()
    if (deafenedByTest) { toggleDeafen(); deafenedByTest = false }
  }
  micTesting.value = false
}

// ── Camera test ──────────────────────────────────────────────────────────────
const camTesting = ref(false)
const videoEl = ref<HTMLVideoElement | null>(null)
let camStream: MediaStream | null = null
const startCamTest = async () => {
  if (camTesting.value) { stopCamTest(); return }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: voiceSettings.cameraDeviceId || undefined },
    })
    await refreshDevices()
    if (videoEl.value) { videoEl.value.srcObject = camStream; await videoEl.value.play().catch(() => {}) }
    camTesting.value = true
  } catch { camTesting.value = false }
}
const stopCamTest = () => {
  camStream?.getTracks().forEach(t => t.stop()); camStream = null
  if (videoEl.value) videoEl.value.srcObject = null
  camTesting.value = false
}

const onOutputVolume = (v: number) => { setVoiceSettings({ outputVolume: v }); applyOutput() }
const onOutputDevice = (id: string) => { setVoiceSettings({ outputDeviceId: id }); applyOutput() }
const onReset = () => { stopMicTest(); stopCamTest(); resetVoiceSettings() }

const capturingPtt = ref(false)
const capturePtt = () => {
  capturingPtt.value = true
  const h = (ev: KeyboardEvent) => {
    ev.preventDefault()
    setVoiceSettings({ pttKey: ev.code })
    window.removeEventListener('keydown', h)
    capturingPtt.value = false
  }
  window.addEventListener('keydown', h)
}

onMounted(refreshDevices)
onBeforeUnmount(() => { stopMicTest(); stopCamTest() })
</script>

<template>
  <div class="vv">
    <h2 class="vv-h">Voice</h2>

    <div class="vv-row2">
      <label class="vv-field">
        <span class="vv-label">Microphone</span>
        <div class="vv-selwrap">
          <select class="vv-select" :value="voiceSettings.inputDeviceId" @change="setVoiceSettings({ inputDeviceId: ($event.target as HTMLSelectElement).value })">
            <option value="">Default</option>
            <option v-for="(d,i) in mics" :key="d.deviceId" :value="d.deviceId">{{ label(d, `Microphone ${i+1}`) }}</option>
          </select>
          <PhCaretDown class="vv-selchev" :size="14" weight="bold" />
        </div>
      </label>
      <label class="vv-field">
        <span class="vv-label">Speaker</span>
        <div class="vv-selwrap">
          <select class="vv-select" :value="voiceSettings.outputDeviceId" :disabled="!supportsSinkId" @change="onOutputDevice(($event.target as HTMLSelectElement).value)">
            <option value="">Default</option>
            <option v-for="(d,i) in speakers" :key="d.deviceId" :value="d.deviceId">{{ label(d, `Speaker ${i+1}`) }}</option>
          </select>
          <PhCaretDown class="vv-selchev" :size="14" weight="bold" />
        </div>
      </label>
    </div>

    <div class="vv-row2">
      <label class="vv-field">
        <span class="vv-label">Input Volume — {{ voiceSettings.inputVolume }}%</span>
        <input class="vv-slider" type="range" min="0" max="100" :value="voiceSettings.inputVolume" @input="setVoiceSettings({ inputVolume: +($event.target as HTMLInputElement).value })" />
      </label>
      <label class="vv-field">
        <span class="vv-label">Output Volume — {{ voiceSettings.outputVolume }}%</span>
        <input class="vv-slider" type="range" min="0" max="100" :value="voiceSettings.outputVolume" @input="onOutputVolume(+($event.target as HTMLInputElement).value)" />
      </label>
    </div>

    <div class="vv-mictest">
      <button class="vv-btn primary" @click="startMicTest">{{ micTesting ? 'Stop Test' : 'Mic Test' }}</button>
      <div class="vv-meter"><div class="vv-meter-fill" :style="{ width: (micLevel*100).toFixed(0) + '%' }" /></div>
    </div>

    <div class="vv-divider" />

    <h3 class="vv-sub">Input Mode</h3>
    <label class="vv-radio">
      <input type="radio" value="voice" :checked="voiceSettings.inputMode==='voice'" @change="setVoiceSettings({ inputMode: 'voice' })" />
      <span><strong>Voice Activity</strong><em>Transmit whenever you speak.</em></span>
    </label>
    <label class="vv-radio">
      <input type="radio" value="ptt" :checked="voiceSettings.inputMode==='ptt'" @change="setVoiceSettings({ inputMode: 'ptt' })" />
      <span><strong>Push to Talk</strong><em>Hold a key to transmit.</em></span>
    </label>

    <template v-if="voiceSettings.inputMode==='voice'">
      <h3 class="vv-sub">Input Sensitivity — {{ voiceSettings.sensitivity }}</h3>
      <input class="vv-slider" type="range" min="0" max="100" :value="voiceSettings.sensitivity" @input="setVoiceSettings({ sensitivity: +($event.target as HTMLInputElement).value })" />
    </template>
    <template v-else>
      <h3 class="vv-sub">Push-to-Talk Key</h3>
      <button class="vv-btn" @click="capturePtt">{{ capturingPtt ? 'Press a key…' : voiceSettings.pttKey }}</button>
    </template>

    <h3 class="vv-sub">Noise Suppression</h3>
    <label v-for="o in NOISE_MODES" :key="o.value" class="vv-radio">
      <input
        type="radio" name="noiseMode" :value="o.value"
        :checked="voiceSettings.noiseMode === o.value"
        @change="setVoiceSettings({ noiseMode: o.value })"
      />
      <span><strong>{{ o.label }}</strong><em>{{ o.hint }}</em></span>
    </label>
    <div class="vv-toggle-row">
      <div class="vv-toggle-text"><span class="vv-label">Echo Cancellation</span><span class="vv-hint">Cancel echo from your speakers.</span></div>
      <button class="vv-tog" :class="{ on: voiceSettings.echoCancellation }" @click="setVoiceSettings({ echoCancellation: !voiceSettings.echoCancellation })"><span/></button>
    </div>

    <div class="vv-divider" />

    <h2 class="vv-h">Camera</h2>
    <div class="vv-cambox">
      <video ref="videoEl" class="vv-video" :class="{ live: camTesting }" muted playsinline />
      <button v-if="!camTesting" class="vv-btn primary vv-testvid" @click="startCamTest">Test Video</button>
      <span v-if="!camTesting" class="vv-cam-placeholder">Camera preview</span>
    </div>
    <label class="vv-field vv-cam-field">
      <span class="vv-label">Camera</span>
      <div class="vv-selwrap">
        <select class="vv-select" :value="voiceSettings.cameraDeviceId" @change="setVoiceSettings({ cameraDeviceId: ($event.target as HTMLSelectElement).value })">
          <option value="">Default</option>
          <option v-for="(d,i) in cameras" :key="d.deviceId" :value="d.deviceId">{{ label(d, `Camera ${i+1}`) }}</option>
        </select>
        <PhCaretDown class="vv-selchev" :size="14" weight="bold" />
      </div>
    </label>
    <button v-if="camTesting" class="vv-btn vv-stopcam" @click="stopCamTest">Stop Test</button>
    <p class="vv-hint">In-call video is coming in the next phase — this preview just checks your camera.</p>

    <div class="vv-divider" />
    <div class="vv-toggle-row">
      <div class="vv-toggle-text"><span class="vv-label">Reset all Voice &amp; Video settings</span><span class="vv-hint">Return to defaults.</span></div>
      <button class="vv-btn danger" @click="onReset">Reset</button>
    </div>
  </div>
</template>

<style scoped>
.vv { max-width: 760px; }
.vv-h { font-size: 20px; font-weight: 700; color: var(--text-strong); margin: 4px 0 16px; }
.vv-sub { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--text-3); margin: 18px 0 8px; }
.vv-row2 { display: flex; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.vv-field { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 6px; }
.vv-label { font-size: 12px; font-weight: 700; color: var(--text-2); }
.vv-hint { display: block; font-size: 12px; color: var(--text-faint); margin-top: 2px; }

/* Custom select — themed, with our own chevron instead of the native control */
.vv-selwrap { position: relative; }
.vv-select {
  -webkit-appearance: none; appearance: none;
  width: 100%; background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
  padding: 10px 34px 10px 12px; color: var(--text-1); font-size: 14px; cursor: pointer;
}
.vv-select:focus { outline: none; border-color: var(--accent); }
.vv-select:disabled { opacity: .6; cursor: not-allowed; }
.vv-select option { background: var(--bg-panel); color: var(--text-1); }
.vv-selchev { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }

.vv-slider { width: 100%; accent-color: var(--accent); cursor: pointer; }
.vv-mictest { display: flex; align-items: center; gap: 14px; margin-top: 16px; }
.vv-meter { flex: 1; height: 8px; border-radius: 4px; background: var(--bg-input); overflow: hidden; }
.vv-meter-fill { height: 100%; background: linear-gradient(90deg, #23a55a, #f0b232 70%, #ed4245); transition: width .05s linear; }
.vv-divider { height: 1px; background: var(--border); margin: 22px 0; }

.vv-radio { display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; }
.vv-radio input { accent-color: var(--accent); width: 16px; height: 16px; }
.vv-radio span { display: flex; flex-direction: column; }
.vv-radio strong { font-size: 14px; color: var(--text-1); }
.vv-radio em { font-style: normal; font-size: 12px; color: var(--text-3); }

.vv-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; }
.vv-toggle-text { display: flex; flex-direction: column; min-width: 0; }
.vv-tog {
  flex-shrink: 0; width: 44px; height: 24px; border-radius: 12px; border: none; padding: 0;
  background: rgba(128,132,142,.5); position: relative; cursor: pointer; transition: background .15s;
  box-sizing: border-box;
}
.vv-tog.on { background: var(--accent); }
.vv-tog span { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
.vv-tog.on span { transform: translateX(20px); }

.vv-btn { padding: 9px 16px; border-radius: 6px; border: none; font-size: 14px; font-weight: 600; background: var(--hover-strong); color: var(--text-1); cursor: pointer; }
.vv-btn:hover { background: var(--hover); }
.vv-btn.primary { background: var(--accent); color: var(--text-on-accent); }
.vv-btn.primary:hover { background: var(--accent-hover); }
.vv-btn.danger { background: transparent; border: 1px solid #ed4245; color: #ed4245; }
.vv-btn.danger:hover { background: rgba(237,66,69,.12); }

/* Camera preview — centered + wide, breathing room before the dropdown */
.vv-cambox {
  position: relative; width: 100%; max-width: 600px; margin: 0 auto 20px;
  background: #000; border: 1px solid var(--border); border-radius: 12px;
  aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.vv-video { width: 100%; height: 100%; object-fit: cover; display: none; }
.vv-video.live { display: block; }
.vv-testvid { position: absolute; z-index: 1; }
.vv-cam-placeholder { position: absolute; bottom: 12px; font-size: 12px; color: var(--text-faint); }
.vv-cam-field { max-width: 600px; margin: 0 auto; }
.vv-stopcam { display: block; max-width: 600px; margin: 14px auto 0; }
</style>
