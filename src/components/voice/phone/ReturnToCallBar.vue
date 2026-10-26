<script setup lang="ts">
/**
 * The way back into a minimised call on a phone: a slim dark strip across the
 * top of every screen while you are in a call and the call screen is not
 * showing — the call screen's own dark, carried up, as a phone's call pill is
 * dark with the call's green inside it. It names the call, keeps the call's
 * time, and shows a green dot when someone is talking: green on the dark, which
 * reads at a glance where a green dot on a green strip could not be seen at all.
 *
 * One button, all of it. Tapping it is the host's to act on (`open`): ChatApp
 * goes back to the call's conversation and brings the screen up.
 *
 * It takes its place in the layout rather than lying over it: ChatApp's .app
 * steps down by its height while it shows (--call-bar-h), as it does for the
 * connection strip, so nothing under it is covered. That height is the 44px
 * below plus the status-bar inset this strip takes on as the top edge.
 *
 * Props: `name` is the call's (the DM's person, the group, "Channel / Server");
 * `talking` is whether anyone in it is talking now; `startedAt` is when you
 * connected (voice.connectedAt), null while the first connect is under way;
 * `failure` is why the call is not up ("Couldn't connect") while a failed
 * join is held, shown in place of the timer on the danger fill — the strip
 * then says the call went, rather than that it is going on.
 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { formatElapsed } from '@/composables/phoneCallRules'

const props = defineProps<{
  name: string
  talking: boolean
  startedAt: number | null
  failure?: string | null
}>()

const emit = defineEmits<{ open: [] }>()

// The same formatter as the screen's subtitle, so the two can never disagree.
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => { if (clock !== null) clearInterval(clock) })

const time = computed(() => (props.startedAt === null ? null : formatElapsed(now.value - props.startedAt)))
</script>

<template>
  <button
    type="button" class="rtc" :class="{ failed: !!failure }" data-surface="media"
    :aria-label="failure ? `Return to call: ${name}, ${failure}` : `Return to call: ${name}`"
    @click="emit('open')"
  >
    <!-- Always there, so the name never shifts when someone starts talking:
         it only wakes up. -->
    <span class="rtc-dot" :class="{ talking: talking && !failure }" aria-hidden="true"></span>
    <span class="rtc-name">{{ name }}</span>
    <span class="rtc-time">{{ failure ?? time ?? 'Connecting…' }}</span>
  </button>
</template>

<style scoped>
/* Under the connection strip when that is up (it carries the status bar
   then, so this drops its own inset), else the top edge of the screen. Over
   the app's panes, under every sheet, modal and the call screen itself. */
.rtc {
  position: fixed; top: var(--conn-h, 0px); left: 0; right: 0; z-index: 900;
  box-sizing: content-box;
  height: 44px;
  padding: max(0px, env(safe-area-inset-top) - var(--conn-h, 0px)) 16px 0;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  border: none; border-radius: 0;
  /* The call screen's ground in every theme (data-surface="media" keeps the
     dark values on the light themes): it is the call, minimised, not a
     surface of the page under it. */
  background: var(--bg-floor); color: var(--text-strong);
  font-family: inherit; font-size: 14px; line-height: 20px; font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  /* It takes the place of the call screen the moment that goes; a short fade
     says it is the same call, smaller, without moving anything. */
  animation: rtc-in var(--dur-2) var(--ease-out);
}
@keyframes rtc-in { from { opacity: 0; } }

/* Pressed, the app-wide press veil lands on it with no easing (style.css). */

/* The join failed: the strip is no longer a call going on, so it takes the
   red the connection strip uses for "can't reach" (white on it measured), and
   the dot goes. Tapping it still opens the screen, whose
   hang-up dismisses the failure. */
.rtc.failed { background: var(--danger-hover); color: var(--text-on-danger-hover); }
.rtc.failed .rtc-dot { opacity: 0; }
.rtc:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -4px; }

/* The call's green, quiet while nobody talks; someone talking brings it up to
   full size and strength. */
.rtc-dot {
  flex: none; width: 8px; height: 8px; border-radius: 50%;
  background: var(--green);
  opacity: .4; transform: scale(.75);
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.rtc-dot.talking { opacity: 1; transform: none; }

/* The name gives way to the timer: a cut-off name is still the call, a
   cut-off time is no time at all. */
.rtc-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* A step further off than the dot is from the name: two facts, not one phrase. */
.rtc-time { flex: none; margin-left: 4px; font-weight: 500; color: var(--text-2); font-variant-numeric: tabular-nums; }
.rtc.failed .rtc-time { color: inherit; }

/* Arrives in place, and the dot changes without moving. */
@media (prefers-reduced-motion: reduce) {
  .rtc { animation: none; }
  .rtc-dot { transition: none; }
}
</style>
