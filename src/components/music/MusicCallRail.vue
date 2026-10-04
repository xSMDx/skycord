<script setup lang="ts">
/**
 * The room, inside the music modal.
 *
 * This is the column a streaming app spends on "about the artist", and the
 * reason that would be the wrong thing to build here. Spotify's third pane
 * sells you a catalogue because you are one person with headphones. There
 * is no catalogue in this app: every track in the middle column is one
 * someone in this call put there. What you actually want to know is which
 * of your friends is listening to what, and whether to go and join them.
 *
 * So: one card per music channel, listeners named rather than counted, and
 * the selected track in the library gets a single button that puts it in
 * front of everyone. That button is the whole bridge between "my music" and
 * "our music", which is why it says what it will do rather than just "play".
 */
import { computed, ref } from 'vue'
import { Music2, Plus, Radio, Send, SkipForward, Volume2, X } from 'lucide-vue-next'
import { voice } from '@/composables/useVoice'
import { useAuth } from '@/composables/useAuth'
import {
  music, createMusicChannel, shareToChannel, listenToMusic, closeMusicChannel, skipMusic,
  channelElapsed, musicNow, type MusicChannelView, type MusicEntryView,
} from '@/composables/useMusic'
import { clock, type LibTrack } from '@/composables/useMusicLibrary'
import type { VoiceRoomChoice } from './rooms'

const props = defineProps<{ selected: LibTrack | null; rooms: VoiceRoomChoice[] }>()
const emit = defineEmits<{ join: [channelId: string] }>()

const naming = ref(false)
const newName = ref('')

// Connected AND in a room: activeConvId is only set once the join lands,
// so this is false during the connecting stage, which is correct — there is
// nothing to show the channels of yet.
const inCall = computed(() => voice.connected && !!voice.activeConvId)

const { user } = useAuth()

const nameOf = (id: string): string =>
  voice.participants.find(p => p.id === id)?.name ?? 'Someone'

/** Who put a song on. "you" for your own, because your own name reads oddly. */
const addedBy = (id: string): string => (id === user.value?.id ? 'you' : nameOf(id))

/** A pasted link carries no tags, and a URL is not a title. */
const titleOf = (e: MusicEntryView): string => e.title ?? 'A linked track'

/** How many of the queue to spell out before "and N more". */
const SHOWN_NEXT = 3

/** 0–1 through the current song, or null when there is no length to measure. */
const fraction = (c: MusicChannelView): number | null => {
  const d = c.now?.durationSec
  const at = channelElapsed(c, musicNow.value)
  return d && at !== null ? Math.min(1, at / d) : null
}

/** "1:02 / 3:30", or just "1:02" for a link that never said how long it is. */
const timeLine = (c: MusicChannelView): string => {
  const at = channelElapsed(c, musicNow.value)
  if (at === null) return ''
  const d = c.now?.durationSec
  return d ? `${clock(at)} / ${clock(d)}` : clock(at)
}

/**
 * Names, not a number.
 *
 * "2 listening" is a fact about a crowd. These are people you are in a call
 * with, so the useful sentence is the one with their names in it, and the
 * overflow only starts once a list would stop being readable.
 */
