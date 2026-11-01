<script setup lang="ts">
/**
 * One person in the call, as a phone sheet: how loud they are for you, how
 * loud the screen they share is, the local Mute, and Leave stream while you
 * are watching their screen.
 *
 * The desktop's tile menu, laid out for a thumb, on the same state: the
 * sliders are callMenu's volumeSliders — the rows both desktop menus draw, so
 * a range or a hint cannot differ between them — and Mute is the per-person
 * mute that menu's Mute toggles. Only the layout is here: each slider the
 * full width of its row, Mute a switch, every target at least 44px.
 *
 * Everything on it is local (callMenu says why): nothing is sent, and the
 * other person is never told. The sheet says so, because "Mute" under
 * someone's name could otherwise read as muting them for the whole call.
 *
 * The host opens it — from the people in the call sheet, or by a long-press
 * on the stream you joined — and never for you. It sits in the app's
 * BottomSheet, so it drags to dismiss like every other sheet, and fits what
 * it holds rather than standing half empty.
 */
import { computed } from 'vue'
import { MicOff, MonitorOff } from 'lucide-vue-next'
import BottomSheet from '@/components/ui/BottomSheet.vue'
import Avatar from '@/components/ui/Avatar.vue'
import { defaultAvatar } from '@/composables/useAvatar'
import {
  userPref, setUserPref, setStreamVolume, userVolumeMax, joinedStreams, leaveStream,
} from '@/composables/useVoice'
import { media } from '@/composables/useVoiceMedia'
import { volumeSliders } from '@/composables/contextMenus/callMenu'
import type { MenuSlider } from '@/composables/useContextMenu'

const props = defineProps<{ open: boolean; person: { id: string; name: string; avatar: string } | null }>()
const emit = defineEmits<{ close: [] }>()

// Read inside the computed, as the desktop menus read inside their builders:
// Stream Volume comes and goes as they start or stop sharing sound, and User
// Volume's top follows a change of output device, while the sheet is open.
const sliders = computed(() => {
  const p = props.person
  if (!p) return []
  const u = userPref(p.id)
  return volumeSliders(p.id, {
    volume: u.volume, userVolumeMax: userVolumeMax(),
    streamVolume: u.streamVolume, sharesScreenAudio: media.streamsWithAudio.has(p.id),
  }, {
    setUserVolume: (id, v) => setUserPref(id, { volume: v }),
    setStreamVolume,
  })
})

/** The hint's element, for its slider to be described by: one sheet is ever open. */
const hintId = (s: MenuSlider) => `pps-hint-${s.label.toLowerCase().replace(/\s+/g, '-')}`

const muted = computed(() => props.person !== null && userPref(props.person.id).muted)
const toggleMute = () => {
  const p = props.person
  if (p) setUserPref(p.id, { muted: !userPref(p.id).muted })
}

/** Watching their screen: joined, and the share still running. A stopped share takes the row with it. */
const watching = computed(() => props.person !== null && joinedStreams.has(props.person.id) && media.streamsAvailable.has(props.person.id))

// Leaving is the whole errand, and what it changed is on the stage behind:
// the sheet goes with it.
const onLeave = () => {
  const p = props.person
  if (!p) return
  leaveStream(p.id)
  emit('close')
}
</script>

<template>
  <BottomSheet :open="open && person !== null" :title="person?.name ?? ''" height="fit" @close="emit('close')">
    <!-- Who this is: their face beside their name, at the sheet title's size. -->
    <template #head>
      <span v-if="person" class="pps-head">
        <span class="pps-av"><Avatar :src="person.avatar || defaultAvatar(person.name)" alt="" still /></span>
        <span class="pps-name">{{ person.name }}</span>
      </span>
    </template>

    <div v-if="person" class="pps">
      <section class="pps-group">
        <div class="pps-card">
          <label v-for="s in sliders" :key="s.label" class="pps-slider">
            <span class="pps-top">
              <span>{{ s.label }}</span>
              <span class="pps-val">{{ s.format?.(s.value) ?? s.value }}</span>
            </span>
            <input
              class="pps-range" type="range"
              :min="s.min" :max="s.max" :value="s.value"
              :aria-label="s.label" :aria-valuetext="s.format?.(s.value)"
              :aria-describedby="s.hint ? hintId(s) : undefined"
              @input="s.onInput(+($event.target as HTMLInputElement).value)"
              @pointermove.stop
            />
            <span v-if="s.hint" :id="hintId(s)" class="pps-hint">{{ s.hint }}</span>
          </label>

          <!-- The whole row is the switch: a 48px track alone is a small
               target, and the label is what a thumb aims at. -->
          <button type="button" role="switch" class="pps-row" :aria-checked="muted" @click="toggleMute">
            <MicOff class="pps-ic" :size="18" :stroke-width="2.25" aria-hidden="true" />
            <span class="pps-grow">Mute</span>
            <span class="pps-switch" :class="{ on: muted }" aria-hidden="true"><span></span></span>
          </button>
        </div>
        <p class="pps-note">Only for you. {{ person.name }} isn’t told.</p>
      </section>

      <!-- Spec 6: stop loading their screen without leaving the call. Only
           while you are watching it; the stage offers Join stream. -->
      <div v-if="watching" class="pps-card">
        <button type="button" class="pps-row" @click="onLeave">
          <MonitorOff class="pps-ic" :size="18" :stroke-width="2.25" aria-hidden="true" />
          <span class="pps-grow">Leave stream</span>
        </button>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
