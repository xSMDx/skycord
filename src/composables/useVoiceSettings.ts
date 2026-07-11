/**
 * Voice & Video device/capture preferences. Persisted to localStorage and fed to
 * livekit-client when publishing the mic (and, in Phase 2, the camera). Separate
 * from useAppearance — these are device/IO concerns, not theming.
 */
import { reactive } from 'vue'

export type InputMode = 'voice' | 'ptt'

export interface VoiceSettings {
  inputDeviceId:    string   // '' = system default
  outputDeviceId:   string
  cameraDeviceId:   string
  inputVolume:      number   // 0..100 (mic gain, applied client-side)
  outputVolume:     number   // 0..100 (remote audio element volume)
  inputMode:        InputMode
  pttKey:           string   // e.g. 'Space' (KeyboardEvent.code)
  sensitivity:      number   // 0..100 voice-activity threshold
  noiseSuppression: boolean
  echoCancellation: boolean
  screenAudio:      boolean   // capture system/tab audio when screen sharing
  showOwnCamera:    boolean   // render your own camera tile in the grid
  showNonVideo:     boolean   // render avatar tiles for participants without video
}

const KEY = 'sykord_voice'
const DEFAULTS: VoiceSettings = {
  inputDeviceId: '', outputDeviceId: '', cameraDeviceId: '',
  inputVolume: 100, outputVolume: 100,
  inputMode: 'voice', pttKey: 'Space', sensitivity: 30,
  noiseSuppression: true, echoCancellation: true,
  screenAudio: true, showOwnCamera: true, showNonVideo: true,
}

const load = (): Partial<VoiceSettings> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
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
  echoCancellation: voiceSettings.echoCancellation,
  noiseSuppression: voiceSettings.noiseSuppression,
  autoGainControl: true,
})

export const useVoiceSettings = () => ({ voiceSettings, setVoiceSettings, resetVoiceSettings })
