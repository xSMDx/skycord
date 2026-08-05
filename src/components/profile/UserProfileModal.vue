<script setup lang="ts">
/**
 * Someone else's profile: the card on the left, mutual friends on the right.
 *
 * Everything comes from one GET /users/:id/profile — the person, your
 * relationship with them, when you became friends, and who you both know.
 * Splitting that across calls would show the card assembling itself in pieces.
 *
 * Clicking a mutual friend re-targets this same modal rather than stacking a
 * second one, so you can walk the graph without a pile of dialogs behind you.
 */
import { ref, watch, computed } from 'vue'
import {
  PhX, PhChatDots, PhUserPlus, PhUserMinus, PhDotsThree, PhIdentificationCard, PhCheck,
} from '@phosphor-icons/vue'
import ModalBase from '@/components/modals/ModalBase.vue'
import ProfileCard from './ProfileCard.vue'
import { useApi } from '@/composables/useApi'
import { avatarFor } from '@/composables/useAvatar'

const props = defineProps<{ userId: string }>()
// Emits the whole user, not just an id: a mutual friend you aren't friends with
// yet won't be in the caller's friends list, so an id alone would leave them
// unable to build the DM entry.
const emit  = defineEmits<{ close: []; message: [user: Record<string, any>]; toast: [msg: string] }>()

const { getUserProfile, sendFriendRequest, removeFriend } = useApi()

type Rel = 'none' | 'friends' | 'incoming' | 'outgoing' | 'blocked'
const user         = ref<Record<string, any> | null>(null)
const relationship = ref<Rel>('none')
const friendsSince = ref<string | null>(null)
const mutuals      = ref<any[]>([])
const loading      = ref(true)
const error        = ref('')

// Which profile is on screen. Starts at the prop and moves when you click a
// mutual friend; the prop stays the entry point.
const currentId = ref(props.userId)
watch(() => props.userId, id => { currentId.value = id })

const load = async (id: string) => {
  loading.value = true; error.value = ''
  try {
    const res: any = await getUserProfile(id)
    user.value         = res.user
    relationship.value = res.relationship
    friendsSince.value = res.friendsSince
    mutuals.value      = res.mutualFriends || []
  } catch (e: any) {
    error.value = e?.message || 'Couldn’t load that profile'
  } finally { loading.value = false }
}
watch(currentId, id => { tab.value = 'mutuals'; moreOpen.value = false; void load(id) }, { immediate: true })

const tab      = ref<'mutuals'>('mutuals')
const moreOpen = ref(false)
const friendOpen = ref(false)

