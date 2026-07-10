<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { RemoteTrack, LocalVideoTrack } from 'livekit-client'

const props = withDefaults(defineProps<{
  track: RemoteTrack | LocalVideoTrack
  fit?: 'cover' | 'contain'
}>(), { fit: 'cover' })

const el = ref<HTMLVideoElement | null>(null)

const attach = () => { if (el.value) props.track.attach(el.value) }

onMounted(attach)
onBeforeUnmount(() => { try { props.track.detach() } catch { /* ignore */ } })
// If the track object itself is swapped (e.g. camera restart), rebind.
watch(() => props.track, (next, prev) => {
  try { prev?.detach() } catch { /* ignore */ }
  attach()
})
</script>

<template>
  <!-- muted: audio arrives via separate LiveKit audio tracks, not the video el -->
  <video ref="el" class="vtile" autoplay playsinline muted
         :style="{ objectFit: fit }"></video>
</template>

<style scoped>
.vtile { width: 100%; height: 100%; display: block; background: #000; }
</style>
