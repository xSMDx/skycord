<script setup lang="ts">
/**
 * What is playing, in the sidebar, while you get on with something else.
 *
 * It exists because the music kept going after the modal closed and then
 * nothing on screen said so — no title, no way to pause, no way back. A
 * player that is audible and invisible is worse than one that stops.
 *
 * Deliberately small: art, name, one button, and a hairline of progress.
 * Everything else is a click away in the room, and this sits directly above
 * the voice panel, which is already the busiest corner of the app.
 */
import { computed } from 'vue'
import { Music2, Pause, Play, SkipForward, X } from 'lucide-vue-next'
import { player, toggle, next, stop } from '@/composables/useMusicPlayer'

const emit = defineEmits<{ open: [] }>()

const track = computed(() => player.current)

/** 0–100. Guarded, because duration is NaN until metadata lands. */
const progress = computed(() => {
  const d = player.duration
  return d > 0 ? Math.min(100, (player.at / d) * 100) : 0
})

</script>

<template>
  <!-- Nothing has played this session: the strip is simply absent rather
       than sitting there empty, because the sidebar has no room to spare. -->
  <div v-if="track" class="mp" :class="{ playing: !player.paused }">
    <button class="mp-open" :aria-label="`Open music — ${track.title}`" @click="emit('open')">
      <span class="mp-art" :class="{ empty: !track.cover }">
        <img v-if="track.cover" :src="track.cover" alt="" />
        <Music2 v-else :size="13" :stroke-width="2" />
      </span>
      <span class="mp-text">
        <span class="mp-title">{{ track.title }}</span>
        <span class="mp-artist">{{ track.artist || 'Unknown artist' }}</span>
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

    <!-- A hairline, not a scrubber. Seeking belongs where you can see the
         numbers; this only has to say that time is passing. -->
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
.mp-art img { width: 100%; height: 100%; object-fit: cover; display: block; }

.mp-text { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.mp-title {
  font-size: 12px; font-weight: 600; color: var(--text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mp-artist {
  font-size: 10.5px; color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

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
  /* Stepped by timeupdate roughly four times a second, so a short transition
     smooths it without lagging behind the audio. */
  transition: transform var(--dur-1) linear;
}

/* Touch targets, per DESIGN.md. */
@media (max-width: 768px) {
  .mp-btn { width: 40px; height: 40px; }
  .mp-art { width: 34px; height: 34px; }
}

@media (prefers-reduced-motion: reduce) {
  .mp-btn, .mp-fill { transition: none; }
}
</style>