const name = computed(() => user.value?.displayName || user.value?.username || 'Unknown')
const fmt = (d: string | null) => {
  if (!d) return null
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? null
    : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const busy = ref(false)
const addFriend = async () => {
  if (busy.value || !user.value) return
  busy.value = true
  try { await sendFriendRequest(user.value.id); relationship.value = 'outgoing'; emit('toast', 'Friend request sent') }
  catch (e: any) { emit('toast', e?.message || 'Couldn’t send that request') }
  finally { busy.value = false }
}
const unfriend = async () => {
  if (busy.value || !user.value) return
  busy.value = true; friendOpen.value = false
  try {
    await removeFriend(user.value.id)
    relationship.value = 'none'; friendsSince.value = null
    emit('toast', 'Friend removed')
  } catch (e: any) { emit('toast', e?.message || 'Couldn’t remove that friend') }
  finally { busy.value = false }
}
const copyId = () => {
  moreOpen.value = false
  navigator.clipboard.writeText(user.value?.id || '')
    .then(() => emit('toast', 'User ID copied'))
    .catch(() => emit('toast', 'Couldn’t copy the User ID'))
}

const STATUS_COLORS: Record<string, string> = {
  online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', offline: '#80848e', invisible: '#80848e',
}
</script>

<template>
  <ModalBase width="940px" @close="emit('close')">
    <div class="up">
      <button class="up-close" aria-label="Close" @click="emit('close')"><PhX :size="18" weight="bold" /></button>

      <div v-if="loading" class="up-state">Loading…</div>
      <div v-else-if="error" class="up-state err">{{ error }}</div>

      <div v-else-if="user" class="up-cols">
        <!-- left: the card -->
        <div class="up-left">
          <ProfileCard
            compact
            :username="user.username"
            :display-name="user.displayName"
            :discriminator="user.discriminator"
            :avatar="user.avatar"
            :banner="user.banner"
            :banner-color="user.bannerColor"
            :status="user.status"
            :custom-status="user.customStatus"
          >
            <template #footer>
              <div class="up-actions">
                <button class="up-btn primary" @click="emit('message', user)">
                  <PhChatDots :size="16" weight="fill" /> Message
                </button>

                <div class="up-anchor">
                  <button
                    class="up-btn icon" :title="relationship === 'friends' ? 'Friend options' : 'Add friend'"
                    :disabled="busy"
                    @click="relationship === 'friends' ? (friendOpen = !friendOpen, moreOpen = false) : addFriend()"
                  >
                    <PhUserPlus v-if="relationship !== 'friends'" :size="16" weight="bold" />
                    <PhCheck v-else :size="16" weight="bold" />
                  </button>
                  <div v-if="friendOpen" class="up-menu" @click.stop>
                    <button class="danger" @click="unfriend">Remove friend</button>
                  </div>
                </div>

                <div class="up-anchor">
                  <button class="up-btn icon" title="More" @click="moreOpen = !moreOpen; friendOpen = false">
                    <PhDotsThree :size="18" weight="bold" />
                  </button>
                  <div v-if="moreOpen" class="up-menu" @click.stop>
                    <button @click="copyId">
                      <PhIdentificationCard :size="15" weight="bold" /> Copy user ID
                    </button>
                    <button v-if="relationship === 'friends'" class="danger" @click="unfriend">
                      <PhUserMinus :size="15" weight="bold" /> Remove friend
                    </button>
                  </div>
                </div>
              </div>

              <p v-if="user.bio" class="up-bio">{{ user.bio }}</p>

              <div class="up-meta">
                <template v-if="fmt(user.createdAt)">
                  <div class="up-meta-l">Member since</div>
                  <div class="up-meta-v">{{ fmt(user.createdAt) }}</div>
                </template>
                <template v-if="fmt(friendsSince)">
                  <div class="up-meta-l">Friends since</div>
                  <div class="up-meta-v">{{ fmt(friendsSince) }}</div>
                </template>
                <div v-if="relationship === 'outgoing'" class="up-pending">Friend request sent</div>
                <div v-else-if="relationship === 'incoming'" class="up-pending">Wants to be your friend</div>
              </div>
            </template>
          </ProfileCard>
        </div>

        <!-- right: mutual friends -->
        <div class="up-right">
          <div class="up-tabs" role="tablist">
            <button class="up-tab" role="tab" :aria-selected="tab === 'mutuals'" @click="tab = 'mutuals'">
              {{ mutuals.length }} Mutual {{ mutuals.length === 1 ? 'Friend' : 'Friends' }}
            </button>
          </div>

          <div v-if="!mutuals.length" class="up-empty">
            <p>No mutual friends yet</p>
            <span>People you both know will show up here.</span>
          </div>

          <div v-else class="up-mutuals">
            <button
              v-for="m in mutuals" :key="m.id" class="up-mutual"
              @click="currentId = m.id"
            >
              <span class="up-mav">
                <img :src="avatarFor(m.username, m.avatar)" :alt="m.displayName || m.username" />
                <span class="up-mdot" :style="{ background: STATUS_COLORS[m.status] || STATUS_COLORS.offline }" />
              </span>
              <span class="up-minfo">
                <span class="up-mname">{{ m.displayName || m.username }}</span>
                <span v-if="m.customStatus?.text" class="up-mstatus">{{ m.customStatus.text }}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
img { display: block; object-fit: cover; }

.up { position: relative; background: var(--bg-raised); border-radius: 12px; overflow: hidden; }
.up-close {
  position: absolute; top: 14px; right: 14px; z-index: 5;
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-2); background: rgba(0,0,0,.35);
}
.up-close:hover { color: var(--text-strong); background: rgba(0,0,0,.6); }

