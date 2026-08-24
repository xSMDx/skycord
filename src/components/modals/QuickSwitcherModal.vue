<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { Search, MessageCircle, UsersRound } from 'lucide-vue-next'
import { useApi, type ApiUser } from '@/composables/useApi'
import { avatarFor } from '@/composables/useAvatar'
import ModalBase from './ModalBase.vue'
import type { DM, Group } from '@/types'

const props = defineProps<{ dms: DM[]; groups?: Group[] }>()
const emit  = defineEmits<{ close: []; openDM: [dm: DM]; openGroup: [g: Group] }>()

const groupLabel = (g: Group) => g.name ?? g.members.map(m => m.displayName || m.username).slice(0, 3).join(', ')
const filteredGroups = computed(() => {
  const gs = props.groups || []
  const q = query.value.toLowerCase()
  return q.length === 0 ? gs : gs.filter(g => groupLabel(g).toLowerCase().includes(q))
})

const { searchUsers } = useApi()
const query   = ref('')
const results = ref<ApiUser[]>([])
const loading = ref(false)
let   timer: ReturnType<typeof setTimeout> | null = null

// Filter existing DMs instantly
const filteredDMs = computed(() =>
  query.value.length === 0
    ? props.dms
    : props.dms.filter(d =>
        d.name.toLowerCase().includes(query.value.toLowerCase())
      )
)

watch(query, (q) => {
  results.value = []
  if (timer) clearTimeout(timer)
  if (q.trim().length < 2) return
  timer = setTimeout(async () => {
    loading.value = true
    try { results.value = (await searchUsers(q)).users }
    catch { /* silent */ }
    finally { loading.value = false }
  }, 300)
})

const avatarUrl = (u: ApiUser) => avatarFor(u.username, u.avatar)

const statusColor: Record<string, string> = {
  online: 'var(--state-live)', idle: '#f0a500', dnd: 'var(--state-fault)', offline: '#80848e'
}

const selectUser = (u: ApiUser) => {
  // Find or build a DM object
  const existing = props.dms.find(d => d.id === u.id)
  const dm: DM = existing || {
    id: u.id, name: u.displayName || u.username,
    avatar: avatarUrl(u), status: u.status as any, lastMsg: ''
  }
  emit('openDM', dm)
  emit('close')
}
</script>

