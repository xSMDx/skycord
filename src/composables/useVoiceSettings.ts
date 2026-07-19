/**
 * Voice & Video device/capture preferences. Persisted to localStorage and fed to
 * livekit-client when publishing the mic (and, in Phase 2, the camera). Separate
 * from useAppearance — these are device/IO concerns, not theming.
 */
import { reactive } from 'vue'

export type InputMode = 'voice' | 'ptt'

// 'standard' = the browser's own suppression (the long-standing default).
// 'rnnoise'  = WASM model in the mic pipeline; Skycord turns the browser filter
//              OFF in that mode so the two can't double-process each other.
export type NoiseMode = 'off' | 'standard' | 'rnnoise'

export interface VoiceSettings {
  inputDeviceId:    string   // '' = system default
  outputDeviceId:   string
  cameraDeviceId:   string
  inputVolume:      number   // 0..100 (mic gain, applied client-side)
  outputVolume:     number   // 0..100 (remote audio element volume)
  inputMode:        InputMode
  pttKey:           string   // e.g. 'Space' (KeyboardEvent.code)
  sensitivity:      number   // 0..100 voice-activity threshold
  noiseMode:        NoiseMode
  echoCancellation: boolean
  screenAudio:      boolean   // capture system/tab audio when screen sharing
  callHeightPct:    number    // call bar height as a fraction of the chat column
  showOwnCamera:    boolean   // render your own camera tile in the grid
  showNonVideo:     boolean   // render avatar tiles for participants without video
}

const KEY = 'sykord_voice'
const DEFAULTS: VoiceSettings = {
  inputDeviceId: '', outputDeviceId: '', cameraDeviceId: '',
  inputVolume: 100, outputVolume: 100,
  inputMode: 'voice', pttKey: 'Space', sensitivity: 30,
  noiseMode: 'standard', echoCancellation: true,
  screenAudio: true, showOwnCamera: true, showNonVideo: true,
  callHeightPct: 0.3,
}

const load = (): Partial<VoiceSettings> => {
  let raw: any = {}
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
  // Migrate the old boolean toggle to the three-way mode so saved settings
  // survive the upgrade: on → browser suppression, off → none.
  if (raw.noiseMode === undefined && raw.noiseSuppression !== undefined) {
    raw.noiseMode = raw.noiseSuppression ? 'standard' : 'off'
  }
  delete raw.noiseSuppression
  return raw
}

export const voiceSettings = reactive<VoiceSettings>({ ...DEFAULTS, ...load() })

export const setVoiceSettings = (patch: Partial<VoiceSettings>) => {
  Object.assign(voiceSettings, patch)
  localStorage.setItem(KEY, JSON.stringify(voiceSettings))
}

export const resetVoiceSettings = () => setVoiceSettings({ ...DEFAULTS })

// Capture constraints for livekit-client's mic track, derived from the settings.
export const micCaptureOptions = () => ({
  deviceId: voiceSettings.inputDeviceId || undefined,
  // Mono. Voice codecs are mono anyway, and a stereo capture left RNNoise
  // (which processes one channel) cleaning one ear while the other passed
  // through raw — audible as "noise only in my left ear".
  channelCount: 1,
  echoCancellation: voiceSettings.echoCancellation,
  // In 'rnnoise' mode the browser filter is deliberately off — RNNoise does the
  // work downstream, and stacking both degrades the voice.
  noiseSuppression: voiceSettings.noiseMode === 'standard',
  autoGainControl: true,
})

export const useVoiceSettings = () => ({ voiceSettings, setVoiceSettings, resetVoiceSettings })
