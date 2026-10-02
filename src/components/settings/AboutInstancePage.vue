<script setup lang="ts">
/**
 * Settings › About this instance: who runs this server, how to reach them,
 * and what it is running. No host-facing detail — no variable names, paths
 * or setup hints; a member never needs them.
 */
import { computed, ref } from 'vue'
import SkycordIcon from '@/components/SkycordIcon.vue'
import { useInstance } from '@/composables/useInstance'
import { aboutRows } from '@/composables/aboutInstance'
import { createTapCounter, debugUnlocked, setDebugUnlocked } from '@/composables/debugUnlock'
import '@/styles/settingsShared.css'

const { profile, state, retry } = useInstance()
const rows = computed(() => (profile.value ? aboutRows(profile.value) : []))

// A broken icon falls back to the Skycord mark rather than a broken image.
const iconFailed = ref(false)

// Seven taps on the icon show (or hide) Settings › Debug. Confirmed in place:
// an unlock nobody can see having happened is one people repeat forever.
const taps = createTapCounter()
const said = ref('')
let sayTimer: ReturnType<typeof setTimeout> | null = null
const onMarkTap = () => {
  if (!taps.tap()) return
  setDebugUnlocked(!debugUnlocked.value)
  said.value = debugUnlocked.value ? 'Debug page shown in the settings list' : 'Debug page hidden'
  if (sayTimer) clearTimeout(sayTimer)
  sayTimer = setTimeout(() => { said.value = '' }, 4000)
}
</script>

<template>
  <div v-if="state === 'failed'" class="ai-failed" role="alert">
    <p class="st-hint">Couldn't reach the server.</p>
    <button type="button" class="st-btn" @click="retry">Retry</button>
  </div>

  <template v-else-if="profile">
    <div class="ai-head">
      <img
        v-if="profile.icon && !iconFailed"
        class="ai-icon" :src="profile.icon" alt="" @error="iconFailed = true" @click="onMarkTap"
      >
      <div v-else class="ai-icon ai-mark" @click="onMarkTap"><SkycordIcon :size="28" /></div>
      <div class="ai-names">
        <h2 class="ai-name">{{ profile.name }}</h2>
        <p v-if="profile.description" class="ai-desc">{{ profile.description }}</p>
        <p v-if="said" class="ai-said" role="status">{{ said }}</p>
      </div>
    </div>

    <div class="st-card">
      <div v-for="row in rows" :key="row.label" class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">{{ row.label }}</span>
          <span class="st-field-value">
            <a
              v-if="row.href" :href="row.href"
              :target="row.external ? '_blank' : undefined"
              :rel="row.external ? 'noopener noreferrer' : undefined"
              class="ai-link"
            >{{ row.value }}</a>
            <template v-else>{{ row.value }}</template>
          </span>
        </div>
      </div>
    </div>
  </template>

  <!-- Loading: the page's shape, quietly, so nothing jumps when it lands. -->
  <div v-else class="st-card" aria-busy="true">
    <div v-for="n in 2" :key="n" class="st-field"><span class="ai-skel" /></div>
  </div>
</template>

<style scoped>
.ai-head { display: flex; align-items: center; gap: 14px; margin: 4px 0 18px; }
.ai-said { margin: 6px 0 0; color: var(--accent); font-size: 13px; font-weight: 600; }
.ai-icon { width: 56px; height: 56px; border-radius: var(--edge-xl); flex: none; object-fit: cover; }
.ai-mark { display: flex; align-items: center; justify-content: center; background: var(--bg-panel); color: var(--accent); }
.ai-names { min-width: 0; }
.ai-name { margin: 0; font-size: 20px; font-weight: 700; color: var(--text-strong); overflow-wrap: anywhere; }
.ai-desc { margin: 4px 0 0; font-size: 14px; color: var(--text-2); line-height: 1.5; }
.ai-link { color: var(--text-link); text-decoration: none; overflow: hidden; text-overflow: ellipsis; }
.ai-link:hover { text-decoration: underline; }
.ai-skel { display: block; width: 40%; height: 14px; border-radius: var(--edge-sm); background: var(--hover-strong); }
.ai-failed { display: flex; align-items: center; gap: 12px; }
</style>
