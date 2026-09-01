<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { Search, X } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import { useGifs, gifPreviewUrl, gifFullUrl, GIF_SETUP_DOC } from '@/composables/useGifs'

const emit = defineEmits<{ select: [url: string]; close: [] }>()

const { gifs, loading, error, notConfigured, fetchGifs } = useGifs()
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
        <Search :size="16" :stroke-width="1.5" />
        <input v-model="search" type="text" placeholder="Search GIFs" autofocus />
      </div>

      <div class="gp-body">
        <div v-if="loading" class="gp-state">Loading…</div>
        <!-- Not an error, and deliberately not "try again": this instance has
             no GIF provider key, which stays true until someone sets one. Names
             the variable so a self-hoster can act on it instead of guessing. -->
        <div v-else-if="notConfigured" class="gp-state gp-unset">
          <div class="gp-unset-face">😴</div>
          <p class="gp-unset-shout">Ooooooh, your admin is LAAAAAZY — they didn’t set up GIFs</p>
          <!-- A real anchor, not a click handler on a div: it has to be
               keyboard-reachable and middle-clickable like any other link. -->
          <a class="gp-unset-link" :href="GIF_SETUP_DOC" target="_blank" rel="noopener">
            If you’re the admin, click me to set it up
          </a>
        </div>
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
  margin: 14px 18px 0; padding: 8px 12px; border-radius: 8px;
  background: var(--bg-input); border: 1px solid transparent; color: var(--text-3);
  transition: border-color var(--dur-2) var(--ease-out);
}
.gp-search:focus-within { border-color: var(--accent); }
.gp-search input { flex: 1; font-size: 14px; color: var(--text-1); background: none; border: none; outline: none; }
.gp-search input::placeholder { color: var(--text-faint); }

.gp-body { flex: 1; overflow-y: auto; padding: 14px 18px 18px; }
.gp-state { text-align: center; color: var(--text-faint); font-size: 14px; padding: 40px 0; }
/* The not-configured state carries a joke and a call to action, so it gets room
   rather than the single centred line the other states use. */
.gp-unset { display: flex; flex-direction: column; gap: 10px; align-items: center; padding: 30px 12px; }
.gp-unset-face  { font-size: 34px; line-height: 1; }
.gp-unset-shout {
  max-width: 30ch; line-height: 1.45;
  font-size: 15px; font-weight: 700; color: var(--text-2);
  /* Not text-transform: the shouting is written into the string, so a screen
     reader hears it the way it is meant rather than spelling out capitals. */
}
.gp-unset-link {
  max-width: 34ch; font-size: 13px; line-height: 1.5;
  color: var(--accent);
  border-bottom: 1px solid rgba(var(--accent-rgb), .45);
  transition: color var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
.gp-unset-link:hover { color: var(--accent-hover); border-bottom-color: var(--accent-hover); }
.gp-grid { columns: 2; column-gap: 8px; }
.gp-cell {
  display: block; width: 100%; margin-bottom: 8px;
  border-radius: 8px; overflow: hidden; background: var(--bg-input);
  break-inside: avoid; transition: outline var(--dur-1) var(--ease-out);
  outline: 0 solid var(--accent);
}
.gp-cell:hover { outline: 2px solid var(--accent); }
.gp-cell img { width: 100%; height: auto; }

/* Same teleport + scoping trap as EmojiPickerModal — see the note there. */
@media (max-width: 768px) {
  .gp-search { min-height: 44px; }
  /* Under 16px, iOS zooms the page on focus and does not zoom back. */
  .gp-search input { font-size: 16px; }
  .gp-cell:hover { outline: none; }
  .gp-cell:active { outline: 2px solid var(--accent); }
}
</style>