const listeners = (ids: string[], known?: { id: string; name: string }[]): string => {
  if (!ids.length) return 'Nobody yet'
  // Outside a call the names come with the room, because voice.participants
  // only ever holds the call you are in — which is none of them.
  const names = known
    ? known.map(p => p.name)
    : ids.map(nameOf)
  if (names.length <= 2) return names.join(' and ')
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

/** Send the selected track to a channel, and move your ear there with it. */
const pushTo = (channelId: string): void => {
  if (props.selected) shareToChannel(channelId, props.selected.id)
}

const startWith = (): void => {
  const n = newName.value.trim()
  if (!n) return
  // A new channel wants something to play. With a track selected it starts
  // on that; without one there is nothing to open a decode for, so the
  // button is disabled rather than creating a silent channel.
  if (props.selected) createMusicChannel(n, { trackId: props.selected.id })
  newName.value = ''
  naming.value = false
}
</script>

<template>
  <aside class="cr">
    <span class="cr-head">
      <Radio :size="13" :stroke-width="2.25" />
      <span>{{ inCall ? 'In this call' : 'Where everyone is' }}</span>
    </span>

    <!--
      Outside a call this rail still answers its one question — where is the
      room — rather than filling the space with something unrelated. You
      opened this to play something for people; these are where the people
      are, and one click puts you in with them.
    -->
    <template v-if="!inCall">
      <ul v-if="rooms.length" class="cr-list">
        <li v-for="r in rooms" :key="r.channelId">
          <button class="cr-room" @click="emit('join', r.channelId)">
            <span class="cr-roomtop">
              <Volume2 class="cr-ico" :size="14" :stroke-width="2.25" />
              <span class="cr-names">
                <span class="cr-name">{{ r.name }}</span>
                <span v-if="r.serverName" class="cr-who">{{ r.serverName }}</span>
              </span>
              <span class="cr-join">Join</span>
            </span>
            <span class="cr-faces">
              <!-- Faces rather than a count, for the same reason the in-call
                   rows name their listeners: you recognise the people. -->
              <img
                v-for="p in r.people.slice(0, 5)" :key="p.id"
                class="cr-face" :src="p.avatar" :alt="p.name" :title="p.name"
              />
              <span v-if="r.people.length > 5" class="cr-more">+{{ r.people.length - 5 }}</span>
              <span class="cr-wholine">{{ listeners(r.people.map(p => p.id), r.people) }}</span>
            </span>
          </button>
        </li>
      </ul>

      <p v-else class="cr-empty">
        Nobody is in a voice channel right now. Join one and whatever you play
        here, everyone in it can tune into.
      </p>
    </template>

    <template v-else>
      <ul v-if="music.channels.length" class="cr-list">
        <li
          v-for="c in music.channels" :key="c.id"
          class="cr-card" :class="{ on: music.listeningTo === c.id }"
        >
          <div class="cr-top">
            <button
              class="cr-tune"
              :aria-pressed="music.listeningTo === c.id"
              :aria-label="music.listeningTo === c.id ? `Stop listening to ${c.name}` : `Listen to ${c.name}`"
              @click="listenToMusic(music.listeningTo === c.id ? null : c.id)"
            >
              <!-- The song's own cover where it has one: a channel is what
                   it is playing, and the art is the fastest way to say so. -->
              <span class="cr-art" :class="{ empty: !c.now?.cover }">
                <img v-if="c.now?.cover" :src="c.now.cover" alt="" />
                <Music2 v-else :size="15" :stroke-width="2.25" />
              </span>
              <span class="cr-names">
                <span class="cr-name">{{ c.name }}</span>
                <span v-if="c.now" class="cr-song">
                  {{ titleOf(c.now) }}<template v-if="c.now.artist"> · {{ c.now.artist }}</template>
                </span>
                <span v-else class="cr-song quiet">Nothing playing</span>
              </span>
              <span class="cr-state">{{ music.listeningTo === c.id ? 'Listening' : 'Join' }}</span>
            </button>
          </div>

          <!-- Where the song is. Read from the server's clock offset, not
               from audio, so it is right on a card you are not tuned into —
               which is the card you are deciding whether to join. -->
          <div v-if="c.now" class="cr-prog">
            <span class="cr-rail" role="presentation">
              <span
                v-if="fraction(c) !== null" class="cr-fill"
                :style="{ transform: `scaleX(${fraction(c)})` }"
              />
            </span>
            <span class="cr-meta">
              <span class="cr-by">Added by {{ addedBy(c.now.addedBy) }}</span>
              <span class="cr-time">{{ timeLine(c) }}</span>
            </span>
          </div>

          <!-- Who, and what you can do about it, on one line. The buttons used
               to share the top row with the name and squeezed it to "pe…". -->
          <div class="cr-foot">
            <p class="cr-who">{{ c.listeners.length ? `${listeners(c.listeners)} listening` : 'Nobody listening yet' }}</p>
            <div class="cr-acts">
              <button
                class="cr-icon" :disabled="!selected"
                :aria-label="selected ? `Add ${selected.title} to ${c.name}` : 'Pick a track first'"
                v-tip="selected ? `Add “${selected.title}” to ${c.name}` : 'Pick a track in your library first'"
                @click="pushTo(c.id)"
              >
                <Send :size="13" :stroke-width="2.25" />
              </button>
              <!-- Shared, so skipping is for everyone, and the tip says so. -->
              <button
                v-if="c.now" class="cr-icon" :aria-label="`Skip for everyone in ${c.name}`"
                v-tip="'Skip — for everyone listening'"
                @click="skipMusic(c.id)"
              >
                <SkipForward :size="13" :stroke-width="2.25" />
              </button>
              <button
                class="cr-icon danger" :aria-label="`Close ${c.name} for everyone`"
                v-tip="'Close this channel for everyone'"
                @click="closeMusicChannel(c.id)"
              >
                <X :size="13" :stroke-width="2.25" />
              </button>
            </div>
          </div>

          <!-- What is coming, so nobody has to tune in to find out. -->
          <div v-if="c.queue.length" class="cr-next">
            <span class="cr-nexthead">Up next</span>
            <ol class="cr-nextlist">
              <li v-for="(e, i) in c.queue.slice(0, SHOWN_NEXT)" :key="i" class="cr-nextrow">
                <span class="cr-nexttitle">{{ titleOf(e) }}</span>
                <span class="cr-nextby">{{ addedBy(e.addedBy) }}</span>
              </li>
            </ol>
            <span v-if="c.queue.length > SHOWN_NEXT" class="cr-nextmore">
              and {{ c.queue.length - SHOWN_NEXT }} more
            </span>
          </div>
        </li>
      </ul>

      <p v-else-if="!naming" class="cr-empty">
        Nothing playing in this call yet. Pick a track and start a channel — anyone
        here can tune in, or not.
      </p>

      <form v-if="naming" class="cr-new" @submit.prevent="startWith">
        <input
          v-model="newName" class="cr-in" maxlength="32"
          placeholder="Channel name" aria-label="Music channel name" autofocus
        />
        <p v-if="!selected" class="cr-hint">Pick a track in your library to start it with.</p>
        <div class="cr-newacts">
          <button type="button" class="cr-flat" @click="naming = false; newName = ''">Cancel</button>
          <button type="submit" class="cr-go" :disabled="!newName.trim() || !selected">Start</button>
        </div>
      </form>
      <button v-else class="cr-add" @click="naming = true">
        <span>New music channel</span>
        <Plus :size="13" :stroke-width="2.5" />
      </button>

      <p v-if="music.error" class="cr-err" role="alert">{{ music.error }}</p>
    </template>
  </aside>
</template>

<style scoped>
.cr {
  display: flex; flex-direction: column; gap: 6px;
  /* The modal close floats over this corner. Without the top inset its X
     lands two rows above the X on a channel card — very different acts
     wearing the same glyph thirty pixels apart. */
  padding: 44px 12px 14px; background: var(--bg-panel);
  border-radius: var(--edge-lg); overflow-y: auto;
}
.cr-head {
  display: flex; align-items: center; gap: 6px; padding: 0 2px 4px;
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; color: var(--text-3);
}
.cr-empty { padding: 2px; font-size: 11.5px; line-height: 1.55; color: var(--text-3); }

.cr-list { list-style: none; display: flex; flex-direction: column; gap: 4px; }

/* ── outside a call: the rooms ──────────────────────────────────────── */
.cr-room {
  display: flex; flex-direction: column; gap: 8px; width: 100%;
  padding: 10px 11px; border: none; cursor: pointer; text-align: left;
  background: var(--bg-input); border-radius: var(--edge-md);
  transition: background var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .cr-room:hover { background: var(--hover-strong); }
  .cr-room:hover .cr-join { opacity: 1; }
}
.cr-room:active { transform: scale(.99); }
.cr-roomtop { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cr-join {
  flex-shrink: 0; font-size: 11px; font-weight: 700; letter-spacing: .3px;
  text-transform: uppercase; color: var(--accent-text); opacity: .6;
  /* Visible at rest, not revealed on hover: the card exists to be clicked,
     and an affordance you have to find first is not one. */
  transition: opacity var(--dur-2) var(--ease-out);
}
.cr-faces { display: flex; align-items: center; gap: 4px; min-width: 0; }
.cr-face {
  width: 20px; height: 20px; border-radius: 50%; object-fit: cover;
  flex-shrink: 0; background: var(--bg-panel);
}
.cr-more { font-size: 10.5px; color: var(--text-3); flex-shrink: 0; }
.cr-wholine {
  font-size: 11px; color: var(--text-3); margin-left: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.cr-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 8px 4px 10px 8px;
  border-radius: var(--edge-md); background: var(--bg-input);
}
/* Selection is a ring over a neutral fill. The accent means hover here. */
.cr-card.on { box-shadow: inset 0 0 0 1px var(--active-ring); background: var(--active-bg); }

.cr-top { display: flex; align-items: center; gap: 2px; min-width: 0; }
.cr-tune {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 10px;
  padding: 0; border: none; background: none; cursor: pointer;
  text-align: left; border-radius: var(--edge-sm);
}
.cr-ico { flex-shrink: 0; color: var(--text-3); }

.cr-art {
  flex-shrink: 0; width: 40px; height: 40px; border-radius: var(--edge-sm);
  overflow: hidden; background: var(--bg-panel);
  display: grid; place-items: center; color: var(--text-3);
}
.cr-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cr-card.on .cr-art.empty { color: var(--accent-text); }

.cr-song {
  font-size: 12px; color: var(--text-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cr-song.quiet { color: var(--text-3); }

/* The verb, at rest. Same reasoning as the room cards: the card exists to
   be clicked, and saying what a click does beats making you guess. */
.cr-state {
  flex-shrink: 0; padding: 0 4px;
  font-size: 10.5px; font-weight: 700; letter-spacing: .3px;
  text-transform: uppercase; color: var(--text-3);
}
.cr-card.on .cr-state { color: var(--accent-text); }

.cr-prog { display: flex; flex-direction: column; gap: 4px; padding-right: 6px; }
.cr-rail {
  display: block; height: 3px; border-radius: var(--edge-pill);
  background: var(--hover-strong); overflow: hidden;
}
.cr-fill {
  display: block; height: 100%; width: 100%;
  background: var(--text-3);
  transform-origin: left center;
  /* Stepped once a second; a matching transition makes it glide. */
  transition: transform 1s linear;
}
.cr-card.on .cr-fill { background: var(--accent); color: var(--text-on-accent); }
.cr-meta {
  display: flex; justify-content: space-between; gap: 8px;
  font-size: 10.5px; color: var(--text-3);
}
.cr-by { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.cr-time { flex-shrink: 0; font-variant-numeric: tabular-nums; }

.cr-next {
  display: flex; flex-direction: column; gap: 3px;
  padding: 7px 6px 0 0; border-top: 1px solid var(--border);
}
.cr-nexthead {
  font-size: 10px; font-weight: 700; letter-spacing: .4px;
  text-transform: uppercase; color: var(--text-3);
}
.cr-nextlist { list-style: none; display: flex; flex-direction: column; gap: 2px; }
.cr-nextrow { display: flex; justify-content: space-between; gap: 8px; min-width: 0; font-size: 11.5px; }
.cr-nexttitle { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.cr-nextby { flex-shrink: 0; color: var(--text-3); font-size: 10.5px; }
.cr-nextmore { font-size: 10.5px; color: var(--text-3); }
.cr-names { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.cr-name {
  font-size: 13.5px; font-weight: 600; color: var(--text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cr-who {
  font-size: 11.5px; color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.cr-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-width: 0; }
.cr-foot .cr-who { flex: 1; min-width: 0; }
.cr-acts { flex-shrink: 0; display: flex; align-items: center; gap: 1px; padding-right: 4px; }
.cr-icon {
  display: grid; place-items: center; width: 24px; height: 24px;
  border: none; background: none; cursor: pointer; color: var(--text-3);
  border-radius: var(--edge-sm);
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .cr-icon:hover:not(:disabled) { background: var(--hover); color: var(--text-1); }
  .cr-icon.danger:hover { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger-text); }
}
.cr-icon:disabled { opacity: .35; cursor: not-allowed; }
.cr-icon:active:not(:disabled) { transform: scale(.94); }

.cr-add {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; padding: 8px 10px; margin-top: 2px;
  border: 1px dashed var(--border); background: none; cursor: pointer;
  border-radius: var(--edge-md); color: var(--text-2);
  font-size: 12.5px; font-weight: 500; font-family: inherit;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out),
              border-color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .cr-add:hover { background: var(--hover); color: var(--text-1); border-color: transparent; }
}

.cr-new { display: flex; flex-direction: column; gap: 6px; padding: 2px 0; }
.cr-in {
  width: 100%; min-width: 0; padding: 7px 9px;
  background: var(--bg-input); color: var(--text-1);
  border: 1px solid transparent; border-radius: var(--edge-md);
  font-size: 12.5px; font-family: inherit; outline: none;
  transition: border-color var(--dur-2) var(--ease-out);
}
.cr-in:focus { border-color: var(--accent); }
.cr-hint { font-size: 11px; line-height: 1.45; color: var(--text-3); }
.cr-newacts { display: flex; gap: 6px; justify-content: flex-end; }
.cr-go, .cr-flat {
  padding: 6px 11px; border: none; border-radius: var(--edge-md);
  font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out);
}
.cr-go { background: var(--accent); color: var(--text-on-accent); }
.cr-go:disabled { opacity: .5; cursor: default; }
.cr-flat { background: var(--bg-input); color: var(--text-2); }
@media (hover: hover) and (pointer: fine) {
  .cr-go:hover:not(:disabled) { background: var(--accent-hover); }
  .cr-flat:hover { background: var(--hover); color: var(--text-1); }
}

.cr-err { font-size: 11.5px; line-height: 1.45; color: var(--danger-text); padding: 2px; }

/* On a narrow modal the rail becomes a strip under the header rather than
   disappearing — "who is listening" is the point of the screen. */
@media (max-width: 900px) {
  .cr {
    grid-column: 1 / -1;
    flex-direction: row; flex-wrap: wrap; align-items: center;
    /* No longer the top-right corner, so no longer under the close button. */
    padding: 12px 10px;
  }
  .cr-list { flex-direction: row; flex-wrap: wrap; }
  .cr-card { min-width: 180px; }
  .cr-add { width: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .cr-icon, .cr-add, .cr-go, .cr-flat, .cr-in { transition: none; }
}
</style>
