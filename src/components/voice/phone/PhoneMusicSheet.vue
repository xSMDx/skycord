<script setup lang="ts">
/**
 * The call's music channels, as a phone sheet.
 *
 * The same panel as the desktop MusicFlyout, with the same contents and the
 * same actions — the channels with who is listening, tune in and out, skip,
 * add a track, start a channel, close one — laid out for a thumb: each channel
 * a full-width card, every target at least 44px, and the verbs written out
 * rather than left as four-pixel glyphs, because a phone has no hover to
 * reveal them. The logic is callMusic's, shared with the flyout; only the
 * layout is here.
 *
 * It sits in the app's BottomSheet, so it drags to dismiss like every other
 * sheet. It ends with the way into the library, which is not ours to open: the
 * host decides what "Your library" shows and whether this stays up behind it.
 */
import { watch } from 'vue'
import { Music2, Plus, SkipForward, X, Library, ChevronRight } from 'lucide-vue-next'
import BottomSheet from '@/components/ui/BottomSheet.vue'
import { voice } from '@/composables/useVoice'
import { music, skipMusic, closeMusicChannel } from '@/composables/useMusic'
import { useCallMusic } from '@/composables/callMusic'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; openLibrary: [] }>()

const {
  adding, name, url, queueFor, queueUrl,
  listeners, canAdd,
  openNew, cancelNew, submitNew, toggleQueue, submitQueue, toggleListen,
} = useCallMusic(() => voice.participants)

/**
 * Focus a field as the form around it opens, which also scrolls it into view.
 * The form replaces a row that may sit below a long list, and one that opened
 * off the bottom of the sheet, with the keyboard still down, would read as
 * nothing having happened. (The `autofocus` attribute is no help: a browser
 * honours it once per page load, not each time a form is drawn.)
 */
const vFocus = { mounted: (el: HTMLElement) => el.focus() }

// Closed means done with: a form left open, or a refusal from last time,
// would otherwise greet the next visit.
watch(() => props.open, o => { if (!o) { cancelNew(); queueFor.value = null } })
</script>

