<script setup lang="ts">
/**
 * The phone call screen: a full-screen layer with the stage behind, the call's
 * name at the top, and the sheet at the bottom (the default slot).
 *
 * It owns who fills the stage — pickFocus, fed by its own record of who spoke
 * when, as CallStage keeps one — and when the controls hide. The host owns
 * everything about the call itself: the name and subtitle it shows, who is in
 * it, and what minimising and ringing again do.
 *
 * Teleported to the body: the phone shell slides its panes with a transform,
 * and a fixed layer inside a transformed pane is fixed to the pane, not the
 * screen.
 */
import { computed, reactive, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import PhoneStage from './PhoneStage.vue'
import { pickFocus, FOCUS_HOLD_MS, type FocusState } from '@/composables/phoneCallRules'
import { useAutoHide } from '@/composables/phoneCall'
import { voiceSettings } from '@/composables/useVoiceSettings'
import { userPref } from '@/composables/useVoice'
import type { VideoTrackInfo } from '@/composables/useVoiceMedia'

/** CallStage's tile. `ring` = someone being called who has not picked up. */
type Tile = { id: string; name: string; avatar: string; speaking: boolean; muted: boolean; ring?: 'ringing' | 'no-answer' }

const props = defineProps<{
  name: string
  subtitle: string
  /** The microphone's trouble (micNotice), or null when there is none. */
  notice: string | null
  tiles: Tile[]
  videos: VideoTrackInfo[]
  selfId: string
  /** The person being called did not answer and can be rung again. */
  ringAgain: boolean
  /** The sheet is pulled up. The controls never hide while it is. */
  sheetExpanded: boolean
}>()

const emit = defineEmits<{ minimize: []; ringAgain: [] }>()

defineSlots<{
  /** The sheet. `hidden` = the controls have faded over a video. */
  default?(scope: { hidden: boolean }): unknown
}>()

// The videos the desktop grid would draw: never one you switched off for that
// person, nor your own camera when you asked not to see it.
const shownVideos = computed(() => props.videos.filter(v =>
  v.local ? v.source !== 'camera' || voiceSettings.showOwnCamera : !userPref(v.participantId).videoOff))

// Your camera has the top-right corner, so the top text stops short of it.
const ownCameraOn = computed(() => shownVideos.value.some(v => v.local && v.source === 'camera'))

// ── Who fills the stage ─────────────────────────────────────────────────────
const lastSpokeAt = reactive<Record<string, number>>({})
const focus = ref<FocusState | null>(null)

let holdTimer: ReturnType<typeof setTimeout> | null = null
const clearHold = () => {
  if (holdTimer !== null) clearTimeout(holdTimer)
  holdTimer = null
}

const refocus = () => {
  const now = Date.now()
  for (const t of props.tiles) if (t.speaking) lastSpokeAt[t.id] = now
  focus.value = pickFocus(
    { tiles: props.tiles, videos: shownVideos.value, selfId: props.selfId, lastSpokeAt },
    focus.value, now,
  )
  // pickFocus moves only when asked. A newcomer waiting out the hold has to be
  // asked about again once the wait is up, even if nothing else has changed.
  clearHold()
  const pending = focus.value.pending
  if (pending) holdTimer = setTimeout(refocus, Math.max(0, pending.since + FOCUS_HOLD_MS - now))
}
watch([() => props.tiles, shownVideos, () => props.selfId], refocus, { immediate: true })

// ── Controls that fade over a video ─────────────────────────────────────────
const { hidden, poke } = useAutoHide({ enabled: () => focus.value?.kind !== 'avatar' && !props.sheetExpanded })

// The tap that brings the controls back does only that: the click it ends in
// is swallowed, so it cannot also press whatever reappears under the finger.
// Hold to talk answers pointerdown, which is never stopped, so it works hidden
// or not.
let swallowClick = false
const onPointerDown = () => {
  swallowClick = hidden.value
  poke()
}
const onClickCapture = (e: MouseEvent) => {
  if (!swallowClick) return
  swallowClick = false
  e.stopPropagation()
  e.preventDefault()
}

// Android Back reaches a dialog as Escape, sent to the dialog itself; a
// hardware keyboard's lands here because the screen takes focus when it opens.
const onKey = (e: KeyboardEvent) => {
  poke()
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('minimize')
  }
}

