<script setup lang="ts">
/**
 * Music channels, from the call bar.
 *
 * Several streams run inside one call and each member picks one, so the
 * question this panel answers is not "what is playing" but "what are my
 * friends listening to, and do I want to be in that". Everything below
 * follows from that: the rows lead with names rather than counts, and the
 * row you are on is the one wearing the selection ring.
 *
 * It lives in a CallFlyout like the mic and camera menus, because a music
 * channel is a call control and belongs with the others — not in the
 * sidebar, where it sat while this was being built and where it was a
 * second place to look during a call.
 */
import { ref, computed } from 'vue'
import { Music2, Plus, SkipForward, X } from 'lucide-vue-next'
import CallFlyout from './CallFlyout.vue'
import { voice } from '@/composables/useVoice'
import {
  music, createMusicChannel, queueMusic, skipMusic,
  closeMusicChannel, listenToMusic, clearMusicError,
} from '@/composables/useMusic'

defineProps<{ dir?: 'down' | 'up' }>()
const emit = defineEmits<{ close: [] }>()

const adding = ref(false)
const name = ref('')
const url = ref('')
const queueFor = ref<string | null>(null)
const queueUrl = ref('')

/**
 * Who is listening, by name.
 *
 * A count is the easy answer and the less useful one: this is a crew of
 * people who know each other, so "Ana, Ben" says something "2 listening"
 * does not. Every listener is by definition in the call, so the names are
 * already here in `voice.participants` and nothing extra is fetched.
 */
const nameOf = (id: string): string =>
  voice.participants.find(p => p.id === id)?.name ?? 'Someone'

const listeners = (ids: string[]): string => {
  if (!ids.length) return 'Nobody yet'
  const names = ids.map(nameOf)
  if (names.length <= 2) return names.join(' and ')
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

const canAdd = computed(() => name.value.trim() !== '' && url.value.trim() !== '')

const submitNew = () => {
  if (!canAdd.value) return
  clearMusicError()
  createMusicChannel(name.value.trim(), url.value.trim())
  // Cleared on submit, not on success: the server answers a create with a
  // music:state rather than an ack, so a form waiting for one would sit
  // there looking stuck. A refusal appears below instead.
  name.value = ''; url.value = ''; adding.value = false
}

const submitQueue = (id: string) => {
  const u = queueUrl.value.trim()
  if (!u) return
  clearMusicError()
  queueMusic(id, u)
  queueUrl.value = ''; queueFor.value = null
}

const toggle = (id: string) => listenToMusic(music.listeningTo === id ? null : id)
</script>

<template>
  <CallFlyout :dir="dir" @close="emit('close')">
    <span class="fr-label">Music in this call</span>

    <ul v-if="music.channels.length" class="mf-list">
      <li v-for="c in music.channels" :key="c.id" class="mf-row" :class="{ on: music.listeningTo === c.id }">
        <button
          class="mf-tune"
          :aria-pressed="music.listeningTo === c.id"
          :aria-label="music.listeningTo === c.id ? `Stop listening to ${c.name}` : `Listen to ${c.name}`"
          @click="toggle(c.id)"
        >
          <Music2 class="mf-ico" :size="15" :stroke-width="2.25" />
          <span class="mf-name">{{ c.name }}</span>
          <span class="mf-who">
            {{ listeners(c.listeners) }}<template v-if="c.queued"> · {{ c.queued }} queued</template>
          </span>
        </button>

        <div class="mf-acts">
          <button class="mf-icon" :aria-label="`Skip the track in ${c.name}`" @click="skipMusic(c.id)">
            <SkipForward :size="14" :stroke-width="2.25" />
          </button>
          <button class="mf-icon" :aria-label="`Add a track to ${c.name}`"
                  @click="queueFor = queueFor === c.id ? null : c.id">
            <Plus :size="14" :stroke-width="2.25" />
          </button>
          <button class="mf-icon danger" :aria-label="`Close ${c.name} for everyone`" @click="closeMusicChannel(c.id)">
            <X :size="14" :stroke-width="2.25" />
          </button>
        </div>

        <form v-if="queueFor === c.id" class="mf-inline" @submit.prevent="submitQueue(c.id)">
          <input v-model="queueUrl" class="mf-input" placeholder="https://…/next.mp3"
                 :aria-label="`Link to add to ${c.name}`" autofocus />
          <button type="submit" class="mf-go" :disabled="!queueUrl.trim()">Add</button>
        </form>
      </li>
    </ul>

    <p v-else-if="!adding" class="empty mf-empty">
      Nothing playing. Start a channel and anyone in the call can tune in.
    </p>

    <form v-if="adding" class="mf-new" @submit.prevent="submitNew">
      <label class="mf-label" for="mf-name">Name</label>
      <input id="mf-name" v-model="name" class="mf-input" maxlength="32" placeholder="Chill" autofocus />
      <label class="mf-label" for="mf-url">Link to an audio file</label>
      <input id="mf-url" v-model="url" class="mf-input" placeholder="https://…/track.mp3" />
      <div class="mf-new-acts">
        <button type="button" class="mf-cancel" @click="adding = false; clearMusicError()">Cancel</button>
        <button type="submit" class="mf-go" :disabled="!canAdd">Start</button>
      </div>
    </form>
    <button v-else class="fr mf-add" @click="adding = true">
      <span>New music channel</span>
      <Plus :size="14" :stroke-width="2.25" />
    </button>

    <p v-if="music.error" class="mf-err" role="alert">{{ music.error }}</p>

    <!-- Only while you can hear something: a volume control for silence is
         furniture. Separate from call volume, because turning the music down
         to hear someone is the commonest thing anyone will do here. -->
    <template v-if="music.listeningTo">
      <div class="fr-sep" />
      <label class="fr static mf-vol">
        <span>Music volume</span>
        <input v-model.number="music.volume" class="fr-slider mf-vol-input" type="range"
               min="0" max="1" step="0.01" aria-label="Music volume" />
      </label>
    </template>
  </CallFlyout>
</template>

<style scoped>
.mf-list { list-style: none; display: flex; flex-direction: column; gap: 2px; }

.mf-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  align-items: center; border-radius: var(--edge-md);
}
/*
 * Selection is a neutral fill under a hairline ring, never an accent tint.
 * The accent in this flyout already means hover, and a row that is both
 * selected and hovered must still read as one thing — see DESIGN.md,
 * "selection is a ring, not a fill".
 */
