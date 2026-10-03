<script setup lang="ts">
/**
 * The music room.
 *
 * Three columns, and the right one is the reason this is not a copy of a
 * streaming app. Spotify's third column sells you an artist, because
 * Spotify is a catalogue and you are one person with headphones. This is a
 * call: the third column is who is listening to what, by name, and tuning
 * into a channel is the thing most people open this to do. The library in
 * the middle exists to feed it.
 *
 * The header takes its colours from the cover art — see coverTheme.ts for
 * why that is the one place colour escapes the token file.
 *
 * Playback here is local preview through one <audio> element: it is what
 * you hear while you decide, and nobody else hears it. Pushing a track to
 * the room is a separate, deliberate action, because "everyone can hear
 * this" should never be the side effect of pressing play.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import {
  Music2, Search, Plus, Play, Pause, SkipBack, SkipForward, Shuffle,
  Upload, Link2, Trash2, X, ListMusic, Radio, Loader2, ShieldAlert,
  Volume1, Volume2, VolumeX,
} from 'lucide-vue-next'
import ModalBase from '@/components/modals/ModalBase.vue'
import MusicCallRail from './MusicCallRail.vue'
import type { VoiceRoomChoice } from './rooms'
import { useAuth } from '@/composables/useAuth'
import { coverTheme, type CoverTheme } from '@/composables/coverTheme'
import { appearance } from '@/composables/useAppearance'
import {
  player, play, pause, toggle, step, seek, setVolume, forget,
} from '@/composables/useMusicPlayer'
import {
  library, loadLibrary, loadPlaylists, openPlaylist, uploadTrack, importTrack,
  deleteTrack, createPlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist,
  shownTracks, clearLibraryError, clock, totalTime, megabytes,
  type LibTrack,
} from '@/composables/useMusicLibrary'

defineProps<{ rooms?: VoiceRoomChoice[] }>()
const emit = defineEmits<{ close: []; join: [channelId: string] }>()
const { accessToken } = useAuth()

// The shell's own dismissal, so the leave transition plays. Emitting close
// upward instead unmounts us on the same tick and the animation never runs.
const dismiss = inject<() => void>('modalClose', () => emit('close'))

const search = ref('')
const adding = ref<'' | 'link'>('')
const linkUrl = ref('')
const newListName = ref('')
const namingList = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

// ── local preview ───────────────────────────────────────────────────────────
/*
 * Playback lives in useMusicPlayer, not here.
 *
 * This modal used to own the audio element, which is why closing it stopped
 * the music and reopening started the track over. It is one view onto a
 * player now; the mini player in the sidebar is another.
 */
const playing = computed(() => player.current)
const paused = computed(() => player.paused)
const at = computed(() => player.at)
const loadingId = computed(() => player.loadingId)
const vol = computed(() => player.volume)

/**
 * A click anywhere on a row plays it.
 *
 * It used to need the number button or a double click, so a row looked
 * clickable and was not — and the call rail asks you to "pick a track",
 * which is the same gesture. Clicks that started on a control inside the
 * row belong to that control.
 */
const onRowClick = (e: MouseEvent, t: LibTrack): void => {
  if ((e.target as HTMLElement).closest("button, select")) return
  void playTrack(t)
}

/** Play from THIS list, so next and previous follow what you are looking at. */
const playTrack = (t: LibTrack): Promise<void> => play(t, shownTracks.value)

const setVol = (e: Event): void => setVolume(Number((e.target as HTMLInputElement).value))
const onSeek = (e: Event): void => seek(Number((e.target as HTMLInputElement).value))
const volIcon = computed(() => player.muted || player.volume === 0 ? VolumeX
  : player.volume < 0.5 ? Volume1 : Volume2)

// ── art-derived header ──────────────────────────────────────────────────────
const theme = ref<CoverTheme | null>(null)
/*
 * The playing record's sleeve wins.
 *
 * It used to theme from the first track in the list that happened to have
 * art, which meant the colour had nothing to do with what you were hearing.
 * What is playing is the thing the room is about; the list's own art is the
 * fallback for before anything has started.
 */
const headerArt = computed<string | null>(() =>
  player.current?.cover ?? shownTracks.value.find(t => t.cover)?.cover ?? null)
watch(headerArt, async (src) => { theme.value = await coverTheme(src) }, { immediate: true })

/*
 * No variables at all when the setting says accent: every rule that reads
 * `var(--art-accent, …)` already names the theme accent as its fallback, so
 * leaving them unset is the switch. One place decides, nothing downstream
 * has to ask.
 */
const headerStyle = computed(() => (theme.value && appearance.musicColour === 'artwork')
  ? {
      '--art-wash': theme.value.wash,
      '--art-accent': theme.value.accent,
      '--art-on-accent': theme.value.onAccent,
    }
  : {})

/**
 * How full the library looks.
 *
 * Two megabytes of two gigabytes is scaleX(0.00097), which paints nothing —
 * so a library with music in it showed the same empty bar as one without.
 * A floor of 1.5% is a sliver rather than a lie: it says "something", which
 * is the true answer, and the text beside it carries the real figure.
 */
const usedFraction = computed(() => {
  const cap = library.caps?.bytesPerMember
  if (!cap || !library.usage.bytes) return 0
  return Math.min(1, Math.max(0.015, library.usage.bytes / cap))
})

