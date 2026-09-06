/**
 * What the current voice channel allows this client to publish.
 *
 * A module of its own, and small on purpose. Three different layers need these
 * answers — the call state (useVoice), the media toggles (useVoiceMedia) and the
 * capture graph (micChain) — and every arrangement that put them in one of those
 * files closed an import cycle with another. So they live somewhere all three
 * can import and none of them owns.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 * NOT the enforcement. The grant baked into the LiveKit token is what actually
 * stops a publish, and it is checked by the media server on every track. These
 * flags exist so the interface stops OFFERING what the token would refuse: a
 * camera button that throws, a microphone icon that shows open over a muted
 * track. Editing them in a console buys nothing but a broken-looking client.
 *
 * The one exception is `voiceActivity`. LiveKit cannot express push-to-talk, so
 * there is no token grant behind it — this client honouring it IS the
 * mechanism, which is why the settings UI calls that permission advisory rather
 * than enforced.
 *
 * Defaults are permissive, deliberately. A DM has no channel and therefore
 * nobody with the authority to restrict it, and a server predating these fields
 * sends none of them; reading absence as a denial would grey out working
 * buttons for everybody on an older build.
 */
import { reactive } from 'vue'

export interface VoicePermits {
  /** The token grants a microphone. False while server-muted, or without Speak. */
  audio: boolean
  /** The token grants camera and screen share. False without Video. */
  video: boolean
  /** False means push-to-talk is mandatory in this channel. */
  voiceActivity: boolean
}

const ALL_ALLOWED: VoicePermits = { audio: true, video: true, voiceActivity: true }

export const permits = reactive<VoicePermits>({ ...ALL_ALLOWED })

export const setPermits = (next: Partial<VoicePermits>) => Object.assign(permits, next)

/** Back to unrestricted. Called when a call ends, so the constraints of the
 *  channel just left cannot follow the person into the next one. */
export const resetPermits = () => Object.assign(permits, ALL_ALLOWED)
