<script setup lang="ts">
import { ref, watch } from 'vue'
import { X, Search, UserPlus, Check } from 'lucide-vue-next'
import { useApi, type ApiUser } from '@/composables/useApi'
import ModalBase from './ModalBase.vue'
import { avatarFor } from '@/composables/useAvatar'

const emit = defineEmits<{ close: [] }>()
const { searchUsers, sendFriendRequest } = useApi()

const query    = ref('')
const results  = ref<ApiUser[]>([])
const loading  = ref(false)
const sentIds  = ref<Set<string>>(new Set())
const errMsg   = ref('')
let   searchTimer: ReturnType<typeof setTimeout> | null = null

// Debounced search
watch(query, (q) => {
  errMsg.value = ''
  results.value = []
  if (searchTimer) clearTimeout(searchTimer)
  if (q.trim().length < 2) return
  searchTimer = setTimeout(async () => {
    loading.value = true
    try {
      const data = await searchUsers(q.trim())
      results.value = data.users
    } catch { errMsg.value = 'Search failed' }
    finally { loading.value = false }
  }, 350)
})

const send = async (user: ApiUser) => {
  try {
    await sendFriendRequest(user.id)
    sentIds.value = new Set([...sentIds.value, user.id])
  } catch (e: any) {
    errMsg.value = e?.message || 'Could not send request'
  }
}

const avatarUrl = (u: ApiUser) => avatarFor(u.username, u.avatar)

const statusColor: Record<string, string> = {
  online: '#23a55a', idle: '#f0a500', dnd: '#ed4245', offline: '#80848e'
}
</script>

<template>
  <ModalBase width="min(520px, 95vw)" @close="emit('close')">
    <div class="af-modal">
        <!-- Header -->
        <div class="af-header">
          <div>
            <h2 class="af-title">Add Friend</h2>
            <p class="af-sub">Search by username to send a friend request.</p>
          </div>
          <button class="af-close" aria-label="Close" @click="emit('close')">
            <X :size="20" :stroke-width="1.5" />
          </button>
        </div>

        <!-- Search bar -->
        <div class="af-search-wrap">
          <div class="af-search" :class="{ focused: query.length > 0 }">
            <Search :size="16" :stroke-width="1.5" class="af-search-icon" />
            <input
              v-model="query"
              type="text"
              placeholder="You can add friends with their username"
              autofocus
            />
            <div v-if="loading" class="af-spinner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            </div>
          </div>
          <p v-if="errMsg" class="af-err">{{ errMsg }}</p>
        </div>

        <!-- Results -->
        <div class="af-results" v-if="results.length > 0 || (query.length >= 2 && !loading)">
          <template v-if="results.length > 0">
            <div v-for="u in results" :key="u.id" class="af-user">
              <div class="af-user-av">
                <Avatar :src="avatarUrl(u)" :alt="u.displayName" :crop="(u as any).avatarCrop" />
                <span class="af-user-dot" :style="{ background: statusColor[u.status] || '#80848e' }" />
              </div>
              <div class="af-user-info">
                <span class="af-user-name">{{ u.displayName }}</span>
                <span class="af-user-tag">{{ u.username }}#{{ u.discriminator }}</span>
              </div>
              <button
                class="af-send-btn"
                :class="{ sent: sentIds.has(u.id) }"
                @click="send(u)"
                :disabled="sentIds.has(u.id)"
              >
                <Check v-if="sentIds.has(u.id)" :size="16" :stroke-width="2.25" />
                <UserPlus v-else :size="16" :stroke-width="1.5" />
                {{ sentIds.has(u.id) ? 'Sent' : 'Add Friend' }}
              </button>
            </div>
          </template>
          <div v-else class="af-empty">
            <div class="af-empty-icon">🔍</div>
            <p>No users found for <strong>{{ query }}</strong></p>
            <span>Check the username and try again.</span>
          </div>
        </div>

        <!-- Hint -->
        <div v-else class="af-hint">
          <span class="af-hint-tip">PROTIP:</span>
          Skycord usernames are case-sensitive. Try their exact username.
        </div>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
input  { background: none; border: none; outline: none; color: inherit; font: inherit; }
img    { display: block; width: 100%; height: 100%; object-fit: cover; }

/* ModalBase owns the overlay, the box chrome and the phone sheet. What's
   left here is only the content inside it. */
.af-modal { overflow: hidden; }

.af-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 20px 20px 0;
}
.af-title { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.af-sub   { font-size: 13px; color: var(--text-3); margin-top: 4px; }
.af-close {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.af-close:hover { background: var(--hover); color: var(--text-strong); }

.af-search-wrap { padding: 16px 20px 0; }
.af-search {
  display: flex; align-items: center; gap: 10px;
  background: var(--bg-raised); border: 1.5px solid rgba(255,255,255,.08);
  border-radius: 8px; padding: 10px 14px;
  transition: border-color var(--dur-2) var(--ease-out);
}
.af-search:focus-within { border-color: var(--accent); }
.af-search-icon { color: var(--text-faint); flex-shrink: 0; }
.af-search input { flex: 1; font-size: 15px; color: var(--text-strong); }
.af-search input::placeholder { color: var(--text-faint); }
.af-spinner { flex-shrink: 0; }
.spin { animation: rot .7s linear infinite; }
@keyframes rot { to{transform:rotate(360deg)} }
.af-err { font-size: 12px; color: #f08080; margin-top: 6px; padding-left: 2px; }

.af-results {
  max-height: 320px; overflow-y: auto;
  padding: 8px 8px; margin-top: 8px;
}
.af-user {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 8px; cursor: default;
  transition: background var(--dur-1) var(--ease-out);
}
.af-user:hover { background: var(--hover); }
.af-user-av { position: relative; width: 38px; height: 38px; flex-shrink: 0; }
.af-user-av img { border-radius: 50%; }
.af-user-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--bg-panel);
}
.af-user-info { flex: 1; min-width: 0; }
.af-user-name { display: block; font-size: 15px; font-weight: 600; color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-user-tag  { display: block; font-size: 12px; color: var(--text-3); }

.af-send-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 6px;
  font-size: 13px; font-weight: 600; color: var(--text-on-accent);
  background: var(--accent); white-space: nowrap; flex-shrink: 0;
  transition: background var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.af-send-btn:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
.af-send-btn.sent { background: rgba(35,165,90,.2); color: #23a55a; cursor: default; }

.af-empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 28px 20px; gap: 8px; text-align: center;
}
.af-empty-icon { font-size: 36px; }
.af-empty p    { font-size: 15px; font-weight: 600; color: var(--text-strong); }
.af-empty p strong { color: var(--accent); }
.af-empty span { font-size: 13px; color: var(--text-3); }

.af-hint {
  padding: 16px 20px 20px; font-size: 13px; color: var(--text-3); line-height: 1.5;
}
.af-hint-tip { color: var(--accent); font-weight: 700; }

.af-results::-webkit-scrollbar { width: 4px; }
.af-results::-webkit-scrollbar-track { background: transparent; }
.af-results::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }
</style>