/**
 * The big button plays the list, and pauses it when it is already playing.
 *
 * It used to always start the first track, which while that track was
 * playing meant pressing a button labelled Play and hearing the music stop.
 */
const listPlaying = computed(() =>
  !paused.value && !!playing.value && shownTracks.value.some(t => t.id === playing.value!.id))

const playThisList = (): void => {
  if (listPlaying.value) { pause(); return }
  const current = playing.value && shownTracks.value.find(t => t.id === playing.value!.id)
  const next = current ?? shownTracks.value[0]
  if (next) void playTrack(next)
}

// ── the centre pane's identity ──────────────────────────────────────────────
const heading = computed(() => library.open?.name ?? 'All tracks')
const kindLabel = computed(() => library.open ? 'Playlist' : 'Library')
const subtitle = computed(() => {
  const list = shownTracks.value
  if (!list.length) return library.open ? 'Nothing in here yet' : 'Nothing yet'
  return `${list.length} ${list.length === 1 ? 'track' : 'tracks'} · ${totalTime(list)}`
})

// ── actions ─────────────────────────────────────────────────────────────────
const pickFile = (): void => fileInput.value?.click()

const onFile = async (e: Event): Promise<void> => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''              // so the same file can be chosen twice
  if (file) await uploadTrack(file, accessToken.value ?? '')
}

const submitLink = async (): Promise<void> => {
  const u = linkUrl.value.trim()
  if (!u) return
  const got = await importTrack(u)
  if (got) { linkUrl.value = ''; adding.value = '' }
}

const submitList = async (): Promise<void> => {
  const n = newListName.value.trim()
  if (!n) return
  const made = await createPlaylist(n)
  if (made) { newListName.value = ''; namingList.value = false }
}

/** Debounced, because this is a server query on every keystroke otherwise. */
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (q) => {
  if (library.open) return          // search is over the library, not a list
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadLibrary(q), 220)
})

const removeHere = async (t: LibTrack, index: number): Promise<void> => {
  // Inside a playlist the X means "take it out of this list". In the library
  // it means "delete it". Same glyph, genuinely different acts, so they are
  // labelled differently and the destructive one is styled as such.
  if (library.open) await removeFromPlaylist(library.open.id, index)
  else { await deleteTrack(t.id); forget(t.id) }
}

onMounted(async () => {
  await Promise.all([loadLibrary(), loadPlaylists()])
})
// The player keeps going when this closes — that is the point of it living
// elsewhere — so only this component's own timer is cleaned up here.
onBeforeUnmount(() => { if (searchTimer) clearTimeout(searchTimer) })
</script>

