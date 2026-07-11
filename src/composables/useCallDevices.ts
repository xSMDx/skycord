/**
 * useCallDevices — device enumeration + LIVE switching for the call flyouts.
 * Persists choices via useVoiceSettings and applies them to the active LiveKit
 * room immediately (switchActiveDevice), unlike the settings page which only
 * applies at the next capture.
 */
import { ref, computed } from 'vue'
import { getRoom } from './voiceRoom'
import { setVoiceSettings } from './useVoiceSettings'
import { useVoice } from './useVoice'

const { applyOutput } = useVoice()

export const devices = ref<MediaDeviceInfo[]>([])
export const mics     = computed(() => devices.value.filter(d => d.kind === 'audioinput'))
export const speakers = computed(() => devices.value.filter(d => d.kind === 'audiooutput'))
export const cameras  = computed(() => devices.value.filter(d => d.kind === 'videoinput'))
export const supportsSinkId = typeof (HTMLMediaElement.prototype as any).setSinkId === 'function'

export const refreshDevices = async () => {
  try { devices.value = await navigator.mediaDevices.enumerateDevices() } catch { /* denied */ }
}
export const deviceLabel = (d: MediaDeviceInfo, fallback: string) => d.label || fallback

// Persist + live-switch. Empty id = "Default": persist only — the default
// device is whatever the next capture resolves; LiveKit needs a concrete id.
export const setMicDevice = async (id: string) => {
  setVoiceSettings({ inputDeviceId: id })
  const r = getRoom()
  if (r && id) await r.switchActiveDevice('audioinput', id).catch(() => {})
}
export const setSpeakerDevice = (id: string) => {
  setVoiceSettings({ outputDeviceId: id })
  applyOutput()
}
export const setCameraDevice = async (id: string) => {
  setVoiceSettings({ cameraDeviceId: id })
  const r = getRoom()
  if (r?.localParticipant.isCameraEnabled && id) await r.switchActiveDevice('videoinput', id).catch(() => {})
}

export const useCallDevices = () => ({
  devices, mics, speakers, cameras, supportsSinkId,
  refreshDevices, deviceLabel, setMicDevice, setSpeakerDevice, setCameraDevice,
})
