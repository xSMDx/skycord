<script setup lang="ts">
/**
 * Music channels inside a call.
 *
 * Several streams at once, each member tuned into at most one, everyone
 * still talking. Tapping a row tunes you in; tapping the one you are in
 * tunes you out. The listener counts come from the server, not from LiveKit
 * — the server cannot see who subscribed to what, and does not need to,
 * because tuning in is an event a member sends.
 */
import { ref, computed } from 'vue'
import { Music, Plus, SkipForward, X } from 'lucide-vue-next'
import {
  music, musicChannel, createMusicChannel, queueMusic,
  skipMusic, closeMusicChannel, listenToMusic, clearMusicError,
} from '@/composables/useMusic'

const adding = ref(false)
const name = ref('')
const url = ref('')
const queueFor = ref<string | null>(null)
const queueUrl = ref('')

const canAdd = computed(() => name.value.trim().length > 0 && url.value.trim().length > 0)

const submitNew = () => {
  if (!canAdd.value) return
  clearMusicError()
  createMusicChannel(name.value.trim(), url.value.trim())
  // Cleared straight away rather than on success: the server answers with a
  // music:state, not an ack, and a form that waits for one it will never
  // get stays open looking broken. A refusal shows below instead.
  name.value = ''; url.value = ''; adding.value = false
}

const submitQueue = (id: string) => {
  if (!queueUrl.value.trim()) return
  clearMusicError()
  queueMusic(id, queueUrl.value.trim())
  queueUrl.value = ''; queueFor.value = null
}

const toggle = (id: string) => listenToMusic(music.listeningTo === id ? null : id)
</script>

<template>
  <section class="mp" aria-label="Music">
    <div class="mp-head">
      <span class="mp-title">Music</span>
      <button v-if="!adding" class="mp-add" @click="adding = true">
        <Plus :size="14" :stroke-width="2.25" /> New channel
      </button>
    </div>

    <!-- New channel -->
    <form v-if="adding" class="mp-new" @submit.prevent="submitNew">
      <label class="mp-label" for="mp-name">Name</label>
      <input id="mp-name" v-model="name" class="mp-input" maxlength="32" placeholder="Chill" autofocus />
      <label class="mp-label" for="mp-url">Link to an audio file</label>
      <input id="mp-url" v-model="url" class="mp-input" placeholder="https://…/track.mp3" />
      <div class="mp-new-actions">
        <button type="button" class="mp-btn" @click="adding = false; clearMusicError()">Cancel</button>
        <button type="submit" class="mp-btn mp-btn--go" :disabled="!canAdd">Start</button>
      </div>
    </form>

    <p v-if="music.error" class="mp-err" role="alert">{{ music.error }}</p>

    <p v-if="!music.channels.length && !adding" class="empty mp-empty">
      Nothing playing. Start a channel and anyone here can tune in.
    </p>

    <ul v-else-if="music.channels.length" class="mp-list">
      <li v-for="c in music.channels" :key="c.id" class="mp-row" :class="{ on: music.listeningTo === c.id }">
        <button class="mp-tune" :aria-pressed="music.listeningTo === c.id" @click="toggle(c.id)">
          <Music :size="15" :stroke-width="2" class="mp-ico" />
          <span class="mp-name">{{ c.name }}</span>
          <span class="mp-count">
            {{ c.listeners.length === 0 ? 'nobody' : c.listeners.length === 1 ? '1 listening' : `${c.listeners.length} listening` }}
            <template v-if="c.queued"> · {{ c.queued }} queued</template>
          </span>
        </button>
        <button class="mp-icon" aria-label="Skip" @click="skipMusic(c.id)"><SkipForward :size="14" :stroke-width="2.25" /></button>
        <button class="mp-icon" aria-label="Add to queue" @click="queueFor = queueFor === c.id ? null : c.id"><Plus :size="14" :stroke-width="2.25" /></button>
        <button class="mp-icon" aria-label="Close channel" @click="closeMusicChannel(c.id)"><X :size="14" :stroke-width="2.25" /></button>

        <form v-if="queueFor === c.id" class="mp-queue" @submit.prevent="submitQueue(c.id)">
          <input v-model="queueUrl" class="mp-input" placeholder="https://…/next.mp3"
                 :aria-label="`Add a track to ${c.name}`" autofocus />
          <button type="submit" class="mp-btn mp-btn--go" :disabled="!queueUrl.trim()">Add</button>
        </form>
      </li>
    </ul>

    <!-- Volume, independent of voice. Only worth showing while hearing something. -->
    <label v-if="musicChannel" class="mp-vol">
      <span class="mp-label">Music volume</span>
      <input v-model.number="music.volume" type="range" min="0" max="1" step="0.01" aria-label="Music volume" />
    </label>
  </section>
