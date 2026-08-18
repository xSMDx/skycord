/**
 * Your own mute and deafen state, whether or not you are in a call.
 *
 * These are one idea to a user and two implementations underneath: inside a
 * call they drive LiveKit, outside one they are a remembered preference with
 * nothing to apply them to yet. That split used to live as two plain refs
 * inside ChatApp.vue, which meant the only component that could read or write
 * them was ChatApp itself — so the Deafen row inside MicFlyout called the
 * LiveKit toggle instead, and that toggle opens with `if (!room) return`.
 * Clicking Deafen in the user panel outside a call did nothing at all.
 *
 * Module-level refs, so every caller shares one state rather than each
 * component owning a copy.
 */
import { computed, ref } from 'vue'
import { useVoice } from './useVoice'
import { soundMute, soundUnmute, soundDeafen, soundUndeafen } from './useSocket'

/** Remembered while not connected. A call's own state lives in `voice`. */
const preferMuted    = ref(false)
const preferDeafened = ref(false)

/*
 * Deafening force-mutes — hearing nobody while still transmitting is a strange
 * state to leave someone in. It remembers what mute was BEFORE deafening so
 * undeafening restores it, rather than always unmuting (wrong if they were
 * muted on purpose) or leaving them stuck muted (wrong if they weren't).
 */
let muteBeforeDeafen = false

export const useSelfAudio = () => {
  const { voice, toggleMute: callToggleMute, toggleDeafen: callToggleDeafen } = useVoice()

  const muted    = computed(() => voice.connected ? voice.localMuted    : preferMuted.value)
  const deafened = computed(() => voice.connected ? voice.localDeafened : preferDeafened.value)

  const toggleMute = () => {
    if (voice.connected) { callToggleMute(); return }   // owns its own sounds
    preferMuted.value = !preferMuted.value
    preferMuted.value ? soundMute() : soundUnmute()
    // Unmuting while deafened would leave you transmitting audio you cannot
    // hear a reply to, so it lifts the deafen too.
    if (!preferMuted.value && preferDeafened.value) preferDeafened.value = false
  }

  const toggleDeafen = () => {
    if (voice.connected) { callToggleDeafen(); return }
    preferDeafened.value = !preferDeafened.value
    if (preferDeafened.value) {
      muteBeforeDeafen = preferMuted.value
      preferMuted.value = true
      soundDeafen()
    } else {
      preferMuted.value = muteBeforeDeafen
      soundUndeafen()
    }
  }

  return { muted, deafened, toggleMute, toggleDeafen }
}
