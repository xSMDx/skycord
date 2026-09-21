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
import '@/styles/settingsShared.css'

const { profile, state, retry } = useInstance()
const rows = computed(() => (profile.value ? aboutRows(profile.value) : []))

// A broken icon falls back to the Skycord mark rather than a broken image.
const iconFailed = ref(false)
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
        class="ai-icon" :src="profile.icon" alt="" @error="iconFailed = true"
      >
      <div v-else class="ai-icon ai-mark"><SkycordIcon :size="28" /></div>
      <div class="ai-names">
        <h2 class="ai-name">{{ profile.name }}</h2>
        <p v-if="profile.description" class="ai-desc">{{ profile.description }}</p>
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
.ai-icon { width: 56px; height: 56px; border-radius: 14px; flex: none; object-fit: cover; }
.ai-mark { display: flex; align-items: center; justify-content: center; background: var(--bg-panel); color: var(--accent); }
.ai-names { min-width: 0; }
.ai-name { margin: 0; font-size: 20px; font-weight: 700; color: var(--text-strong); overflow-wrap: anywhere; }
.ai-desc { margin: 4px 0 0; font-size: 14px; color: var(--text-2); line-height: 1.5; }
.ai-link { color: var(--text-link); text-decoration: none; overflow: hidden; text-overflow: ellipsis; }
.ai-link:hover { text-decoration: underline; }
.ai-skel { display: block; width: 40%; height: 14px; border-radius: 4px; background: var(--hover-strong); }
.ai-failed { display: flex; align-items: center; gap: 12px; }
</style>