</template>

<style scoped>
.mp { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.mp-head { display: flex; align-items: center; justify-content: space-between; }
.mp-title {
  font-size: 12px; font-weight: 700; letter-spacing: .4px;
  text-transform: uppercase; color: var(--text-3);
}
.mp-add, .mp-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; border-radius: var(--edge-md);
  background: var(--bg-input); border: none; cursor: pointer;
  font-size: 12px; color: var(--text-2);
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.mp-add:hover, .mp-btn:hover { background: var(--hover); color: var(--text-1); }
.mp-add:active, .mp-btn:active { transform: scale(0.97); }
.mp-btn--go { background: var(--accent); color: var(--text-on-accent); }
.mp-btn--go:hover:not(:disabled) { background: var(--accent-hover); color: var(--text-on-accent); }
.mp-btn:disabled { opacity: .5; cursor: default; }

.mp-new { display: flex; flex-direction: column; gap: 6px; }
.mp-new-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.mp-label {
  font-size: 12px; font-weight: 700; letter-spacing: .4px;
  text-transform: uppercase; color: var(--text-3);
}
.mp-input {
  width: 100%; padding: 8px 10px;
  background: var(--bg-input); color: var(--text-1);
  border: 1px solid transparent; border-radius: var(--edge-md);
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color var(--dur-2) var(--ease-out);
}
.mp-input:focus { border-color: var(--accent); }

.mp-err { font-size: 13px; line-height: 1.45; color: var(--danger-text); margin: 0; }
.mp-empty { padding: 4px 0; }

.mp-list { list-style: none; display: flex; flex-direction: column; gap: 4px; }
.mp-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center; gap: 2px;
  border-radius: var(--edge-md);
}
/* Selection is a ring over a neutral fill, never an accent tint — the accent
   already means hover, mentions and primary buttons. See DESIGN.md. */
.mp-row.on {
  background: var(--active-bg);
  box-shadow: inset 0 0 0 1px var(--active-ring);
}
.mp-tune {
  display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto auto;
  column-gap: 8px; align-items: center; text-align: left;
  padding: 8px 10px; background: none; border: none; cursor: pointer; min-width: 0;
}
.mp-ico { grid-row: 1 / 3; color: var(--text-3); }
.mp-row.on .mp-ico { color: var(--accent-text); }
.mp-name { font-size: 14px; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-count { font-size: 12px; color: var(--text-3); }
.mp-icon {
  display: grid; place-items: center; width: 28px; height: 28px;
  border-radius: var(--edge-sm); background: none; border: none; cursor: pointer;
  color: var(--text-3);
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
.mp-icon:hover { background: var(--hover); color: var(--text-1); }
.mp-icon:active { transform: scale(0.97); }

.mp-queue { grid-column: 1 / -1; display: flex; gap: 8px; padding: 0 10px 10px; }
.mp-vol { display: flex; flex-direction: column; gap: 6px; }
.mp-vol input { width: 100%; }

@media (prefers-reduced-motion: reduce) {
  .mp-add, .mp-btn, .mp-icon { transition: none; }
}
</style>