.up-state { padding: 60px 24px; text-align: center; color: var(--text-3); font-size: 14px; }
.up-state.err { color: #f0716f; }

.up-cols { display: flex; gap: 0; min-height: 480px; }
.up-left { width: 380px; flex: none; padding: 18px; }
.up-left :deep(.pc) { width: 100%; box-shadow: none; }
.up-right {
  flex: 1; min-width: 0; padding: 22px 22px 22px 4px;
  display: flex; flex-direction: column;
}

.up-actions { display: flex; gap: 8px; margin-top: 14px; }
.up-anchor { position: relative; }
.up-btn {
  display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 9px 16px; border-radius: 6px; font-size: 14px; font-weight: 600;
  background: var(--hover-strong); color: var(--text-strong); transition: background .12s;
}
.up-btn:hover:not(:disabled) { background: rgba(255,255,255,.16); }
.up-btn:disabled { opacity: .5; cursor: not-allowed; }
.up-btn.primary { background: var(--accent); flex: 1; }
.up-btn.primary:hover { background: var(--accent-hover); }
.up-btn.icon { width: 38px; padding: 0; height: 38px; }

.up-menu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 20;
  min-width: 190px; background: var(--bg-floor); border-radius: 6px; padding: 6px;
  box-shadow: 0 12px 34px rgba(0,0,0,.6);
}
.up-menu button {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
  padding: 9px 10px; border-radius: 4px; font-size: 14px; color: var(--text-2);
}
.up-menu button:hover { background: var(--accent); color: #fff; }
.up-menu button.danger { color: #f0716f; }
.up-menu button.danger:hover { background: #ed4245; color: #fff; }

.up-bio { font-size: 13.5px; color: var(--text-2); line-height: 1.5; margin-top: 16px; white-space: pre-wrap; word-break: break-word; }
.up-meta { margin-top: 16px; }
.up-meta-l {
  font-size: 11.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; color: var(--text-3); margin-top: 12px; margin-bottom: 3px;
}
.up-meta-v { font-size: 13.5px; color: var(--text-1); }
.up-pending {
  margin-top: 14px; font-size: 12.5px; color: var(--text-3);
  background: var(--hover); border-radius: 6px; padding: 8px 10px;
}

.up-tabs { display: flex; gap: 18px; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
.up-tab {
  padding: 0 0 10px; font-size: 14px; font-weight: 600; color: var(--text-strong);
  border-bottom: 2px solid var(--accent); margin-bottom: -1px;
}

.up-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; flex: 1; color: var(--text-3); }
.up-empty p { font-size: 15px; color: var(--text-2); }
.up-empty span { font-size: 13px; }

.up-mutuals { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.up-mutual {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  padding: 8px 10px; border-radius: 6px; transition: background .1s;
}
.up-mutual:hover { background: var(--hover-strong); }
.up-mav { position: relative; width: 34px; height: 34px; flex: none; }
.up-mav img { width: 34px; height: 34px; border-radius: 50%; }
.up-mdot {
  position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px;
  border-radius: 50%; border: 3px solid var(--bg-raised);
}
.up-minfo { min-width: 0; display: flex; flex-direction: column; }
.up-mname { font-size: 14.5px; font-weight: 600; color: var(--text-1); }
.up-mstatus { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.up-mutuals::-webkit-scrollbar { width: 4px; }
.up-mutuals::-webkit-scrollbar-track { background: transparent; }
.up-mutuals::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }

@media (max-width: 820px) {
  .up-cols { flex-direction: column; }
  .up-left { width: auto; }
  .up-right { padding: 0 18px 18px; }
}
</style>