<template>
  <ModalBase width="1240px" title="Music" @close="emit('close')">
    <div class="mm-shell" :style="headerStyle">
    <!-- Over the header rather than in a bar of its own: the art is the
         header, and a title strip above it would push the thing this modal
         is actually about down the screen. -->
    <button class="mm-x" aria-label="Close" @click="dismiss">
      <X :size="16" :stroke-width="2.25" />
    </button>
    <div class="mm">
      <!-- ── left: what you own ──────────────────────────────────────── -->
      <aside class="mm-rail">
        <div class="mm-search">
          <Search :size="14" :stroke-width="2.25" />
          <input
            v-model="search" class="mm-search-in" type="search"
            placeholder="Search your music" aria-label="Search your music"
            :disabled="!!library.open"
          />
        </div>

        <button class="mm-nav" :class="{ on: !library.open }" @click="openPlaylist(null)">
          <ListMusic :size="15" :stroke-width="2.25" />
          <span>All tracks</span>
          <span class="mm-count">{{ library.usage.tracks }}</span>
        </button>

        <div class="mm-railhead">
          <span>Playlists</span>
          <button class="mm-mini" aria-label="New playlist" @click="namingList = true">
            <Plus :size="13" :stroke-width="2.5" />
          </button>
        </div>

        <form v-if="namingList" class="mm-newlist" @submit.prevent="submitList">
          <input
            v-model="newListName" class="mm-in" maxlength="64"
            placeholder="Playlist name" aria-label="Playlist name" autofocus
          />
          <div class="mm-newlist-acts">
            <button type="button" class="mm-flat" @click="namingList = false; newListName = ''">Cancel</button>
            <button type="submit" class="mm-go" :disabled="!newListName.trim()">Create</button>
          </div>
        </form>

        <ul class="mm-lists">
          <li v-for="p in library.playlists" :key="p.id">
            <button class="mm-nav" :class="{ on: library.open?.id === p.id }" @click="openPlaylist(p.id)">
              <Music2 :size="15" :stroke-width="2.25" />
              <span class="mm-ellip">{{ p.name }}</span>
              <span class="mm-count">{{ p.count }}</span>
            </button>
          </li>
        </ul>
        <p v-if="!library.playlists.length && !namingList" class="mm-railempty">
          No playlists yet. Make one to group tracks for a mood or a night.
        </p>

        <div class="mm-space">
          <div class="mm-bar" role="img"
               :aria-label="`${megabytes(library.usage.bytes)} of ${library.caps ? megabytes(library.caps.bytesPerMember) : ''} used`">
            <span :style="{ transform: `scaleX(${usedFraction})` }" />
          </div>
          <span class="mm-spacetext">
            {{ megabytes(library.usage.bytes) }}<template v-if="library.caps"> of {{ megabytes(library.caps.bytesPerMember) }}</template>
          </span>
        </div>
      </aside>

      <!-- ── centre: the record you are looking at ───────────────────── -->
      <section class="mm-main">
        <header class="mm-head" :class="{ themed: !!theme && appearance.musicColour === 'artwork' }">
          <div class="mm-art" :class="{ empty: !headerArt }">
            <img v-if="headerArt" :src="headerArt" alt="" />
            <Music2 v-else :size="38" :stroke-width="1.5" />
          </div>
          <div class="mm-headtext">
            <span class="mm-kind">{{ kindLabel }}</span>
            <h2 class="mm-title">{{ heading }}</h2>
            <span class="mm-sub">{{ subtitle }}</span>
            <div class="mm-headacts">
              <button
                class="mm-play" :disabled="!shownTracks.length"
                :aria-label="listPlaying ? 'Pause' : 'Play'" @click="playThisList"
              >
                <component :is="listPlaying ? Pause : Play" :size="16" :stroke-width="2.5" />
                <span>{{ listPlaying ? 'Pause' : 'Play' }}</span>
              </button>
              <button
                class="mm-ghost" :disabled="shownTracks.length < 2" v-tip="'Shuffle'"
                aria-label="Shuffle"
                @click="playTrack(shownTracks[Math.floor(Math.random() * shownTracks.length)])"
              >
                <Shuffle :size="15" :stroke-width="2.25" />
              </button>
              <button class="mm-ghost" v-tip="'Upload a file'" aria-label="Upload a file" @click="pickFile">
                <Upload :size="15" :stroke-width="2.25" />
              </button>
              <button
                class="mm-ghost" :class="{ on: adding === 'link' }" v-tip="'Add from a link'"
                aria-label="Add from a link" @click="adding = adding === 'link' ? '' : 'link'"
              >
                <Link2 :size="15" :stroke-width="2.25" />
              </button>
              <button
                v-if="library.open" class="mm-ghost danger"
                v-tip="'Delete this playlist'" :aria-label="`Delete the playlist ${library.open.name}`"
                @click="deletePlaylist(library.open.id)"
              >
                <Trash2 :size="15" :stroke-width="2.25" />
              </button>
            </div>
          </div>
        </header>

        <form v-if="adding === 'link'" class="mm-link" @submit.prevent="submitLink">
          <input
            v-model="linkUrl" class="mm-in" placeholder="https://…/track.mp3"
            aria-label="Link to an audio file" autofocus
          />
          <button type="submit" class="mm-go" :disabled="!linkUrl.trim() || library.uploading !== null">Add</button>
        </form>

        <div v-if="library.uploading !== null" class="mm-progress" role="status">
          <Loader2 class="mm-spin" :size="14" :stroke-width="2.5" />
          <span>{{ library.uploading < 95 ? 'Uploading…' : 'Checking and converting…' }}</span>
          <div class="mm-bar"><span :style="{ transform: `scaleX(${library.uploading / 100})` }" /></div>
        </div>

        <p v-if="library.error" class="mm-err" role="alert">
          {{ library.error }}
          <button class="mm-dismiss" aria-label="Dismiss" @click="clearLibraryError"><X :size="12" /></button>
        </p>

        <!-- The table. Columns earn their place: album is the only one that
             is ever the reason you recognise a track you cannot name. -->
        <div v-if="shownTracks.length" class="mm-table" role="table">
          <div class="mm-tr mm-th" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">Title</span>
            <span role="columnheader" class="mm-colalbum">Album</span>
            <span role="columnheader" class="mm-coltime">Time</span>
            <span role="columnheader" class="mm-sr">Actions</span>
          </div>
          <div
            v-for="(t, i) in shownTracks" :key="`${t.id}-${i}`"
            class="mm-tr mm-row" :class="{ on: playing?.id === t.id }" role="row"
            @click="onRowClick($event, t)"
          >
            <button class="mm-num" :aria-label="`Play ${t.title}`" @click="playTrack(t)">
              <Loader2 v-if="loadingId === t.id" class="mm-numico mm-spin" :size="13" :stroke-width="2.5" />
              <component
                v-else
                :is="playing?.id === t.id && !paused ? Pause : Play"
                class="mm-numico" :size="13" :stroke-width="2.5"
              />
              <span class="mm-numtext">{{ i + 1 }}</span>
            </button>

            <span class="mm-cell" role="cell">
              <span class="mm-thumb" :class="{ empty: !t.cover }">
                <img v-if="t.cover" :src="t.cover" alt="" />
                <Music2 v-else :size="13" :stroke-width="2" />
              </span>
              <span class="mm-names">
                <span class="mm-name mm-ellip">{{ t.title }}</span>
                <span class="mm-artist mm-ellip">{{ t.artist || 'Unknown artist' }}</span>
              </span>
              <!-- Only when there is something to say. A clean badge on every
                   row would be noise; this marks the files nobody checked. -->
              <ShieldAlert
                v-if="t.scan === 'skipped'" class="mm-unscanned" :size="13" :stroke-width="2.25"
                v-tip="'This server has no virus scanner, so this file was converted but not scanned'"
              />
            </span>

            <span class="mm-colalbum mm-ellip mm-dim" role="cell">{{ t.album || '—' }}</span>
            <span class="mm-coltime mm-dim" role="cell">{{ clock(t.durationSec) }}</span>

            <span class="mm-acts" role="cell">
              <select
                v-if="library.playlists.length && !library.open"
                class="mm-add" :aria-label="`Add ${t.title} to a playlist`"
                @change="addToPlaylist(($event.target as HTMLSelectElement).value, t.id);
                         ($event.target as HTMLSelectElement).value = ''"
              >
                <option value="">+</option>
                <option v-for="p in library.playlists" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
              <button
                class="mm-icon" :class="{ danger: !library.open }"
                :aria-label="library.open ? `Remove ${t.title} from this playlist` : `Delete ${t.title}`"
                v-tip="library.open ? 'Remove from this playlist' : 'Delete from your library'"
                @click="removeHere(t, i)"
              >
                <component :is="library.open ? X : Trash2" :size="14" :stroke-width="2.25" />
              </button>
            </span>
          </div>
        </div>

        <div v-else-if="!library.loading" class="mm-empty">
          <Music2 :size="30" :stroke-width="1.5" />
          <p v-if="library.open">
            This playlist is empty. Open <strong>All tracks</strong> and add something to it.
          </p>
          <p v-else-if="search">Nothing matches “{{ search }}”.</p>
          <p v-else>
            Your library is empty. Upload a file, or add one from a link — then play it
            into a call so everyone can hear it.
          </p>
          <button v-if="!library.open && !search" class="mm-play" @click="pickFile">
            <Upload :size="16" :stroke-width="2.5" /><span>Upload a track</span>
          </button>
        </div>
      </section>

      <!-- ── right: the room ─────────────────────────────────────────── -->
      <MusicCallRail :selected="playing" :rooms="rooms ?? []" @join="emit('join', $event)" />
    </div>

    <!-- ── transport ──────────────────────────────────────────────────── -->
    <!-- Inside the shell, not beside it: the art variables are set on the
         shell, and a sibling would not inherit them — which is exactly why
         the seek bar stayed the default blue while everything else took the
         sleeve's colour. -->
    <!--
      Three zones, and the middle one stacks: what is playing on the left,
      the transport centred, the quieter controls on the right. The centre
      being centred on the BAR rather than on what is left over means the
      play button does not shift when a long title loads — which is the
      whole reason every player worth using is laid out this way.
    -->
    <footer class="mm-foot">
      <div class="mm-now">
        <template v-if="playing">
          <span class="mm-nowart" :class="{ empty: !playing.cover }">
            <img v-if="playing.cover" :src="playing.cover" alt="" />
            <Music2 v-else :size="20" :stroke-width="1.75" />
          </span>
          <span class="mm-nownames">
            <span class="mm-nowtitle mm-ellip">{{ playing.title }}</span>
            <span class="mm-artist mm-ellip">{{ playing.artist || 'Unknown artist' }}</span>
          </span>
        </template>
      </div>

      <div class="mm-deck">
        <div class="mm-keys">
          <button class="mm-icon" :disabled="!playing" aria-label="Previous" @click="step(-1)">
            <SkipBack :size="18" :stroke-width="2.25" />
          </button>
          <button
            class="mm-pp" :disabled="!playing"
            :aria-label="paused ? 'Play' : 'Pause'" @click="toggle"
          >
            <component :is="paused ? Play : Pause" :size="18" :stroke-width="2.5" />
          </button>
          <button class="mm-icon" :disabled="!playing" aria-label="Next" @click="step(1)">
            <SkipForward :size="18" :stroke-width="2.25" />
          </button>
        </div>
        <div class="mm-scrub">
          <span class="mm-time">{{ clock(at) }}</span>
          <input
            class="mm-seek" type="range" min="0" :max="playing?.durationSec || 1" :value="at"
            step="1" aria-label="Seek" :disabled="!playing" @input="onSeek"
          />
          <span class="mm-time">{{ clock(playing?.durationSec ?? 0) }}</span>
        </div>
      </div>

      <div class="mm-aside">
        <!-- Said plainly, because the entire point of the right-hand rail is
             that the other kind of listening is not private. -->
        <span class="mm-only"><Radio :size="12" :stroke-width="2.25" /> Only you</span>
        <component :is="volIcon" class="mm-volico" :size="16" :stroke-width="2.25" />
        <input
          class="mm-vol" type="range" min="0" max="1" step="0.01" :value="vol"
          aria-label="Preview volume" @input="setVol"
        />
      </div>
    </footer>
    </div>

    <input
      ref="fileInput" class="mm-sr" type="file"
      accept="audio/*,.mp3,.flac,.ogg,.opus,.wav,.m4a,.aac" @change="onFile"
    />

  </ModalBase>
