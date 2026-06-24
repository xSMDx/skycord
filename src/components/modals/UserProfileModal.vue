<script setup lang="ts">
import { ref, computed } from 'vue'
import { PhX, PhChatDots, PhUserPlus, PhDotsThree, PhArrowRight } from '@phosphor-icons/vue'
import { avatarFor } from '@/composables/useAvatar'
import ModalBase from './ModalBase.vue'

// Accept any user shape — ApiUser, Friend, or Member
const props = defineProps<{
  user: Record<string, any>
}>()
const emit = defineEmits<{ close: []; message: [id: string] }>()

const tab = ref<'activity' | 'friends' | 'servers'>('activity')

// Normalise fields regardless of which user type is passed
const displayName = computed(() =>
  props.user.displayName || props.user.name || props.user.username || 'Unknown'
)
const username = computed(() =>
  props.user.username || props.user.name || 'unknown'
)
const discriminator = computed(() =>
  props.user.discriminator || '0000'
)
const avatar = computed(() => avatarFor(username.value, props.user.avatar))
const status = computed(() => props.user.status || 'offline')
const userId = computed(() => props.user.id || props.user._id || '')

const statusColor: Record<string, string> = {
  online: '#23a55a', idle: '#f0a500', dnd: '#ed4245', offline: '#80848e'
}
const statusLabel: Record<string, string> = {
  online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline'
}

const recentActivity = [
  { id: 1, name: 'Valorant',  img: 'https://api.dicebear.com/7.x/shapes/svg?seed=val&backgroundColor=ed4245', ago: '2h ago' },
  { id: 2, name: 'Minecraft', img: 'https://api.dicebear.com/7.x/shapes/svg?seed=mc&backgroundColor=43b581',  ago: '1d ago' },
  { id: 3, name: 'VS Code',   img: 'https://api.dicebear.com/7.x/shapes/svg?seed=vsc&backgroundColor=5865f2', ago: '2d ago' },
]
</script>

<template>
  <ModalBase width="720px" @close="emit('close')">
    <div class="profile-modal">

      <!-- ── Left panel ──────────────────────────────────────────────── -->
      <div class="profile-left">
        <div class="profile-banner" />
        <button class="close-btn" @click="emit('close')">
          <PhX :size="18" weight="light" />
        </button>

        <div class="profile-avatar-wrap">
          <img :src="avatar" :alt="displayName" class="profile-avatar" />
          <span class="profile-status-dot" :style="{ background: statusColor[status] }" />
        </div>

        <div class="profile-names">
          <h2 class="profile-display">{{ displayName }}</h2>
          <span class="profile-tag">{{ username }}#{{ discriminator }}</span>
        </div>

        <div class="profile-actions">
          <button class="pa-btn primary" @click="emit('message', userId)">
            <PhChatDots :size="16" weight="light" /> Message
          </button>
          <button class="pa-btn icon" title="Add Friend">
            <PhUserPlus :size="16" weight="light" />
          </button>
          <button class="pa-btn icon" title="More">
            <PhDotsThree :size="16" weight="light" />
          </button>
        </div>

        <div class="profile-bio">
          <p>{{ props.user.bio || 'No bio yet.' }}</p>
        </div>

        <div class="profile-meta">
          <div class="meta-label">Member Since</div>
          <div class="meta-value">
            {{ props.user.createdAt
               ? new Date(props.user.createdAt).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
               : 'Unknown' }}
          </div>
        </div>

        <div class="profile-mutual">
          <div class="mutual-row" @click="tab='servers'">
            Mutual Servers — 2 <PhArrowRight :size="13" weight="light" />
          </div>
          <div class="mutual-row" @click="tab='friends'">
            Mutual Friends — 0 <PhArrowRight :size="13" weight="light" />
          </div>
        </div>
      </div>

      <!-- ── Right panel ─────────────────────────────────────────────── -->
      <div class="profile-right">
        <div class="pr-tabs">
          <button class="pr-tab" :class="{ active: tab==='activity' }" @click="tab='activity'">Activity</button>
          <button class="pr-tab" :class="{ active: tab==='friends'  }" @click="tab='friends'">Mutual Friends</button>
          <button class="pr-tab" :class="{ active: tab==='servers'  }" @click="tab='servers'">Mutual Servers</button>
        </div>

        <div class="pr-content">
          <!-- Status card -->
          <div class="status-card">
            <span class="status-dot" :style="{ background: statusColor[status] }" />
            <span class="status-text" :style="{ color: statusColor[status] }">
              {{ statusLabel[status] }}
            </span>
          </div>

          <template v-if="tab === 'activity'">
            <div class="pr-section-label">Recent Activity</div>
            <div class="activity-list">
              <div v-for="a in recentActivity" :key="a.id" class="activity-item">
                <img :src="a.img" :alt="a.name" class="activity-img" />
                <div class="activity-info">
                  <div class="activity-name">{{ a.name }}</div>
                  <div class="activity-ago">{{ a.ago }}</div>
                </div>
                <button class="activity-more"><PhDotsThree :size="16" weight="light" /></button>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="wip-section">
              <div class="wip-icon">🚧</div>
              <p>Coming soon</p>
            </div>
          </template>
        </div>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
