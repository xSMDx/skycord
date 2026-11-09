<script setup lang="ts">
/**
 * A GIF inside a message — from the picker, a KLIPY link in the text, or an
 * uploaded .gif — with a small "GIF" chip so it reads as one at a glance.
 *
 * It plays. A GIF is the content of the message, not decoration, so the
 * avatar rule (still until hovered) is not the default here. But it honours
 * the two settings that ask for stillness: reduced motion, and Performance ›
 * tap to play. Then it shows its first frame and plays while hovered, or for
 * a few seconds after a tap. KLIPY serves its files with open CORS, so the
 * frame can be read; a host that does not allow it plays as before, because
 * showing nothing would be worse than motion the reader can scroll past.
 */
import { computed, ref, watch, onMounted } from 'vue'
import { Play } from 'lucide-vue-next'
import { motionAllowed, tapOnly, hasHover, freezeFrame, useTapToPlay } from '@/composables/useGifPlayback'

const props = withDefaults(defineProps<{ src: string; alt?: string }>(), { alt: 'GIF' })

const still = computed(() => !motionAllowed || tapOnly.value)
const poster = ref<string | null>(null)
const hovering = ref(false)
const { played, play } = useTapToPlay()

const loadPoster = async () => { poster.value = still.value ? await freezeFrame(props.src) : null }
onMounted(loadPoster)
watch(() => [props.src, still.value], loadPoster)

const playing = computed(() => !still.value || !poster.value || hovering.value || played.value)
const shown = computed(() => (playing.value ? props.src : poster.value!))
</script>

<template>
  <span class="gif" :class="{ paused: !playing }"
    @mouseenter="hasHover && (hovering = true)" @mouseleave="hovering = false"
    @click="still && !hasHover && play()">
    <img :src="shown" :alt="alt" loading="lazy" draggable="false" />
    <span v-if="!playing" class="play" aria-hidden="true"><Play :size="18" :stroke-width="2" /></span>
    <span class="chip" aria-hidden="true">GIF</span>
  </span>
</template>

<style scoped>
.gif {
  position: relative; display: inline-block; max-width: 100%;
  border-radius: var(--edge-lg); overflow: hidden; background: var(--bg-input);
  line-height: 0; vertical-align: top;
}
.gif img { display: block; max-width: 320px; max-height: 240px; width: auto; height: auto; }
.paused { cursor: pointer; }
.play {
  position: absolute; inset: 0; margin: auto; width: 40px; height: 40px; border-radius: 50%;
  display: grid; place-items: center; background: var(--media-veil-strong); color: var(--on-media);
}
.play svg { margin-left: 2px; fill: currentColor; }
.chip {
  position: absolute; left: 8px; bottom: 8px; padding: 2px 6px; border-radius: var(--edge-sm);
  background: var(--media-veil); color: var(--on-media);
  font-size: 11px; font-weight: 700; letter-spacing: .04em; line-height: 1.4;
}
@media (max-width: 768px) {
  .gif img { max-width: min(240px, 100%); max-height: 200px; }
}
</style>
