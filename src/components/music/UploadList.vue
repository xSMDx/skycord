<script setup lang="ts">
/**
 * The files going up, one row each, where the single progress bar used to be.
 *
 * Quiet on purpose. It sits in the library of a modal people open to listen,
 * and while a batch goes up it is the one thing on screen that keeps
 * changing, so it changes as little as it can: one bar moves at a time,
 * states are words with a small icon rather than colour, and a finished row
 * says so and goes. A failure stays, in the server's words, until it is
 * dismissed — the only row that needs anything from you. A lost connection
 * is one line over the rows, with a Retry, rather than a failure on each.
 *
 * What changes without anyone touching it is said aloud by one live region,
 * there from the start and outside the list that comes and goes — a region
 * that arrives with its words is, to most screen readers, not heard at all.
 *
 * The queue is useMusicLibrary's, not this component's, so it carries on with
 * the modal closed and this only draws it.
 */
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { Clock, Hourglass, LoaderCircle, Check, CircleAlert, WifiOff, X } from 'lucide-vue-next'
import { uploads, uploadBatch, dropUpload, retryUploads, clock } from '@/composables/useMusicLibrary'
import { announcement, snapshot, HELD_SAYS, type UploadItem } from '@/composables/uploadScheduler'

/** A second hand, running only while a row waits out the limit. */
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
const stopTick = (): void => { if (tick) { clearInterval(tick); tick = null } }
const counting = computed(() => uploads.some(u => u.state === 'limited'))
watch(counting, (on) => {
  stopTick()
  if (!on) return
  now.value = Date.now()
  tick = setInterval(() => { now.value = Date.now() }, 1000)
}, { immediate: true })
onBeforeUnmount(stopTick)

/** "0:42" until the next try. Empty once it is due, rather than "0:00". */
const left = (u: UploadItem): string => {
  const s = u.retryAt ? Math.ceil((u.retryAt - now.value) / 1000) : 0
  return s > 0 ? clock(s) : ''
}

const status = (u: UploadItem): string => {
  switch (u.state) {
    // The file held by a lost connection says why it has not gone.
    case 'waiting': return u.error ?? 'Waiting'
    case 'uploading': return `Uploading… ${u.pct}%`
    case 'converting': return 'Checking and converting…'
    case 'done': return 'Added to your library'
    default: return ''
  }
}

const icons = {
  waiting: Clock, limited: Hourglass, uploading: LoaderCircle, converting: LoaderCircle,
  done: Check, failed: CircleAlert,
} as const
const busy = (u: UploadItem): boolean => u.state === 'uploading' || u.state === 'converting'

/** Converting: the server has every byte and will finish it whatever we do.
 *  Done: it is going by itself. */
const canDrop = (u: UploadItem): boolean => u.state !== 'converting' && u.state !== 'done'
const dropLabel = (u: UploadItem): string =>
  u.state === 'uploading' ? `Stop uploading ${u.name}`
    : u.state === 'failed' ? `Dismiss ${u.name}`
      : `Don’t upload ${u.name}`
const dropTip = (u: UploadItem): string =>
  u.state === 'uploading' ? 'Stop' : u.state === 'failed' ? 'Dismiss' : 'Don’t upload'

const summary = computed(() => `${uploadBatch.done} of ${uploadBatch.total} uploaded`)

/*
 * The live region's words. Rows already there when the list mounted are not
 * news. Emptied for a tick before each new line, so the same words twice —
 * the connection lost again after a Retry — are said twice.
 */
const said = ref('')
let seen = snapshot(uploads, uploadBatch)
let mounted = true
watch(
  () => [uploads.map(u => `${u.id}:${u.state}`).join('|'), uploadBatch.held, uploadBatch.done, uploadBatch.total],
  () => {
    const line = announcement(seen, uploads, uploadBatch)
    seen = snapshot(uploads, uploadBatch)
    if (!line) return
    said.value = ''
    void nextTick(() => { if (mounted) said.value = line })
  },
)
onBeforeUnmount(() => { mounted = false })
</script>

<template>
  <p class="ul-sr" aria-live="polite">{{ said }}</p>
  <section v-if="uploads.length" class="ul" aria-label="Uploads">
    <div v-if="uploadBatch.held" class="ul-held">
      <WifiOff class="ul-ico" :size="14" :stroke-width="2.25" aria-hidden="true" />
      <span class="ul-held-say">{{ HELD_SAYS }}</span>
      <button type="button" class="ul-retry" @click="retryUploads()">Retry</button>
    </div>
    <p v-if="uploadBatch.total > 1" class="ul-sum">{{ summary }}</p>
    <TransitionGroup tag="ul" name="ul-row" class="ul-list">
      <li v-for="u in uploads" :key="u.id" class="ul-row" :class="u.state">
        <LoaderCircle v-if="busy(u)" class="ul-ico spin" :size="14" :stroke-width="2.25" aria-hidden="true" />
        <component :is="icons[u.state]" v-else class="ul-ico" :size="14" :stroke-width="2.25" aria-hidden="true" />

        <span class="ul-name" :title="u.name">{{ u.name }}</span>

        <span v-if="u.state === 'limited'" class="ul-state">
          Waiting for the upload limit…<span v-if="left(u)" class="ul-left">{{ left(u) }}</span>
        </span>
        <p v-else-if="u.state === 'failed'" class="ul-err">{{ u.error }}</p>
        <span v-else class="ul-state">{{ status(u) }}</span>

        <div
          v-if="busy(u)" class="ul-bar" role="progressbar"
          :aria-label="`${u.name}, sent`" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="u.pct"
        >
          <span :style="{ transform: `scaleX(${u.pct / 100})` }" />
        </div>

        <button
          v-if="canDrop(u)" type="button" class="ul-x"
          :aria-label="dropLabel(u)" v-tip="dropTip(u)" @click="dropUpload(u.id)"
        >
          <X :size="14" :stroke-width="2.25" />
        </button>
      </li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