</template>

<style scoped>
/*
 * A room, not a dialog.
 *
 * Without a height this collapses to its content, so a library with two
 * tracks in it renders as a short box with the call rail mostly empty —
 * which reads as a form rather than as a place. A fixed height also means
 * the centre column scrolls while the rails stay put, the way every music
 * app people already know behaves.
 */
/*
 * A room, not a dialog.
 *
 * Without a height this collapses to its content, so a library with two
 * tracks renders as a short box with the call rail mostly empty — a form
 * rather than a place. A fixed height also means the centre column scrolls
 * while the rails stay put, the way every music app people already know
 * behaves.
 */
.mm-shell {
  position: relative;
  display: flex; flex-direction: column;
  height: min(780px, 86vh); min-height: 0;
  /* The deepest surface, so the three panels above can read as cards
     floating on it rather than as regions divided by hairlines. */
  background: var(--bg-floor);
}
/*
 * Separate panels with a gap, not one surface cut up by borders.
 *
 * A 1px divider says "these are parts of one thing". A gap says "these are
 * three things that happen to sit together", which is what they are: what
 * you own, what you are looking at, and who is listening. The gap also
 * stops the centre column's artwork wash bleeding into the rails.
 */
.mm {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 272px;
  gap: 8px; padding: 8px 8px 0;
  min-height: 0; flex: 1;
}
.mm-x {
  position: absolute; top: 12px; right: 12px; z-index: 2;
  width: 30px; height: 30px; border-radius: 50%; border: none;
  display: grid; place-items: center; cursor: pointer;
  background: var(--hover-strong); color: var(--text-2);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .mm-x:hover { background: var(--press-veil); color: var(--text-strong); }
}