<template>
  <BottomSheet :open="open" title="Music in this call" :height="0.92" @close="emit('close')">
    <div class="pms">
      <ul v-if="music.channels.length" class="pms-list">
        <li v-for="c in music.channels" :key="c.id" class="pms-ch" :class="{ on: music.listeningTo === c.id }">
          <button
            type="button"
            class="pms-tune"
            :aria-pressed="music.listeningTo === c.id"
            :aria-label="music.listeningTo === c.id ? `Stop listening to ${c.name}` : `Listen to ${c.name}`"
            @click="toggleListen(c.id)"
          >
            <!-- The song's cover where it has one; the glyph only for a link,
                 which arrives with no art to show. -->
            <span class="pms-badge" :class="{ live: music.listeningTo === c.id, art: !!c.now?.cover }">
              <img v-if="c.now?.cover" :src="c.now.cover" alt="" draggable="false" />
              <Music2 v-else :size="20" :stroke-width="2.25" />
            </span>
            <span class="pms-lines">
              <!-- The verb shares the name's line, so the two lines under it
                   keep the whole width: the track and the listeners are what
                   a row is chosen by, and they were the ones being cut off. -->
              <span class="pms-top">
                <span class="pms-name">{{ c.name }}</span>
                <span class="pms-join">{{ music.listeningTo === c.id ? 'Listening' : 'Join' }}</span>
              </span>
              <!-- What is actually playing. A library track carries its title;
                   a pasted link has none, so that case says so rather than
                   showing a URL. -->
              <span class="pms-now">
                {{ c.now?.title || (c.now ? 'A linked track' : 'Nothing playing') }}
              </span>
              <span class="pms-who">
                {{ listeners(c.listeners) }}<template v-if="c.queued"> · {{ c.queued }} queued</template>
              </span>
            </span>
          </button>

          <div class="pms-acts">
            <button type="button" class="pms-act" :aria-label="`Skip the track in ${c.name}`" @click="skipMusic(c.id)">
              <SkipForward :size="16" :stroke-width="2.25" />
              <span>Skip</span>
            </button>
            <button
              type="button" class="pms-act" :aria-label="`Add a track to ${c.name}`"
              :aria-expanded="queueFor === c.id" @click="toggleQueue(c.id)"
            >
              <Plus :size="16" :stroke-width="2.25" />
              <span>Add</span>
            </button>
            <!-- Closing stops it for everyone listening, not just you, so it is
                 red before the tap rather than only on hover. -->
            <button type="button" class="pms-act danger" :aria-label="`Close ${c.name} for everyone`" @click="closeMusicChannel(c.id)">
              <X :size="16" :stroke-width="2.25" />
              <span>Close</span>
            </button>
          </div>

          <form v-if="queueFor === c.id" class="pms-inline" @submit.prevent="submitQueue(c.id)">
            <input
              v-model="queueUrl" v-focus class="pms-input" placeholder="https://…/next.mp3"
              inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false"
              :aria-label="`Link to add to ${c.name}`"
            />
            <button type="submit" class="pms-go" :disabled="!queueUrl.trim()">Add</button>
          </form>

          <!-- Only on the channel you can hear, and in its own card: a volume
               control for silence is furniture, and one in a row of its own
               would sit apart from the thing it turns down. Separate from call
               volume, because turning the music down to hear someone is the
               commonest thing anyone will do here. The sheet follows a finger
               down it, so the slider keeps its moves to itself. -->
          <label v-if="music.listeningTo === c.id" class="pms-vol">
            <span>Music volume</span>
            <input v-model.number="music.volume" class="pms-vol-input" type="range"
                   min="0" max="1" step="0.01" aria-label="Music volume" @pointermove.stop />
          </label>
        </li>
      </ul>

      <p v-else-if="!adding" class="pms-empty">
        Nothing playing. Start a channel and anyone in the call can tune in.
      </p>

      <!-- Above the rows rather than at the bottom: a refusal to a create or a
           queue would otherwise sit below the fold of a long list. -->
      <p v-if="music.error" class="pms-err" role="alert">{{ music.error }}</p>

      <div class="pms-card">
        <form v-if="adding" class="pms-new" @submit.prevent="submitNew">
          <label class="pms-label" for="pms-name">Name</label>
          <input id="pms-name" v-model="name" v-focus class="pms-input" maxlength="32" placeholder="Chill" />
          <label class="pms-label" for="pms-url">Link to an audio file</label>
          <input
            id="pms-url" v-model="url" class="pms-input" placeholder="https://…/track.mp3"
            inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false"
          />
          <div class="pms-new-acts">
            <button type="button" class="pms-cancel" @click="cancelNew">Cancel</button>
            <button type="submit" class="pms-go" :disabled="!canAdd">Start</button>
          </div>
        </form>
        <button v-else type="button" class="pms-link" @click="openNew">
          <Plus class="pms-ic" :size="18" :stroke-width="2.25" />
          <span class="pms-grow">New music channel</span>
        </button>

        <button type="button" class="pms-link" @click="emit('openLibrary')">
          <Library class="pms-ic" :size="18" :stroke-width="2.25" />
          <span class="pms-grow">Your library</span>
          <ChevronRight class="pms-chev" :size="16" :stroke-width="2.25" />
        </button>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
/* Groups are 16px apart, as on the call sheet this opens from; the rows inside
   a group are separated by hairlines rather than by space or by fills. */
.pms { display: flex; flex-direction: column; gap: 16px; padding-bottom: 4px; }

.pms-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }

/* One card per channel. Clipped, so the press response on its rows follows
   the corners. */
.pms-ch {
  border-radius: var(--edge-xl); background: var(--hover); overflow: hidden;
  transition: background var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out);
}
.pms-ch > * + * { border-top: 1px solid var(--divider); }
/*
 * Selection is a neutral fill under a hairline ring, never an accent tint:
 * the accent on this sheet already means "do this" (Start, Add), and the
 * channel you are on must not read as one more thing to press — see
 * DESIGN.md, "selection is a ring, not a fill".
 */
.pms-ch.on { background: var(--hover-strong); box-shadow: inset 0 0 0 1px var(--active-ring); }