/*
 * Recessed, like the progress box it replaces: something the app is doing,
 * set into the pane rather than raised off it.
 */
.ul {
  margin: 0 28px 14px;
  background: var(--bg-input); border-radius: var(--edge-md);
  overflow: hidden;
  /* The library pane is a flex column, and overflow: hidden takes away the
     automatic minimum height — so with a long library under it, this box
     shrank to nothing while the table kept its height. */
  flex-shrink: 0;
}
/* Said aloud, not shown: the rows already show it. */
.ul-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}

/* The connection, not any one file: one line over the rows, its icon in the
   rows' column so it reads as part of the list, and the one thing on it to
   press. Amber, like the limit: something to wait out, not a failure. */
.ul-held {
  display: grid; grid-template-columns: 16px minmax(0, 1fr) auto;
  column-gap: 10px; align-items: center;
  padding: 6px 6px 6px 14px;
  border-bottom: 1px solid var(--divider);
}
.ul-held .ul-ico { color: var(--warning-text); }
.ul-held-say { grid-column: 2; min-width: 0; font-size: 13px; font-weight: 500; line-height: 18px; color: var(--text-1); }
.ul-retry {
  grid-column: 3;
  height: 28px; padding: 0 12px;
  /* Outlined, as settings' Retry is: transparent until hovered, but still
     a button to a finger that cannot hover. Only the bar carries the accent. */
  border: 1px solid var(--border); background: none; border-radius: var(--edge-md);
  font: inherit; font-size: 13px; font-weight: 600; color: var(--text-1);
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ul-retry:hover { background: var(--hover); }
}

.ul-sum {
  margin: 0; padding: 10px 14px 2px;
  font-size: 12px; color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
/* Twenty-five files would push the library off the bottom of the pane. Four
   and a bit rows show, the cut-off one saying there are more. */
.ul-list {
  position: relative;
  list-style: none; margin: 0; padding: 2px 0;
  max-height: 232px; overflow-y: auto; overscroll-behavior: contain;
}

/* Icon, then the name over its state, then the ✕ — which keeps its column
   when it is not there, so a row that starts converting does not re-ellipsise
   its name one button-width later. */
.ul-row {
  display: grid; grid-template-columns: 16px minmax(0, 1fr) 28px;
  column-gap: 10px; align-items: center;
  padding: 8px 6px 8px 14px;
}
.ul-row + .ul-row { border-top: 1px solid var(--divider); }

.ul-ico { grid-column: 1; grid-row: 1; color: var(--icon); }
.ul-row.limited .ul-ico { color: var(--warning-text); }
.ul-row.done .ul-ico { color: var(--green-text); }
.ul-row.failed .ul-ico { color: var(--danger-text); }
.ul-ico.spin { color: var(--accent); animation: ul-spin .8s linear infinite; }
@keyframes ul-spin { to { transform: rotate(360deg); } }

.ul-name {
  grid-column: 2; grid-row: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px; font-weight: 500; line-height: 18px; color: var(--text-1);
}
.ul-state, .ul-err { grid-column: 2; grid-row: 2; margin: 1px 0 0; font-size: 12px; line-height: 16px; }
.ul-state { color: var(--text-3); font-variant-numeric: tabular-nums; }
.ul-row.limited .ul-state { color: var(--text-2); }
.ul-left { margin-left: 6px; color: var(--text-3); }
/* A reason is read, not scanned: it wraps rather than being cut short. */
.ul-err { color: var(--danger-text); overflow-wrap: anywhere; }

/* Slim, and grown by transform: width would be a layout animation. */
.ul-bar {
  grid-column: 2; grid-row: 3; margin-top: 6px;
  height: 3px; border-radius: var(--edge-pill); background: var(--track); overflow: hidden;
}
.ul-bar > span {
  display: block; height: 100%; width: 100%;
  background: var(--accent); color: var(--text-on-accent); border-radius: var(--edge-pill);
  transform-origin: left center;
  transition: transform var(--dur-2) var(--ease-out);
}

.ul-x {
  grid-column: 3; grid-row: 1 / span 2; justify-self: end;
  display: grid; place-items: center; width: 28px; height: 28px;
  border: none; background: none; border-radius: var(--edge-sm);
  color: var(--icon); cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ul-x:hover { background: var(--hover); color: var(--text-1); }
}

/* Rows arrive with a short rise and leave with a fade, and the rest close up
   by transform rather than jumping: finished rows clear while you read. */
.ul-row-enter-from { opacity: 0; transform: translateY(4px); }
.ul-row-enter-active { transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out); }
.ul-row-leave-to { opacity: 0; }
.ul-row-leave-active {
  transition: opacity var(--dur-exit) var(--ease-in);
  position: absolute; left: 0; right: 0;
}
.ul-row-move { transition: transform var(--dur-3) var(--ease-out); }

@media (pointer: coarse) {
  .ul-row { grid-template-columns: 16px minmax(0, 1fr) 44px; padding-block: 6px; }
  .ul-x { width: 44px; height: 44px; }
  .ul-held { padding-block: 0; }
  .ul-retry { min-width: 44px; min-height: 44px; height: 44px; }
}
@media (max-width: 768px) {
  .ul { margin-inline: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .ul-row-enter-from { transform: none; }
  .ul-row-move, .ul-bar > span, .ul-x, .ul-retry { transition: none; }
}
</style>