.mm-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.mm-ellip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.mm-dim { color: var(--text-3); font-size: 13px; }

/* ── left rail ───────────────────────────────────────────────────────── */
.mm-rail {
  position: relative;
  display: flex; flex-direction: column; gap: 2px;
  padding: 14px 10px; background: var(--bg-panel);
  border-radius: var(--edge-lg); overflow-y: auto;
}
.mm-search {
  display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
  padding: 0 10px; background: var(--bg-input); border-radius: var(--edge-pill);
  color: var(--text-3);
}
.mm-search-in {
  flex: 1; min-width: 0; padding: 9px 0; border: none; background: none;
  color: var(--text-1); font-size: 13px; font-family: inherit; outline: none;
}
.mm-search-in:disabled { opacity: .5; }
.mm-search-in::-webkit-search-cancel-button { filter: invert(.6); }

.mm-nav {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 10px 11px; border: none; background: none; cursor: pointer;
  border-radius: var(--edge-md); color: var(--text-2);
  font-size: 14px; font-weight: 500; font-family: inherit; text-align: left;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mm-nav:hover { background: var(--hover); color: var(--text-1); } }
/* Selection is a ring over a neutral fill, never an accent tint — the accent
   already means hover here. DESIGN.md, "selection is a ring, not a fill". */
.mm-nav.on {
  background: var(--active-bg); color: var(--text-1);
  box-shadow: inset 0 0 0 1px var(--active-ring);
}
.mm-nav > span:first-of-type { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mm-count { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }

.mm-railhead {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 11px 6px; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .4px; color: var(--text-3);
}
.mm-mini {
  display: grid; place-items: center; width: 20px; height: 20px;
  border: none; background: none; cursor: pointer; color: var(--text-3);
  border-radius: var(--edge-sm);
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mm-mini:hover { background: var(--hover); color: var(--text-1); } }
.mm-lists { list-style: none; display: flex; flex-direction: column; gap: 2px; }

.mm-railempty { padding: 2px 9px; font-size: 11.5px; line-height: 1.5; color: var(--text-3); }

.mm-newlist { display: flex; flex-direction: column; gap: 6px; padding: 4px 4px 8px; }
.mm-newlist-acts { display: flex; gap: 6px; justify-content: flex-end; }

.mm-space { margin-top: auto; padding: 12px 9px 2px; display: flex; flex-direction: column; gap: 5px; }
.mm-bar { height: 4px; border-radius: var(--edge-pill); background: var(--bg-input); overflow: hidden; }
/* Scaled rather than resized: animating width is a layout animation, and
   this one sits in a list that is already laying out. The transform origin
   makes it grow from the left the way a fill should. */
.mm-bar > span {
  display: block; height: 100%; width: 100%;
  background: var(--accent); color: var(--text-on-accent);
  border-radius: var(--edge-pill);
  transform-origin: left center;
  transition: transform var(--dur-2) var(--ease-out);
}
.mm-spacetext { font-size: 11px; color: var(--text-3); }

/* ── centre ──────────────────────────────────────────────────────────── */
.mm-main {
  display: flex; flex-direction: column; min-width: 0; overflow-y: auto;
  background: var(--bg-panel); border-radius: var(--edge-lg);
}

/*
 * The one place colour comes from content rather than tokens. The wash is
 * already dragged to near-black in coverTheme.ts, so text on it keeps its
 * contrast; the fade to the panel keeps the seam from reading as a band.
 */
.mm-head {
  display: flex; gap: 22px; padding: 28px 28px 22px;
  border-radius: var(--edge-lg) var(--edge-lg) 0 0;
  background: linear-gradient(180deg, var(--bg-chat) 0%, var(--bg-panel) 100%);
}
.mm-head.themed {
  background: linear-gradient(180deg, var(--art-wash) 0%, var(--bg-panel) 100%);
}
.mm-art {
  flex-shrink: 0; width: 176px; height: 176px; border-radius: var(--edge-lg);
  overflow: hidden; box-shadow: var(--shadow-md); background: var(--bg-input);
  display: grid; place-items: center; color: var(--text-3);
}
.mm-art img { width: 100%; height: 100%; object-fit: cover; display: block; }

.mm-headtext { display: flex; flex-direction: column; justify-content: flex-end; gap: 4px; min-width: 0; }
.mm-kind { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--text-2); }
.mm-title {
  font-size: clamp(30px, 3.2vw, 44px); font-weight: 800; line-height: 1.04;
  color: var(--text-strong); letter-spacing: -.025em; margin: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mm-sub { font-size: 13px; color: var(--text-2); }
.mm-headacts { display: flex; align-items: center; gap: 10px; margin-top: 16px; }

.mm-play {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border: none; border-radius: var(--edge-pill);
  /* The ink is measured against whatever colour came off the sleeve — see
     coverTheme.ts. --text-on-accent is only correct for the app's accent,
     which is what this falls back to when there is no artwork. */
  background: var(--art-accent, var(--accent));
  color: var(--art-on-accent, var(--text-on-accent));
  font-size: 13.5px; font-weight: 700; font-family: inherit; cursor: pointer;
  transition: filter var(--dur-2) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mm-play:hover:not(:disabled) { filter: brightness(1.1); } }
.mm-play:active:not(:disabled) { transform: scale(.97); }
.mm-play:disabled { opacity: .45; cursor: not-allowed; }

.mm-ghost {
  display: grid; place-items: center; width: 38px; height: 38px;
  border: none; background: none; cursor: pointer; color: var(--text-2);
  border-radius: 50%;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .mm-ghost:hover:not(:disabled) { background: var(--hover); color: var(--text-1); }
  .mm-ghost.danger:hover { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger-text); }
}
.mm-ghost:disabled { opacity: .4; cursor: not-allowed; }
.mm-ghost.on { background: var(--active-bg); box-shadow: inset 0 0 0 1px var(--active-ring); color: var(--text-1); }
.mm-ghost:active:not(:disabled) { transform: scale(.94); }

