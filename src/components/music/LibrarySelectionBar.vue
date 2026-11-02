<script setup lang="ts">
/**
 * What you can do with the songs you picked in the library.
 *
 * It floats at the bottom of the library pane while selection is on, over the
 * rows as they scroll, so the count and the acts never leave the screen you
 * are picking on. Two acts and a way out: your own queue, in the order the
 * list shows them, and removal — which in All tracks or a search deletes from
 * your library, and inside a playlist only takes them out of it, the same as
 * each row's own ✕ there. The words say which one this is.
 *
 * While a removal runs the bar is its progress: a count of where it has got
 * to, said aloud, and a rail along the top edge that fills. The acts are off
 * until it ends; Cancel stops it after the song in hand. When the server's
 * limit holds it up, the bar says it is waiting rather than sitting on a count
 * that does not move; Cancel stops the wait at once.
 */
import { computed, ref } from 'vue'
import { ListEnd, Trash2, X } from 'lucide-vue-next'

const props = defineProps<{
  /** How many rows are picked. */
  count: number
  /** Open on a playlist: removal takes songs out of it rather than deleting them. */
  inPlaylist: boolean
  /** A removal under way, or null. `verb` is "Deleting" or "Removing";
   *  `waiting`, the server's limit is being waited out. */
  progress: { verb: string; done: number; total: number; waiting?: boolean } | null
  /** After a run: what did not go, which stays picked. */
  note?: string
}>()
const emit = defineEmits<{ queue: []; remove: []; cancel: [] }>()

const WAITING_SAYS = 'Waiting for the limit…'

const status = computed(() => {
  const p = props.progress
  if (p?.waiting) return WAITING_SAYS
  if (p) return `${p.verb} ${Math.min(p.done + 1, p.total)} of ${p.total}…`
  return `${props.count} selected`
})
/**
 * Where the keyboard goes once a removal is confirmed. The confirmation hands
 * focus back to Delete, which the run turns off in the same moment, so the
 * room moves it here: Cancel is the one control a run leaves on.
 */
const cancelBtn = ref<HTMLButtonElement | null>(null)
defineExpose({ focusCancel: () => cancelBtn.value?.focus() })

const filled = computed(() => {
  const p = props.progress
  return p && p.total ? p.done / p.total : 0
})
</script>

<template>
  <div class="lsb" role="region" aria-label="Selected songs">
    <!-- One polite region for the count, the progress and what failed: here
         for as long as the bar is, so a change is read rather than missed. -->
    <span class="lsb-status" role="status" aria-live="polite">
      {{ status }}<span v-if="note && !progress" class="lsb-note">{{ note }}</span>
    </span>
    <div v-if="progress" class="lsb-rail" aria-hidden="true">
      <span :style="{ transform: `scaleX(${filled})` }" />
    </div>
    <div class="lsb-acts">
      <button type="button" class="lsb-btn" :disabled="!count || !!progress" @click="emit('queue')">
        <ListEnd :size="16" :stroke-width="2.25" aria-hidden="true" />
        <span>Add to your queue</span>
      </button>
      <button
        type="button" class="lsb-btn" :class="{ danger: !inPlaylist }"
        :disabled="!count || !!progress" @click="emit('remove')"
      >
        <component :is="inPlaylist ? X : Trash2" :size="16" :stroke-width="2.25" aria-hidden="true" />
        <span>{{ inPlaylist ? 'Remove from playlist' : 'Delete' }}</span>
      </button>
      <button ref="cancelBtn" type="button" class="lsb-btn quiet" @click="emit('cancel')">
        <span>Cancel</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/*
 * Raised off the pane, the one floating thing in it: the chat surface, a
 * hairline, a menu's shadow. Sticky to the bottom of the scrolling library,
 * and pushed there by margin-top: auto when the list is short, so it is
 * always in the same place.
 */
.lsb {
  position: sticky; bottom: 12px; z-index: 1;
  flex-shrink: 0;
  display: flex; align-items: center; gap: 12px;
  margin: auto 14px 12px;
  padding: 8px 8px 8px 16px;
  background: var(--bg-chat);
  border: 1px solid var(--border);
  border-radius: var(--edge-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.lsb-status {
  flex: 1 1 auto; min-width: 0;
  font-size: 13px; font-weight: 600; line-height: 18px; color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
/* A reason is read, not scanned: it wraps rather than being cut short. */
.lsb-note {
  display: block; margin-top: 2px;
  font-size: 12px; font-weight: 500; line-height: 16px; color: var(--danger-text);
  overflow-wrap: anywhere;
}

/* Along the top edge, slim, and grown by transform: width would be a layout
   animation. */
.lsb-rail {
  position: absolute; top: 0; left: 0; right: 0;
  height: 2px; background: var(--track);
}
.lsb-rail > span {
  display: block; height: 100%; width: 100%;
  background: var(--accent); color: var(--text-on-accent);
  transform-origin: left center;
  transition: transform var(--dur-2) var(--ease-out);
}

.lsb-acts { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
/* Neutral: the accent is the header's Play, and one per surface. Delete is
   the outlined danger button DESIGN.md describes; Cancel is transparent until
   hovered, the quietest of the three. */
.lsb-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 34px; padding: 0 12px;
  border: 1px solid transparent; border-radius: var(--edge-md);
  background: var(--hover); color: var(--text-1);
  font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.lsb-btn.danger { background: none; border-color: var(--danger); color: var(--danger-text); }
.lsb-btn.quiet { background: none; color: var(--text-2); }
.lsb-btn:disabled { opacity: .45; cursor: default; }
@media (hover: hover) and (pointer: fine) {
  .lsb-btn:hover:not(:disabled) { background: var(--hover-strong); }
  .lsb-btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 12%, transparent); }
  .lsb-btn.quiet:hover { background: var(--hover); color: var(--text-1); }
}

/* A finger's size, every one of them. */
@media (pointer: coarse) {
  .lsb-btn { min-height: 44px; min-width: 44px; }
}

/*
 * A phone: the count and Cancel on one line, the two acts sharing the next,
 * half each. Their words stay whole ("Remove from playlist" is the longest);
 * the icons go, because beside the words they say nothing new and the words
 * are what fit.
 */
@media (max-width: 680px) {
  .lsb {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px 8px; margin: auto 8px 8px; bottom: 8px;
    padding: 8px 8px 8px 14px;
  }
  .lsb-acts { display: contents; }
  .lsb-btn.quiet { grid-column: 2; grid-row: 1; justify-self: end; }
  .lsb-status { grid-column: 1; grid-row: 1; align-self: center; }
  .lsb-btn:not(.quiet) { grid-row: 2; white-space: normal; text-align: center; line-height: 16px; }
  .lsb-acts > .lsb-btn:first-child { grid-column: 1; }
  .lsb-acts > .lsb-btn:nth-child(2) { grid-column: 2; }
  .lsb-btn:not(.quiet) svg { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .lsb-btn, .lsb-rail > span { transition: none; }
}
</style>