.pms-tune {
  display: flex; align-items: center; gap: 12px;
  width: 100%; min-height: 64px; padding: 12px 16px;
  border: none; background: none; color: var(--text-1);
  font-family: inherit; text-align: left; cursor: pointer;
}
.pms-lines { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pms-top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.pms-top .pms-name { flex: 1; min-width: 0; }

/* The anchor on the left, and where "this one is live" is said. 44px: it is
   the cover, and a cover smaller than that is not worth drawing. */
.pms-badge {
  flex: none; display: grid; place-items: center;
  width: 44px; height: 44px; border-radius: var(--edge-lg);
  background: var(--bg-panel); color: var(--text-3);
}
.pms-badge.live { background: rgba(var(--accent-rgb), .18); color: var(--accent-text); }
/* With art the tint has nothing to show through, so "live" becomes a ring. */
.pms-badge.art { overflow: hidden; }
.pms-badge.art.live { box-shadow: 0 0 0 2px var(--active-ring); }
.pms-badge img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* Three steps down from the sheet's own 16px title, by size, weight and tone:
   the name must not compete with it, and the listeners are the quietest line. */
.pms-name, .pms-now, .pms-who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pms-name { font-size: 15px; line-height: 20px; font-weight: 600; color: var(--text-1); }
.pms-now { font-size: 14px; line-height: 20px; color: var(--text-2); }
.pms-who { font-size: 13px; line-height: 18px; color: var(--text-3); }

/* The verb. Quiet at rest so a list of channels does not shout, and it is the
   word that tells you the card is a thing you can do. */
.pms-join {
  flex: none;
  font-size: 12px; line-height: 16px; font-weight: 700; letter-spacing: .3px; text-transform: uppercase;
  color: var(--text-3);
  transition: color var(--dur-2) var(--ease-out);
}
.pms-ch.on .pms-join { color: var(--accent-text); }

/* Skip, add, close: one row of three, edge to edge and divided by hairlines,
   not three filled chips inside a filled card. The whole third is the target. */
.pms-acts { display: flex; }
.pms-act {
  flex: 1 1 0; min-width: 44px; min-height: 48px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 0 8px; border: none; background: none; color: var(--text-2);
  font-family: inherit; font-size: 14px; line-height: 20px; font-weight: 600;
  cursor: pointer;
}
.pms-act + .pms-act { border-left: 1px solid var(--divider); }
.pms-act svg { flex: none; }
.pms-act span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pms-act.danger { color: var(--danger-text); }

.pms-inline { display: flex; gap: 8px; padding: 12px 16px; }

.pms-input {
  flex: 1; width: 100%; min-width: 0; min-height: 44px; padding: 0 12px;
  background: var(--bg-input); color: var(--text-1);
  border: 1px solid transparent; border-radius: var(--edge-lg);
  /* 16px: a smaller size makes some phone browsers zoom the page on focus. */
  font-size: 16px; font-family: inherit; outline: none;
  transition: border-color var(--dur-2) var(--ease-out);
}
.pms-input:focus { border-color: var(--accent); }

.pms-go, .pms-cancel {
  min-width: 44px; min-height: 44px; padding: 0 18px;
  border: none; border-radius: var(--edge-lg);
  font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
}
.pms-go { background: var(--accent); color: var(--text-on-accent); }
.pms-go:disabled { opacity: .5; cursor: default; }
.pms-cancel { background: var(--bg-input); color: var(--text-2); }

.pms-empty { margin: 0; padding: 4px 4px 0; font-size: 15px; line-height: 22px; color: var(--text-2); }
.pms-err { margin: 0; padding: 0 4px; font-size: 14px; line-height: 20px; color: var(--danger-text); }

/* The rows that are not a channel: start one, the library. One rounded group,
   each row a full-width target. */
.pms-card { border-radius: var(--edge-xl); background: var(--hover); overflow: hidden; }
.pms-card > * + * { border-top: 1px solid var(--divider); }

.pms-link {
  display: flex; align-items: center; gap: 12px;
  width: 100%; min-height: 52px; padding: 0 16px;
  border: none; background: none; color: var(--text-1);
  font-family: inherit; font-size: 15px; line-height: 20px; text-align: left;
  cursor: pointer;
}
.pms-grow { flex: 1; min-width: 0; }
.pms-ic { flex: none; color: var(--text-2); }
.pms-chev { flex: none; color: var(--text-3); }

.pms-new { display: flex; flex-direction: column; gap: 6px; padding: 16px; }
.pms-new-acts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
.pms-label {
  font-size: 12px; line-height: 16px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; color: var(--text-3);
}

/* The slider needs the row's full width, which the flex rows do not give it. */
.pms-vol {
  display: grid; grid-template-columns: auto minmax(90px, 1fr); align-items: center; gap: 16px;
  min-height: 52px; padding: 0 16px;
  font-size: 15px; line-height: 20px; color: var(--text-1);
}
.pms-vol-input { width: 100%; min-width: 0; min-height: 44px; margin: 0; accent-color: var(--accent); cursor: pointer; }

@media (prefers-reduced-motion: reduce) {
  .pms-ch, .pms-join, .pms-input { transition: none; }
}
</style>