img    { display: block; object-fit: cover; }

.profile-modal {
  display: flex; min-height: 500px;
  background: var(--bg-raised); border-radius: 12px; overflow: hidden;
}

/* Left */
.profile-left {
  width: 260px; flex-shrink: 0; background: var(--bg-panel);
  position: relative; padding: 0 20px 20px;
}
.profile-banner {
  height: 80px; margin: 0 -20px;
  background: linear-gradient(135deg, var(--accent) 0%, #eb459e 100%);
}
.close-btn {
  position: absolute; top: 10px; right: 10px;
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.7); background: rgba(0,0,0,.3);
  transition: background .12s, color .12s; z-index: 1;
}
.close-btn:hover { background: rgba(0,0,0,.5); color: white; }

.profile-avatar-wrap {
  position: relative; width: 72px; height: 72px;
  margin-top: -36px; margin-bottom: 10px;
}
.profile-avatar {
  width: 72px; height: 72px; border-radius: 50%;
  border: 4px solid var(--bg-panel);
}
.profile-status-dot {
  position: absolute; bottom: 3px; right: 3px;
  width: 16px; height: 16px; border-radius: 50%; border: 3px solid var(--bg-panel);
}
.profile-names  { margin-bottom: 12px; }
.profile-display { font-size: 18px; font-weight: 800; color: var(--text-strong); }
.profile-tag     { font-size: 13px; color: var(--text-3); }

.profile-actions { display: flex; gap: 8px; margin-bottom: 14px; }
.pa-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 6px;
  font-size: 13px; font-weight: 600; color: white;
  transition: background .12s, transform .1s;
}
.pa-btn:hover { transform: translateY(-1px); }
.pa-btn.primary { background: var(--accent); flex: 1; justify-content: center; }
.pa-btn.primary:hover { background: var(--accent-hover); }
.pa-btn.icon {
  background: rgba(255,255,255,.08);
  width: 34px; height: 34px; padding: 0; justify-content: center; border-radius: 50%;
}
.pa-btn.icon:hover { background: var(--hover-strong); }

.profile-bio { font-size: 13px; color: var(--text-2); line-height: 1.5; margin-bottom: 14px; }
.profile-meta { margin-bottom: 12px; }
.meta-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--text-3); margin-bottom: 3px; }
.meta-value { font-size: 14px; color: var(--text-1); }

.profile-mutual { display: flex; flex-direction: column; gap: 6px; }
.mutual-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 13px; color: var(--text-2); padding: 8px 10px; border-radius: 6px;
  background: rgba(255,255,255,.04); cursor: pointer; transition: background .12s;
}
.mutual-row:hover { background: var(--hover); color: white; }

/* Right */
.profile-right {
  flex: 1; display: flex; flex-direction: column; background: var(--bg-raised); padding: 16px; min-width: 0;
}
.pr-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,.07); margin-bottom: 14px; }
.pr-tab {
  padding: 8px 14px; font-size: 14px; font-weight: 500; color: var(--text-3);
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color .12s, border-color .12s;
}
.pr-tab:hover  { color: var(--text-1); }
.pr-tab.active { color: var(--text-on-accent); border-color: var(--accent); }
.pr-content { flex: 1; overflow-y: auto; }

.status-card {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,.04); border-radius: 8px;
  padding: 10px 14px; margin-bottom: 14px;
}
.status-dot  { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.status-text { font-size: 14px; font-weight: 600; }

.pr-section-label {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; color: var(--text-3); margin-bottom: 10px;
}
.activity-list { display: flex; flex-direction: column; gap: 6px; }
.activity-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,.04);
  cursor: pointer; transition: background .12s;
}
.activity-item:hover { background: var(--hover); }
.activity-img  { width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0; }
.activity-info { flex: 1; }
.activity-name { font-size: 14px; font-weight: 600; color: var(--text-strong); }
.activity-ago  { font-size: 12px; color: var(--text-3); }
.activity-more {
  color: var(--text-3); opacity: 0; width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px; transition: opacity .12s;
}
.activity-item:hover .activity-more { opacity: 1; }
.activity-more:hover { background: var(--hover-strong); color: white; }

.wip-section { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 160px; gap: 10px; color: var(--text-faint); }
.wip-icon { font-size: 36px; }
.wip-section p { font-size: 14px; }

.pr-content::-webkit-scrollbar { width: 4px; }
.pr-content::-webkit-scrollbar-track { background: transparent; }
.pr-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }
</style>