.mm-link { display: flex; gap: 8px; padding: 0 28px 14px; }
.mm-in {
  flex: 1; min-width: 0; padding: 8px 10px;
  background: var(--bg-input); color: var(--text-1);
  border: 1px solid transparent; border-radius: var(--edge-md);
  font-size: 13px; font-family: inherit; outline: none;
  transition: border-color var(--dur-2) var(--ease-out);
}
.mm-in:focus { border-color: var(--accent); }
.mm-go, .mm-flat {
  padding: 7px 14px; border: none; border-radius: var(--edge-md);
  font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out);
}
.mm-go { background: var(--accent); color: var(--text-on-accent); }
.mm-go:disabled { opacity: .5; cursor: default; }
.mm-flat { background: var(--bg-input); color: var(--text-2); }
@media (hover: hover) and (pointer: fine) {
  .mm-go:hover:not(:disabled) { background: var(--accent-hover); }
  .mm-flat:hover { background: var(--hover); color: var(--text-1); }
}

.mm-progress {
  display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center;
  margin: 0 28px 14px; padding: 12px 14px;
  background: var(--bg-input); border-radius: var(--edge-md);
  font-size: 12.5px; color: var(--text-2);
}
.mm-progress .mm-bar { grid-column: 1 / -1; }
.mm-spin { animation: mm-spin 1s linear infinite; color: var(--accent); }
@keyframes mm-spin { to { transform: rotate(360deg); } }

.mm-err {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 0 28px 14px; padding: 11px 13px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-radius: var(--edge-md); font-size: 12.5px; line-height: 1.45;
  color: var(--danger-text);
}
.mm-dismiss {
  margin-left: auto; flex-shrink: 0; border: none; background: none;
  color: inherit; cursor: pointer; padding: 2px; border-radius: var(--edge-sm);
}

/* ── the table ───────────────────────────────────────────────────────── */
.mm-table { padding: 0 18px 20px; }
.mm-tr {
  display: grid;
  /* Title and album share what is left in proportion rather than album
     taking a fixed slab: a fixed 170px album column was leaving the title
     176px in a 624px pane, so every name truncated while the album sat in
     space it did not need. The name is the thing people read. */
  grid-template-columns: 36px minmax(0, 1.8fr) minmax(0, 1fr) 52px 64px;
  align-items: center; gap: 12px; padding: 0 10px; border-radius: var(--edge-md);
}
.mm-th {
  height: 34px; font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; color: var(--text-3);
  border-bottom: 1px solid var(--divider); margin-bottom: 8px; border-radius: 0;
}
.mm-row { height: 56px; cursor: pointer; }
@media (hover: hover) and (pointer: fine) { .mm-row:hover { background: var(--hover); } }
.mm-row.on { background: var(--active-bg); box-shadow: inset 0 0 0 1px var(--active-ring); }
.mm-row.on .mm-name { color: var(--art-accent, var(--accent-text)); }

/* The number becomes a play button on hover — the row's primary action,
   without a permanent control taking space on every row. */
