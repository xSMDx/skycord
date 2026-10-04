<script setup lang="ts">
/**
 * What you are hearing, in the sidebar, while you get on with something else.
 *
 * Two sources, and only ever one at a time — audioFocus makes them mutually
 * exclusive. Your own preview in the music room, or a music channel in the
 * call that you have tuned into. This strip used to know only about the
 * first, so tuning into a channel left it showing a paused preview, or
 * nothing at all, while the room's music played: you could hear a song and
 * see no sign of what it was. Listening together has to be visible, or it
 * is just sound from nowhere.
 *
 * And a third, when you hear neither: music playing in your call that you
 * have not tuned into. It used to show nothing at all, so a song everyone
 * else was listening to was invisible unless you opened the music room.
 *
 * Deliberately small: art, a name, two buttons, a hairline of progress.
 * Everything else is a click away in the room, and this sits directly above
 * the voice panel, the busiest corner of the app.
 */
import { computed } from 'vue'
import { LogOut, Music2, Pause, Play, Radio, SkipForward, X } from 'lucide-vue-next'
import { player, toggle, next, stop } from '@/composables/useMusicPlayer'
import {
  music, musicChannel, channelElapsed, musicNow, skipMusic, listenToMusic,
  type MusicChannelView,
} from '@/composables/useMusic'

const emit = defineEmits<{ open: [] }>()

// ── which one ───────────────────────────────────────────────────────────────

/** Tuned into a channel? Then that is what you hear, so that is what shows. */
const live = computed(() => musicChannel.value)
const soloPlaying = computed(() => !!player.current && !player.paused)

/**
 * Music in your call that you are not hearing — shown when nothing you
 * hear is. The busiest channel if there are several: that is the one most
 * people are in. A paused song of your own does not hide it; one playing does.
 */
const playingHere = computed(() => music.channels.filter(c => c.now))
const nearby = computed(() => {
  if (live.value || soloPlaying.value || !playingHere.value.length) return null
  return [...playingHere.value].sort((a, b) => b.listeners.length - a.listeners.length)[0]
})
const local = computed(() => (live.value || nearby.value ? null : player.current))

// ── the shared channel ──────────────────────────────────────────────────────

const liveTitle = computed(() => {
  const now = live.value?.now
  if (!now) return 'Nothing playing'
  // A pasted link carries no tags, and a URL is not a title.
  return now.title ?? 'A linked track'
})

/** 0–100 through a channel's song, by the shared clock. */
const channelProgress = (c: MusicChannelView | null): number => {
  const d = c?.now?.durationSec
  if (!c || !d) return 0
  const at = channelElapsed(c, musicNow.value) ?? 0
  return Math.min(100, (at / d) * 100)
}
const liveProgress = computed(() => channelProgress(live.value))

const nearbyTitle = computed(() => nearby.value?.now?.title ?? 'A linked track')
const nearbyWho = computed(() => {
  const n = nearby.value?.listeners.length ?? 0
  return n ? ` · ${n} listening` : ''
})

// ── your own preview ────────────────────────────────────────────────────────

/** 0–100. Guarded, because duration is NaN until metadata lands. */
const localProgress = computed(() => {
  const d = player.duration
  return d > 0 ? Math.min(100, (player.at / d) * 100) : 0
})

const progress = computed(() =>
  live.value ? liveProgress.value
  : nearby.value ? channelProgress(nearby.value)
  : localProgress.value)
</script>

<template>
  <!-- Absent rather than empty when nothing is playing either way: the
       sidebar has no room to spare for a strip that says nothing. -->
  <div v-if="live || nearby || local" class="mp" :class="{ live: !!live, nearby: !!nearby, playing: !!live || !player.paused }">
    <!-- ── a channel in the call ──────────────────────────────────────── -->
    <template v-if="live">
      <button class="mp-open" :aria-label="`Open music — ${liveTitle} in ${live.name}`" @click="emit('open')">
        <span class="mp-art" :class="{ empty: !live.now?.cover }">
          <img v-if="live.now?.cover" :src="live.now.cover" alt="" />
          <Radio v-else :size="13" :stroke-width="2" />
        </span>
        <span class="mp-text">
          <span class="mp-title">{{ liveTitle }}</span>
          <!-- Live, and where: the one thing that tells you this is shared
               rather than yours. -->
          <span class="mp-artist"><span class="mp-pulse" aria-hidden="true" /><span class="mp-where">{{ live.name }}</span></span>
        </span>
      </button>

      <!-- Skipping a shared channel skips it for everyone, so the label
           says so rather than looking like the private next button. -->
      <button
        v-if="live.now" class="mp-btn" :aria-label="`Skip for everyone in ${live.name}`"
        v-tip="'Skip — for everyone listening'" @click="skipMusic(live.id)"
      >
        <SkipForward :size="13" :stroke-width="2.5" />
      </button>
      <button
        class="mp-btn mp-stop" :aria-label="`Leave ${live.name}`"
        v-tip="'Leave channel'" @click="listenToMusic(null)"
      >
        <LogOut :size="13" :stroke-width="2.5" />
      </button>
    </template>

    <!-- ── playing in the call, not for you ───────────────────────────── -->
    <template v-else-if="nearby">
      <button class="mp-open" :aria-label="`Open music — ${nearbyTitle} is playing in ${nearby.name}`" @click="emit('open')">
        <span class="mp-art" :class="{ empty: !nearby.now?.cover }">
          <img v-if="nearby.now?.cover" :src="nearby.now.cover" alt="" />
          <Radio v-else :size="13" :stroke-width="2" />
        </span>
        <span class="mp-text">
          <span class="mp-title">{{ nearbyTitle }}</span>
          <!-- No live dot: you are not hearing this. Where, and how many are. -->
          <span class="mp-artist"><span class="mp-where">Playing in {{ nearby.name }}{{ nearbyWho }}</span></span>
        </span>
      </button>
      <button class="mp-join" :aria-label="`Join ${nearby.name}`" @click="listenToMusic(nearby.id)">Join</button>
    </template>

    <!-- ── your own preview ───────────────────────────────────────────── -->
    <template v-else-if="local">
      <button class="mp-open" :aria-label="`Open music — ${local.title}`" @click="emit('open')">
        <span class="mp-art" :class="{ empty: !local.cover }">
          <img v-if="local.cover" :src="local.cover" alt="" />
          <Music2 v-else :size="13" :stroke-width="2" />
        </span>
        <span class="mp-text">
          <span class="mp-title">{{ local.title }}</span>
          <span class="mp-artist">{{ local.artist || 'Unknown artist' }}</span>
        </span>
      </button>

      <button class="mp-btn" :aria-label="player.paused ? 'Play' : 'Pause'" @click="toggle">
        <component :is="player.paused ? Play : Pause" :size="14" :stroke-width="2.5" />
      </button>
      <button class="mp-btn" aria-label="Next" @click="next">
        <SkipForward :size="13" :stroke-width="2.5" />
      </button>
      <!-- Stops and puts the strip away. It does not touch the queue — it used
           to remove the song from it, so closing this deleted a track from
           the list you were playing. -->
      <button class="mp-btn mp-stop" aria-label="Stop" @click="stop">
        <X :size="13" :stroke-width="2.5" />
      </button>
    </template>

    <!-- A hairline, not a scrubber. Seeking belongs where you can see the
         numbers, and a shared song cannot be sought at all. -->
    <span class="mp-rail" role="presentation">
      <span class="mp-fill" :style="{ transform: `scaleX(${progress / 100})` }" />
    </span>
  </div>