/* The heading: the BottomSheet's own type, with the face before the name. */
.pps-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pps-av { flex: none; display: flex; width: 32px; height: 32px; }
.pps-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Groups are 16px apart, as on the call sheet this opens from; a group's
   footnote sits close under it, as a settings list's does. */
.pps { display: flex; flex-direction: column; gap: 16px; padding: 0 4px 4px; }
.pps-group { display: flex; flex-direction: column; gap: 8px; }

/* One rounded group, rows divided by hairlines rather than by fills. Clipped,
   so a row's press response follows the corners. */
.pps-card { border-radius: var(--edge-xl); background: var(--hover); overflow: hidden; }

/* A slider takes the row's full width under its label and readout: the
   longer the track, the finer a thumb can set it. The input itself is the
   44px target; the line it draws is the browser's, in the accent, as the
   call's Music volume is. */
.pps-slider { display: flex; flex-direction: column; padding: 12px 16px 4px; }
.pps-top {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  font-size: 15px; line-height: 20px; color: var(--text-1);
}
/* Tabular, so the number does not shimmy as it changes under the thumb. */
.pps-val { flex: none; color: var(--text-2); font-variant-numeric: tabular-nums; }
.pps-range {
  width: 100%; min-width: 0; min-height: 44px; margin: 0;
  accent-color: var(--accent); cursor: pointer;
}
.pps-hint { padding-bottom: 8px; font-size: 13px; line-height: 18px; color: var(--text-3); }

.pps-row {
  display: flex; align-items: center; gap: 12px;
  width: 100%; min-height: 52px; padding: 0 16px;
  border: none; background: none; color: var(--text-1);
  font-family: inherit; font-size: 15px; line-height: 20px; text-align: left;
  cursor: pointer;
}
/* On the press, with no easing in: late feedback is no feedback. */
.pps-row:active { background: var(--press-veil); }
.pps-row:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.pps-ic { flex: none; color: var(--text-2); }
.pps-grow { flex: 1; min-width: 0; }

/* The hairline between rows. After .pps-row, whose `border: none` has the
   same weight once scoped and would otherwise take the line off the row
   under a slider. */
.pps-card > * + * { border-top: 1px solid var(--divider); }

/* The house switch (settingsShared's .st-toggle), a size up for a thumb:
   the grey track, the accent once on, and the knob taking the accent's own
   measured ink there, since the member may pick any accent. */
.pps-switch {
  flex: none; position: relative; width: 48px; height: 28px;
  border-radius: var(--edge-pill); background: var(--toggle-off);
  transition: background var(--dur-2) var(--ease-out);
}
.pps-switch.on { background: var(--accent); color: var(--text-on-accent); }
.pps-switch > span {
  position: absolute; top: 3px; left: 3px; width: 22px; height: 22px;
  border-radius: 50%; background: var(--toggle-knob);
  transition: transform var(--dur-2) var(--ease-out), background var(--dur-2) var(--ease-out);
}
.pps-switch.on > span { transform: translateX(20px); background: var(--text-on-accent); }

.pps-note { margin: 0; padding: 0 16px; font-size: 13px; line-height: 18px; color: var(--text-3); }

/* The switch changes state on the spot; the colour still says which. */
@media (prefers-reduced-motion: reduce) {
  .pps-switch, .pps-switch > span { transition: none; }
}
</style>