.mm-num {
  display: grid; place-items: center; width: 26px; height: 26px;
  border: none; background: none; cursor: pointer; color: var(--text-3);
  border-radius: var(--edge-sm); font-variant-numeric: tabular-nums; font-size: 12.5px;
}
.mm-numico { display: none; }
.mm-row:hover .mm-numico, .mm-row.on .mm-numico { display: block; }
.mm-row:hover .mm-numtext, .mm-row.on .mm-numtext { display: none; }
/* A loading row shows its spinner whether or not the pointer is over it. */
.mm-num .mm-spin { display: block; }
.mm-row:has(.mm-spin) .mm-numtext { display: none; }
.mm-row.on .mm-num { color: var(--art-accent, var(--accent-text)); }

.mm-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mm-thumb {
  flex-shrink: 0; width: 40px; height: 40px; border-radius: var(--edge-sm);
  overflow: hidden; background: var(--bg-input);
  display: grid; place-items: center; color: var(--text-3);
}
.mm-thumb.lg { width: 38px; height: 38px; border-radius: var(--edge-md); }
.mm-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mm-names { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.mm-name { font-size: 14px; font-weight: 500; color: var(--text-1); }
.mm-artist { font-size: 12px; color: var(--text-3); }
.mm-unscanned { flex-shrink: 0; color: var(--warning-text); }

.mm-coltime { text-align: right; font-variant-numeric: tabular-nums; }
.mm-acts { display: flex; align-items: center; justify-content: flex-end; gap: 2px; opacity: 0; }
.mm-row:hover .mm-acts, .mm-row:focus-within .mm-acts { opacity: 1; }
.mm-icon {
  display: grid; place-items: center; width: 26px; height: 26px;
  border: none; background: none; cursor: pointer; color: var(--text-3);
  border-radius: var(--edge-sm);
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .mm-icon:hover { background: var(--hover); color: var(--text-1); }
  .mm-icon.danger:hover { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger-text); }
}
.mm-add {
  width: 26px; height: 26px; border: none; border-radius: var(--edge-sm);
  background: none; color: var(--text-3); cursor: pointer;
  font-size: 13px; font-family: inherit; text-align: center;
  appearance: none; -webkit-appearance: none;
}
@media (hover: hover) and (pointer: fine) { .mm-add:hover { background: var(--hover); color: var(--text-1); } }
.mm-add option { background: var(--bg-panel); color: var(--text-1); }

.mm-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 72px 32px; text-align: center; color: var(--text-3); gap: 14px;
}
.mm-empty p { font-size: 13px; line-height: 1.55; max-width: 320px; }
.mm-empty strong { color: var(--text-2); font-weight: 600; }

/* ── transport ───────────────────────────────────────────────────────── */
/*
 * Three zones on one grid, not a flex row.
 *
 * The centre column is centred on the BAR rather than on whatever space the
 * sides leave over, so the play button does not shift sideways when a long
 * title loads. That is the only reason every player worth using is built
 * this way, and it is invisible until you use a flex row and watch the
 * controls jump.
 *
 * It keeps its height whether or not anything is playing: a bar that
 * appears and disappears would resize the room under the cursor.
 */
.mm-foot {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.9fr) minmax(0, 1fr);
  align-items: center; gap: 16px; flex-shrink: 0;
  height: 88px; padding: 0 18px; background: var(--bg-floor);
}

.mm-now { display: flex; align-items: center; gap: 12px; min-width: 0; }
.mm-nowart {
  flex-shrink: 0; width: 56px; height: 56px; border-radius: var(--edge-md);
  overflow: hidden; background: var(--bg-input);
  display: grid; place-items: center; color: var(--text-3);
}
.mm-nowart img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mm-nownames { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.mm-nowtitle { font-size: 14px; font-weight: 600; color: var(--text-1); }

.mm-deck { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; width: 100%; }
.mm-keys { display: flex; align-items: center; gap: 10px; }
.mm-pp {
  display: grid; place-items: center; width: 38px; height: 38px;
  border: none; border-radius: 50%; cursor: pointer;
  background: var(--text-strong); color: var(--bg-floor);
  transition: transform var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mm-pp:hover:not(:disabled) { transform: scale(1.06); } }
.mm-pp:active:not(:disabled) { transform: scale(.94); }
.mm-pp:disabled { opacity: .35; cursor: not-allowed; }

.mm-scrub { display: flex; align-items: center; gap: 10px; width: 100%; }
.mm-time { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; min-width: 34px; }
.mm-time:last-child { text-align: right; }
.mm-seek { flex: 1; min-width: 60px; accent-color: var(--art-accent, var(--accent)); cursor: pointer; }
.mm-seek:disabled { opacity: .4; cursor: default; }

.mm-aside { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; }
.mm-only {
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
  font-size: 11px; color: var(--text-3);
}
.mm-volico { flex-shrink: 0; color: var(--text-3); }
.mm-vol { width: 92px; min-width: 0; accent-color: var(--art-accent, var(--accent)); cursor: pointer; }

/* ── narrow ──────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  /* The call rail wraps below: on a narrow screen the library is the thing
     you scroll and the rail is a summary. The album column is the first to
     go — it is the one column that is never the reason you recognise a
     track you can already see the name of. */
  .mm { grid-template-columns: 200px minmax(0, 1fr); }
  .mm-colalbum { display: none; }
  .mm-tr { grid-template-columns: 36px minmax(0, 1fr) 52px 64px; }
}