.mf-row.on { background: var(--active-bg); box-shadow: inset 0 0 0 1px var(--active-ring); }

.mf-tune {
  display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto auto;
  column-gap: 8px; align-items: center; text-align: left; min-width: 0;
  padding: 7px 10px; background: none; border: none; cursor: pointer;
  border-radius: var(--edge-md);
}
.mf-ico { grid-row: 1 / 3; color: var(--text-3); flex-shrink: 0; }
.mf-row.on .mf-ico { color: var(--accent-text); }
.mf-name {
  font-size: 13.5px; font-weight: 500; color: var(--text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mf-who {
  font-size: 11.5px; color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mf-acts { display: flex; align-items: center; gap: 1px; padding-right: 4px; }
.mf-icon {
  display: grid; place-items: center; width: 26px; height: 26px;
  border: none; background: none; cursor: pointer; color: var(--text-3);
  border-radius: var(--edge-sm);
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .mf-icon:hover { background: var(--hover); color: var(--text-1); }
  /* Closing a channel stops it for everyone listening, not just you. It sits
     two pixels from skip, so it says what it is before the click, not after. */
  .mf-icon.danger:hover {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--danger-text);
  }
}
.mf-icon:active { transform: scale(0.94); }

.mf-inline { grid-column: 1 / -1; display: flex; gap: 6px; padding: 0 8px 8px; }
.mf-new { display: flex; flex-direction: column; gap: 5px; padding: 4px 8px 8px; }
.mf-new-acts { display: flex; gap: 6px; justify-content: flex-end; margin-top: 2px; }
.mf-label {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; color: var(--text-3);
}
.mf-input {
  width: 100%; min-width: 0; padding: 7px 9px;
  background: var(--bg-input); color: var(--text-1);
  border: 1px solid transparent; border-radius: var(--edge-md);
  font-size: 13px; font-family: inherit; outline: none;
  transition: border-color var(--dur-2) var(--ease-out);
}
.mf-input:focus { border-color: var(--accent); }

.mf-go, .mf-cancel {
  padding: 6px 12px; border: none; border-radius: var(--edge-md);
  font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out);
}
.mf-go { background: var(--accent); color: var(--text-on-accent); }
.mf-go:disabled { opacity: .5; cursor: default; }
.mf-cancel { background: var(--bg-input); color: var(--text-2); }
@media (hover: hover) and (pointer: fine) {
  .mf-go:hover:not(:disabled) { background: var(--accent-hover); }
  .mf-cancel:hover { background: var(--hover); color: var(--text-1); }
}
.mf-go:active:not(:disabled), .mf-cancel:active { transform: scale(0.97); }

.mf-add { color: var(--text-2); }
.mf-empty { padding: 2px 10px 6px; max-width: 230px; }
.mf-err { margin: 2px 10px 6px; font-size: 12px; line-height: 1.45; color: var(--danger-text); }

/* The slider needs the row's full width, which the flex row does not give it. */
.mf-vol { display: grid; grid-template-columns: auto minmax(90px, 1fr); gap: 10px; }
.mf-vol-input { min-width: 0; }

@media (prefers-reduced-motion: reduce) {
  .mf-icon, .mf-go, .mf-cancel, .mf-input { transition: none; }
}
</style>
