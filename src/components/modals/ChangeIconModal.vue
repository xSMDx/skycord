<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { X, Image } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import { useGifs, gifPreviewUrl } from '@/composables/useGifs'

const emit = defineEmits<{ upload: [dataUrl: string]; chooseGif: []; close: [] }>()

const fileEl = ref<HTMLInputElement | null>(null)
const error  = ref('')

// A few trending GIFs power the 2×2 preview on the "Choose GIF" card.
const { gifs, fetchGifs } = useGifs()
onMounted(() => fetchGifs(''))

const pickFile = () => fileEl.value?.click()
const onFile = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) { error.value = 'Pick an image file'; return }
  if (file.size > 8_000_000)           { error.value = 'Image must be under 8 MB'; return }
  error.value = ''
  const reader = new FileReader()
  reader.onload = () => emit('upload', reader.result as string)
  reader.readAsDataURL(file)
}
</script>

<template>
  <ModalBase width="470px" @close="emit('close')">
    <div class="ci">
      <div class="ci-header">
        <h2 class="ci-title">Change Icon</h2>
        <button class="ci-close" @click="emit('close')" aria-label="Close">
          <X :size="20" :stroke-width="1.5" />
        </button>
      </div>

      <div class="ci-body">
        <!-- Upload Image -->
        <button class="ci-card ci-upload" @click="pickFile">
          <Image :size="34" :stroke-width="1.5" />
          <span class="ci-card-label">Upload Image</span>
        </button>
        <input ref="fileEl" type="file" accept="image/*" class="ci-file" @change="onFile" />

        <!-- Choose GIF -->
        <button class="ci-card ci-gif" @click="emit('chooseGif')">
          <span class="ci-gif-grid">
            <span v-for="i in 4" :key="i" class="ci-gif-cell">
              <img v-if="gifs[i-1]" :src="gifPreviewUrl(gifs[i-1])" alt="" loading="lazy" />
            </span>
          </span>
          <span class="ci-gif-badge">GIF</span>
          <span class="ci-gif-overlay">Choose GIF</span>
        </button>
      </div>

      <p v-if="error" class="ci-error">{{ error }}</p>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
img { display: block; width: 100%; height: 100%; object-fit: cover; }

.ci { display: flex; flex-direction: column; }
.ci-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 0; }
.ci-title  { font-size: 17px; font-weight: 700; color: var(--text-strong); }
.ci-close  {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background .12s, color .12s;
}
.ci-close:hover { background: var(--hover); color: var(--text-strong); }

.ci-body { display: flex; gap: 14px; padding: 18px; }
.ci-card {
  position: relative; flex: 1; aspect-ratio: 1 / .8;
  border-radius: 10px; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  transition: transform .1s, filter .12s;
}
.ci-card:hover { filter: brightness(1.08); }
.ci-card:active { transform: scale(.98); }
.ci-upload { background: #404249; color: var(--text-2); }
.ci-card-label { font-size: 14px; font-weight: 600; }
.ci-file { display: none; }

.ci-gif { background: var(--bg-input); }
.ci-gif-grid { position: absolute; inset: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.ci-gif-cell { overflow: hidden; background: var(--bg-panel); }
.ci-gif-badge {
  position: absolute; left: 8px; bottom: 8px;
  background: rgba(0,0,0,.7); color: var(--text-strong); font-size: 10px; font-weight: 800;
  padding: 2px 6px; border-radius: 4px; letter-spacing: .3px;
}
.ci-gif-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.35); color: var(--text-strong); font-size: 15px; font-weight: 700;
}

.ci-error { padding: 0 18px 16px; font-size: 13px; color: #fa777c; }
</style>