const root = ref<HTMLElement | null>(null)
onMounted(() => root.value?.focus({ preventScroll: true }))
onBeforeUnmount(clearHold)
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="pcs"
      data-surface="media"
      role="dialog"
      aria-modal="true"
      :aria-label="name"
      tabindex="-1"
      @keydown="onKey"
      @pointerdown.capture="onPointerDown"
      @click.capture="onClickCapture"
    >
      <PhoneStage
        :tiles="tiles" :videos="shownVideos" :self-id="selfId"
        :focus="focus" :hidden="hidden" :last-spoke-at="lastSpokeAt"
      >
        <template #ringing>
          <button v-if="ringAgain" type="button" class="pcs-ring" @click="emit('ringAgain')">Ring again</button>
        </template>
      </PhoneStage>

      <header class="pcs-top" :class="{ 'is-hidden': hidden, 'beside-self': ownCameraOn }">
        <button type="button" class="pcs-min" aria-label="Minimise call" @click="emit('minimize')">
          <ChevronDown :size="28" :stroke-width="2.25" />
        </button>
        <div class="pcs-titles">
          <h2 class="pcs-name">{{ name }}</h2>
          <p v-if="subtitle" class="pcs-sub">{{ subtitle }}</p>
          <p v-if="notice" class="pcs-notice">{{ notice }}</p>
        </div>
      </header>

      <slot :hidden="hidden" />
    </div>
  </Teleport>
</template>

<style scoped>
.pcs {
  /* The connection strip is pinned over the top edge and publishes its height
     as --conn-h while it is up (see SettingsModal's phone rule). This layer
     starts below it, and since that height already includes the status bar,
     the top text drops its own inset while the strip shows. */
  --pcs-top-inset: max(0px, env(safe-area-inset-top) - var(--conn-h, 0px));
  /* Where the stage's middle begins: the chevron row and two lines of text. */
  --pcs-top-h: calc(var(--pcs-top-inset) + 72px);
  /* The collapsed sheet: its handle, the row of circles and the hint. The
     sheet may set its own measured height here. */
  --pcs-sheet-h: calc(152px + env(safe-area-inset-bottom));

  position: fixed; left: 0; right: 0; bottom: 0; top: var(--conn-h, 0px);
  /* Over the phone shell and its drawers (up to 960 would be the members
     sheet, never open under a call), under the bottom sheets (950) and modals
     (1000) the screen itself opens: invite, settings, music. */
  z-index: 940;
  overflow: hidden;
  background: var(--bg-floor); color: var(--text-1);
  touch-action: manipulation;
  outline: none;
  animation: pcs-in var(--dur-4) var(--ease-out);
}
@keyframes pcs-in { from { opacity: 0; transform: translateY(24px); } }

/* ── The top: minimise, then the call's name and what is going on ── */
.pcs-top {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: flex-start; gap: 4px;
  padding: calc(var(--pcs-top-inset) + 8px) 16px 0 8px;
  transition: opacity var(--dur-3) var(--ease-inout), visibility 0s;
}
/* The self-view's 84px, its 12px from the edge, and a gap. */
.pcs-top.beside-self { padding-right: 112px; }
.pcs-top.is-hidden {
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity var(--dur-3) var(--ease-inout), visibility 0s linear var(--dur-3);
}

.pcs-min {
  flex: none; width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 50%; background: none; color: var(--text-1);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out);
}
.pcs-min:active { background: var(--press-veil); }
.pcs-min:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

/* Two lines beside a 44px button: 22 + 18 + the 2 that centres them on it. */
.pcs-titles { flex: 1; min-width: 0; padding-top: 2px; text-shadow: 0 1px 2px var(--media-veil); }
.pcs-name {
  margin: 0; font-size: 17px; line-height: 22px; font-weight: 500; letter-spacing: -0.01em;
  color: var(--text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pcs-sub {
  margin: 0; font-size: 13px; line-height: 18px; color: var(--text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pcs-notice { margin: 4px 0 0; font-size: 13px; line-height: 18px; color: var(--warning-text); }

/* ── Ring again, under the person being rung ── */
.pcs-ring {
  min-height: 44px; padding: 0 22px;
  border: none; border-radius: var(--edge-pill);
  background: var(--green); color: var(--text-on-green);
  font-family: inherit; font-size: 15px; font-weight: 600;
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out);
}
.pcs-ring:active { background: var(--green-hover); }
.pcs-ring:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

/* The controls come and go without fading, and the screen arrives in place. */
@media (prefers-reduced-motion: reduce) {
  .pcs { animation: none; }
  .pcs-top, .pcs-top.is-hidden { transition: none; }
}
</style>