<template>
  <ModalBase width="min(520px, 95vw)" align="top" @close="emit('close')">
    <div class="qs-modal">
        <!-- Search input -->
        <div class="qs-search">
          <Search :size="16" :stroke-width="1.5" class="qs-icon" />
          <input
            v-model="query"
            type="text"
            placeholder="Where would you like to go?"
            autofocus
            @keydown.esc="emit('close')"
          />
          <div v-if="loading" class="qs-spin">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          </div>
        </div>

        <div class="qs-results">
          <!-- Existing DMs section -->
          <template v-if="filteredDMs.length > 0 && query.length < 2">
            <div class="qs-section-label">Direct Messages</div>
            <div
              v-for="dm in filteredDMs.slice(0, 6)" :key="dm.id"
              class="qs-item"
              @click="emit('openDM', dm); emit('close')"
            >
              <div class="qs-av">
                <Avatar :src="dm.avatar" :alt="dm.name" :crop="(dm as any).avatarCrop" />
                <span class="qs-dot" :style="{ background: statusColor[dm.status] || '#80848e' }" />
              </div>
              <div class="qs-info">
                <span class="qs-name">{{ dm.name }}</span>
                <span class="qs-sub">{{ dm.lastMsg }}</span>
              </div>
              <MessageCircle :size="16" :stroke-width="1.5" class="qs-arrow" />
            </div>
          </template>

          <!-- Group DMs section (includes hidden ones — reopening restores them) -->
          <template v-if="filteredGroups.length > 0">
            <div class="qs-section-label">Group DMs</div>
            <div
              v-for="g in filteredGroups.slice(0, 6)" :key="g.id"
              class="qs-item"
              @click="emit('openGroup', g); emit('close')"
            >
              <div class="qs-av qs-av-group">
                <Avatar v-if="g.avatar" :src="g.avatar" :alt="groupLabel(g)" />
                <UsersRound v-else :size="16" :stroke-width="2.25" />
              </div>
              <div class="qs-info">
                <span class="qs-name">{{ groupLabel(g) }}</span>
                <span class="qs-sub">{{ g.memberCount }} Members</span>
              </div>
              <MessageCircle :size="16" :stroke-width="1.5" class="qs-arrow" />
            </div>
          </template>

          <!-- Search results -->
          <template v-if="results.length > 0">
            <div class="qs-section-label">People</div>
            <div
              v-for="u in results" :key="u.id"
              class="qs-item"
              @click="selectUser(u)"
            >
              <div class="qs-av">
                <Avatar :src="avatarUrl(u)" :alt="u.displayName" :crop="(u as any).avatarCrop" />
                <span class="qs-dot" :style="{ background: statusColor[u.status] || '#80848e' }" />
              </div>
              <div class="qs-info">
                <span class="qs-name">{{ u.displayName }}</span>
                <span class="qs-sub">{{ u.username }}#{{ u.discriminator }}</span>
              </div>
              <MessageCircle :size="16" :stroke-width="1.5" class="qs-arrow" />
            </div>
          </template>

          <!-- Hint -->
          <div class="qs-tip">
            <span class="qs-tip-label">PROTIP:</span>
            Search by username to find any user on Skycord.
          </div>
        </div>
    </div>
  </ModalBase>
</template>

<style scoped>
.qs-modal { overflow: hidden; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
input  { background: none; border: none; outline: none; color: inherit; font: inherit; }
img    { display: block; width: 100%; height: 100%; object-fit: cover; }
@keyframes fade { from{opacity:0} to{opacity:1} }
@keyframes drop { from{transform:translateY(-12px);opacity:0} to{transform:translateY(0);opacity:1} }

.qs-search {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,.06);
}
.qs-icon { color: var(--text-faint); flex-shrink: 0; }
.qs-search input { flex: 1; font-size: 16px; color: var(--text-strong); }
.qs-search input::placeholder { color: var(--text-faint); }
.qs-spin { flex-shrink: 0; }
.spin { animation: rot .7s linear infinite; }
@keyframes rot { to{transform:rotate(360deg)} }

.qs-results { padding: 8px 0 4px; max-height: 320px; overflow-y: auto; }
.qs-section-label {
  font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase;
  color: var(--text-3); padding: 6px 16px 4px;
}
.qs-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 16px; cursor: pointer;
  transition: background .08s;
}
.qs-item:hover { background: var(--hover); }
.qs-item:hover .qs-arrow { opacity: 1; }
.qs-av { position: relative; width: 32px; height: 32px; flex-shrink: 0; }
.qs-av img { border-radius: 50%; width: 100%; height: 100%; object-fit: cover; }
.qs-av-group { border-radius: 50%; overflow: hidden; background: linear-gradient(135deg,var(--accent),#7b68ee); display: flex; align-items: center; justify-content: center; color: var(--text-on-accent); }
.qs-dot { position: absolute; bottom: -1px; right: -1px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--bg-chat); }
.qs-info { flex: 1; min-width: 0; }
.qs-name { display: block; font-size: 14px; font-weight: 600; color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qs-sub  { display: block; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qs-arrow { color: var(--text-faint); opacity: 0; transition: opacity .1s; flex-shrink: 0; }

.qs-tip { padding: 10px 16px 12px; font-size: 12px; color: var(--text-faint); }
.qs-tip-label { color: var(--accent); font-weight: 700; }

.qs-results::-webkit-scrollbar { width: 4px; }
.qs-results::-webkit-scrollbar-track { background: transparent; }
.qs-results::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }
</style>