</template>

<style scoped>
.mp {
  position: relative;
  display: flex; align-items: center; gap: 2px;
  margin: 0 8px 6px; padding: 6px 4px 6px 6px;
  background: var(--bg-input); border-radius: var(--edge-md);
}
/* Shared listening gets a hairline ring, so the strip reads as "the room"
   at a glance without taking any more space. */
.mp.live { box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), .35); }

.mp-open {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 8px;
  padding: 0; border: none; background: none; cursor: pointer; text-align: left;
}
.mp-art {
  flex-shrink: 0; width: 28px; height: 28px; border-radius: var(--edge-sm);
  overflow: hidden; background: var(--bg-panel);
  display: grid; place-items: center; color: var(--text-3);
}
.mp.live .mp-art.empty { color: var(--accent-text); }
.mp-art img { width: 100%; height: 100%; object-fit: cover; display: block; }

.mp-text { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.mp-title {
  font-size: 12px; font-weight: 600; color: var(--text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mp-artist {
  display: flex; align-items: center; gap: 5px;
  font-size: 10.5px; color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mp.live .mp-artist { color: var(--accent-text); }
/* Its own box: a flex row will not put an ellipsis on a bare text node, so
   a long channel name ran off the edge instead of ending in "…". */
.mp-where { min-width: 0; overflow: hidden; text-overflow: ellipsis; }

/* The live dot breathes. It is the only motion in the strip, and it is the
   thing that says "this is happening now, with other people". */
.mp-pulse {
  flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent); color: var(--text-on-accent);
  animation: mp-breathe 2.4s var(--ease-out) infinite;
}
@keyframes mp-breathe { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }

/* Join: the one thing to do about music you can see and not hear. */
.mp-join {
  flex-shrink: 0; height: 26px; padding: 0 11px; margin-right: 2px;
  border: none; border-radius: var(--edge-pill); cursor: pointer;
  background: var(--accent); color: var(--text-on-accent);
  font-size: 11.5px; font-weight: 700; font-family: inherit;
  transition: background var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mp-join:hover { background: var(--accent-hover); color: var(--text-on-accent); } }
.mp-join:active { transform: scale(.96); }
/* Not yours yet, so the progress is quieter than a song you hear. */
.mp.nearby .mp-fill { background: var(--text-3); }

.mp-btn {
  flex-shrink: 0;
  display: grid; place-items: center; width: 24px; height: 24px;
  border: none; background: none; cursor: pointer; color: var(--text-2);
  border-radius: var(--edge-sm);
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .mp-btn:hover { background: var(--hover); color: var(--text-1); }
  .mp-stop:hover { color: var(--danger-text); }
}
.mp-btn:active { transform: scale(.94); }

.mp-rail {
  position: absolute; left: 6px; right: 6px; bottom: 2px;
  height: 2px; border-radius: var(--edge-pill);
  background: var(--hover-strong); overflow: hidden;
}
.mp-fill {
  display: block; height: 100%; width: 100%;
  background: var(--accent); color: var(--text-on-accent);
  transform-origin: left center;
  /* Stepped about once a second, so a matching transition makes it glide
     rather than tick. */
  transition: transform 1s linear;
}

/* Touch targets, per DESIGN.md. */
@media (max-width: 768px) {
  .mp-btn { width: 40px; height: 40px; }
  .mp-join { height: 40px; padding: 0 16px; }
  .mp-art { width: 34px; height: 34px; }
}

@media (prefers-reduced-motion: reduce) {
  .mp-btn, .mp-fill, .mp-join { transition: none; }
  .mp-pulse { animation: none; }
}
</style>
