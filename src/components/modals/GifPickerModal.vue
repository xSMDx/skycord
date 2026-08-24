<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { Search, X } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import { useGifs, gifPreviewUrl, gifFullUrl } from '@/composables/useGifs'

const emit = defineEmits<{ select: [url: string]; close: [] }>()

const { gifs, loading, error, fetchGifs } = useGifs()
const search = ref('')
let _debounce: ReturnType<typeof setTimeout> | null = null

watch(search, q => {
  if (_debounce) clearTimeout(_debounce)
  _debounce = setTimeout(() => fetchGifs(q), 350)
})

onMounted(() => fetchGifs(''))

const pick = (gif: any) => {
  const url = gifFullUrl(gif)
  if (url) emit('select', url)
}
</script>

<template>
  <ModalBase width="480px" @close="emit('close')">
    <div class="gp">
      <div class="gp-header">
        <h2 class="gp-title">Choose GIF</h2>
        <button class="gp-close" @click="emit('close')" aria-label="Close">
          <X :size="20" :stroke-width="1.5" />
        </button>
      </div>

      <div class="gp-search">
        <Search :size="15" :stroke-width="1.5" />
        <input v-model="search" type="text" placeholder="Search GIFs" autofocus />
      </div>

      <div class="gp-body">
        <div v-if="loading" class="gp-state">Loading…</div>
        <div v-else-if="error" class="gp-state">Couldn't load GIFs. Try again.</div>
        <div v-else-if="gifs.length === 0" class="gp-state">No GIFs found</div>
        <div v-else class="gp-grid">
          <button
            v-for="gif in gifs" :key="gif.id"
            class="gp-cell" @click="pick(gif)"
          >
            <img :src="gifPreviewUrl(gif)" :alt="gif.title || 'GIF'" loading="lazy" />
          </button>
        </div>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
img { display: block; width: 100%; height: 100%; object-fit: cover; }

.gp { display: flex; flex-direction: column; max-height: 80vh; }
.gp-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 0; }
.gp-title  { font-size: 17px; font-weight: 700; color: var(--text-strong); }
.gp-close  {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.gp-close:hover { background: var(--hover); color: var(--text-strong); }

.gp-search {
  display: flex; align-items: center; gap: 8px;
  margin: 14px 18px 0; padding: 9px 12px; border-radius: 8px;
  background: var(--bg-input); border: 1px solid transparent; color: var(--text-3);
  transition: border-color var(--dur-2) var(--ease-out);
}
.gp-search:focus-within { border-color: var(--accent); }
.gp-search input { flex: 1; font-size: 14px; color: var(--text-1); background: none; border: none; outline: none; }
.gp-search input::placeholder { color: var(--text-faint); }

.gp-body { flex: 1; overflow-y: auto; padding: 14px 18px 18px; }
.gp-state { text-align: center; color: var(--text-faint); font-size: 14px; padding: 40px 0; }
.gp-grid { columns: 2; column-gap: 8px; }
.gp-cell {
  display: block; width: 100%; margin-bottom: 8px;
  border-radius: 8px; overflow: hidden; background: var(--bg-input);
  break-inside: avoid; transition: outline var(--dur-1) var(--ease-out);
  outline: 0 solid var(--accent);
}
.gp-cell:hover { outline: 2px solid var(--accent); }
.gp-cell img { width: 100%; height: auto; }
</style>