/*
 * Phone.
 *
 * The left rail used to be display:none here, which took search, every
 * playlist and the storage meter with it — a third of the feature, gone,
 * on the device most people have. It becomes a horizontal strip instead:
 * the same controls, laid along the one axis a phone has to spare.
 */
@media (max-width: 680px) {
  .mm { grid-template-columns: minmax(0, 1fr); padding: 8px 8px 0; }

  .mm-rail {
    flex-direction: row; align-items: center; gap: 6px;
    padding: 8px; overflow-x: auto; overflow-y: hidden;
    /* Momentum, and no vertical rubber-banding fighting the sheet's own
       drag-to-dismiss. */
    -webkit-overflow-scrolling: touch;
  }
  .mm-rail::-webkit-scrollbar { display: none; }
  .mm-search { margin-bottom: 0; flex: 0 0 150px; }
  .mm-nav {
    width: auto; flex: 0 0 auto; border-radius: var(--edge-pill);
    background: var(--bg-input); padding: 8px 12px;
  }
  .mm-lists { flex-direction: row; gap: 6px; }
  /* The meter and the empty note are what a phone can do without. The
     heading stays, reduced to the button inside it — that button is the only
     way to make a playlist, and it keeps its place in the markup rather than
     being a second copy that exists only here. */
  .mm-railempty, .mm-space { display: none; }
  .mm-railhead { order: -1; flex: 0 0 auto; padding: 0; }
  .mm-railhead > span { display: none; }
  .mm-railhead .mm-mini { width: 40px; height: 40px; border-radius: 50%; background: var(--bg-input); }

  .mm-head { padding: 16px 16px 14px; gap: 14px; }
  .mm-art { width: 92px; height: 92px; }
  .mm-title { font-size: 26px; }
  .mm-headacts { margin-top: 10px; gap: 6px; }
  .mm-table { padding: 0 10px 16px; }
  /*
   * A head band for the close button.
   *
   * On a desktop it floats over the top-right of the call rail, which has
   * room for it. On a phone that corner is the playlist strip, and every
   * attempt to share the space failed in a different way: padding is not
   * honoured at the scroll end of an overflowing flex row, and a margin
   * just pushed the button out of the clip so it could only be reached by
   * scrolling. So it gets its own row — which is what every other modal in
   * the app has, and this one only lacked because the artwork is its header.
   */
  .mm-shell { padding-top: 34px; }
  .mm-x { top: 2px; right: 8px; }

  /* Names were truncating to four characters: a 40px thumbnail and a 86px
     action column were spending a third of a phone screen on furniture.
     The thumbnail shrinks and the columns give back what they do not need. */
  .mm-tr { grid-template-columns: 36px minmax(0, 1fr) 44px 44px; gap: 8px; }
  .mm-thumb { width: 32px; height: 32px; }
  .mm-cell { gap: 8px; }
  .mm-link, .mm-progress, .mm-err { margin-inline: 16px; padding-inline: 16px; }

  /* Two zones, not three: what is playing, and the one control that matters.
     A scrubber at this width is a 40px target for a three-minute track. */
  .mm-foot { grid-template-columns: minmax(0, 1fr) auto; height: 68px; padding: 0 12px; gap: 10px; }
  .mm-nowart { width: 44px; height: 44px; }
  .mm-deck { flex-direction: row; gap: 0; width: auto; }
  .mm-scrub, .mm-aside { display: none; }
}

/*
 * Touch.
 *
 * Two separate problems, and only one of them is size.
 *
 * The row actions are revealed on hover, which is a perfectly good desktop
 * idiom and on a touch screen means they are revealed never — deleting a
 * track or adding it to a playlist was unreachable on a phone. Hover is a
 * capability, so it is asked about directly rather than inferred from width.
 */
@media (hover: none) {
  .mm-acts { opacity: 1; }
  /* Same reasoning: the play affordance lives under the row number and
     appears on hover. Without a pointer the number is all you ever see. */
  .mm-numico { display: block; }
  .mm-numtext { display: none; }
}

/* DESIGN.md: anything tappable is at least 40px on mobile, and components
   scale up rather than shipping a separate mobile control. */
@media (max-width: 768px) {
  .mm-nav { min-height: 40px; }
  /* The wrapper AND the field: a 40px box around a 36px input leaves four
     pixels that look tappable and are not. */
  .mm-search { min-height: 40px; }
  .mm-search-in { min-height: 40px; }
  .mm-play { padding: 12px 22px; }
  .mm-mini, .mm-newbtn { width: 40px; height: 40px; }
  .mm-icon, .mm-num, .mm-add { width: 40px; height: 40px; }
  .mm-ghost { width: 44px; height: 44px; }
  .mm-pp { width: 44px; height: 44px; }
  .mm-row { height: 62px; }
  /* Two 40px controls need the room, and the time column can give it. */
  .mm-tr { grid-template-columns: 40px minmax(0, 1fr) 48px 86px; }
}

@media (prefers-reduced-motion: reduce) {
  .mm-nav, .mm-ghost, .mm-icon, .mm-go, .mm-flat, .mm-bar > span, .mm-play { transition: none; }
  .mm-spin { animation: none; }
}
</style>
