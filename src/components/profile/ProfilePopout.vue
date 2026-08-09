<script setup lang="ts">
/**
 * The anchored profile popout — your own (from the user panel) and other
 * people's (from a member row). One component for both: the card is identical
 * and only the action rows differ, so splitting it would guarantee drift.
 *
 * Positioned FIXED and measured from the anchor rather than absolutely: both
 * the left sidebar and the members panel have `overflow: hidden`, which clips
 * an absolutely-positioned panel and renders it squashed inside the rail.
 */
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue'
import {
  Pencil, ChevronRight, IdCard, Check,
  MessageCircle, UserPlus, UserMinus, ExternalLink,
} from 'lucide-vue-next'
import ProfileCard from './ProfileCard.vue'
import { useAuth } from '@/composables/useAuth'
import { useApi } from '@/composables/useApi'

const props = withDefaults(defineProps<{
  /** Whose profile. When it matches the signed-in user, the self rows show. */
  userId:  string
  anchor:  HTMLElement | null
  /** Seed from the row that was clicked so the card paints immediately
   *  instead of flashing empty while the fetch lands. */
  seed?:   Record<string, any> | null
  placement?: 'above' | 'left'
}>(), { seed: null, placement: 'above' })

const emit = defineEmits<{
  close: []; editProfile: []; setStatus: []; message: [user: Record<string, any>]
  viewFull: [id: string]; toast: [msg: string]; setPresence: [status: string]
}>()

const { user: authUser } = useAuth()
const { getUserProfile, sendFriendRequest, removeFriend } = useApi()

const isSelf = computed(() => authUser.value?.id === props.userId)

// Start from the seed (or the auth user), then replace with the fetched
// profile. Members lists don't carry banner or custom status, so without the
// fetch the card would be missing exactly the parts this feature added.
const data = ref<Record<string, any> | null>(props.seed)
const relationship = ref<'none' | 'friends' | 'incoming' | 'outgoing' | 'blocked'>('none')
const busy = ref(false)

const view = computed(() => (isSelf.value ? authUser.value : data.value) as Record<string, any> | null)

const load = async () => {
  if (isSelf.value) return
  try {
    const res: any = await getUserProfile(props.userId)
    data.value = res.user
    relationship.value = res.relationship
    await place()               // richer card can be taller
  } catch { /* keep the seed on screen rather than blanking it */ }
}
watch(() => props.userId, () => { data.value = props.seed; void load() })

const panel = ref<HTMLElement | null>(null)
const pos   = ref<{ left: number; top: number } | null>(null)
const GAP = 10, EDGE = 8

const place = async () => {
  await nextTick()
  const a = props.anchor?.getBoundingClientRect()
  const p = panel.value
  if (!a || !p) return
  const w = p.offsetWidth, h = p.offsetHeight
  let left: number, top: number

  if (props.placement === 'left') {
    // Members panel sits on the right edge, so open toward the middle; flip
    // back across the anchor when there isn't room.
    left = a.left - w - GAP
    if (left < EDGE) left = Math.min(a.right + GAP, window.innerWidth - w - EDGE)
    top = a.top
  } else {
    left = a.left
    top  = a.top - h - GAP        // the user panel is pinned to the bottom
    if (top < EDGE) top = Math.min(a.bottom + GAP, window.innerHeight - h - EDGE)
  }
  left = Math.min(Math.max(EDGE, left), window.innerWidth  - w - EDGE)
  top  = Math.min(Math.max(EDGE, top),  window.innerHeight - h - EDGE)
  pos.value = { left, top }
}

const PRESENCE = [
  { id: 'online',    label: 'Online',         color: '#23a55a' },
  { id: 'idle',      label: 'Idle',           color: '#f0b232' },
  { id: 'dnd',       label: 'Do Not Disturb', color: '#f23f43' },
  { id: 'invisible', label: 'Invisible',      color: '#80848e' },
]
const showPresence = ref(false)
const currentPresence = computed(() =>
  PRESENCE.find(p => p.id === view.value?.status) ?? PRESENCE[0])
// Expanding the list changes the panel height, so it must be re-placed or it
// grows off the bottom of the screen.
const togglePresence = async () => { showPresence.value = !showPresence.value; await place() }

const addFriend = async () => {
  if (busy.value) return
  busy.value = true
  try { await sendFriendRequest(props.userId); relationship.value = 'outgoing'; emit('toast', 'Friend request sent') }
  catch (e: any) { emit('toast', e?.message || 'Couldn’t send that request') }
  finally { busy.value = false }
}
const unfriend = async () => {
  if (busy.value) return
  busy.value = true
  try { await removeFriend(props.userId); relationship.value = 'none'; emit('toast', 'Friend removed') }
  catch (e: any) { emit('toast', e?.message || 'Couldn’t remove that friend') }
  finally { busy.value = false }
}
const copyId = () => {
  navigator.clipboard.writeText(props.userId)
    .then(() => emit('toast', 'User ID copied'))
    .catch(() => emit('toast', 'Couldn’t copy the User ID'))
  emit('close')
}

const onDocDown = (e: PointerEvent) => {
  const t = e.target as Node
  if (panel.value?.contains(t)) return
  if (props.anchor?.contains(t)) return   // the anchor's own handler toggles us
  emit('close')
}
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close') }

onMounted(() => {
  void place(); void load()
  document.addEventListener('pointerdown', onDocDown, true)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown, true)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel" class="pp"
      :style="pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { opacity: 0 }"
      role="dialog" :aria-label="isSelf ? 'Your profile' : 'Profile'"
    >
      <ProfileCard
        v-if="view"
        compact
        :status-button="isSelf"
        avatar-opens
        :username="view.username || ''"
        :display-name="view.displayName || view.name"
        :discriminator="view.discriminator"
        :avatar="view.avatar"
        :banner="view.banner"
        :banner-color="view.bannerColor"
        :status="view.status"
        :custom-status="view.customStatus"
        @edit-status="emit('setStatus')"
        @open-profile="isSelf ? emit('editProfile') : emit('viewFull', userId)"
      >
        <template #footer>
          <!-- ── your own ── -->
          <div v-if="isSelf" class="pp-rows">
            <button class="pp-row" @click="emit('editProfile')">
              <Pencil :size="16" :stroke-width="2.25" /><span>Edit profile</span>
            </button>

            <button class="pp-row" @click="togglePresence">
              <span class="pp-dot" :style="{ background: currentPresence.color }" />
              <span>{{ currentPresence.label }}</span>
              <ChevronRight :size="13" :stroke-width="2.25" class="pp-chev" :class="{ open: showPresence }" />
            </button>
            <div v-if="showPresence" class="pp-sub">
              <button
                v-for="p in PRESENCE" :key="p.id" class="pp-row sub"
                @click="emit('setPresence', p.id); showPresence = false"
              >
                <span class="pp-dot" :style="{ background: p.color }" />
                <span>{{ p.label }}</span>
                <Check v-if="p.id === view.status" :size="14" :stroke-width="2.25" class="pp-chev" />
              </button>
            </div>

            <button class="pp-row" @click="copyId">
              <IdCard :size="16" :stroke-width="2.25" /><span>Copy user ID</span>
            </button>
          </div>

          <!-- ── someone else ── -->
          <div v-else class="pp-rows">
            <button class="pp-row" @click="emit('message', view!)">
              <MessageCircle :size="16" :stroke-width="2.25" /><span>Message</span>
            </button>

            <button v-if="relationship === 'none'" class="pp-row" :disabled="busy" @click="addFriend">
              <UserPlus :size="16" :stroke-width="2.25" /><span>Add friend</span>
            </button>
            <button v-else-if="relationship === 'friends'" class="pp-row danger" :disabled="busy" @click="unfriend">
              <UserMinus :size="16" :stroke-width="2.25" /><span>Remove friend</span>
            </button>
            <div v-else-if="relationship === 'outgoing'" class="pp-note">Friend request sent</div>
            <div v-else-if="relationship === 'incoming'" class="pp-note">Wants to be your friend</div>

            <button class="pp-row" @click="emit('viewFull', userId)">
              <ExternalLink :size="16" :stroke-width="2.25" /><span>View full profile</span>
            </button>
            <button class="pp-row" @click="copyId">
              <IdCard :size="16" :stroke-width="2.25" /><span>Copy user ID</span>
            </button>
          </div>
        </template>
      </ProfileCard>
    </div>
  </Teleport>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.pp {
  position: fixed; z-index: 1200; width: 300px;
  border-radius: 10px; overflow: hidden;
  box-shadow: 0 18px 50px rgba(0,0,0,.7);
  animation: pp-in .13s cubic-bezier(.4,0,.2,1);
}
@keyframes pp-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .pp { animation: none; } }

.pp :deep(.pc) { width: 100%; box-shadow: none; border-radius: 0; }

.pp-rows {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,.07);
  display: flex; flex-direction: column; gap: 2px;
}
.pp-row {
  display: flex; align-items: center; gap: 11px; width: 100%; text-align: left;
  padding: 9px 10px; border-radius: 6px; font-size: 14px; color: var(--text-1);
  transition: background .1s;
}
.pp-row:hover:not(:disabled) { background: var(--hover-strong); }
.pp-row:disabled { opacity: .5; cursor: not-allowed; }
.pp-row svg { color: var(--text-2); flex: none; }
.pp-row.sub { padding-left: 18px; font-size: 13.5px; color: var(--text-2); }
.pp-row.danger { color: #f0716f; }
.pp-row.danger svg { color: #f0716f; }
.pp-row.danger:hover:not(:disabled) { background: rgba(237,66,69,.12); }
.pp-dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
.pp-chev { margin-left: auto; color: var(--text-3); transition: transform .14s; }
.pp-chev.open { transform: rotate(90deg); }
.pp-sub { display: flex; flex-direction: column; gap: 2px; }
.pp-note { font-size: 12.5px; color: var(--text-3); padding: 9px 10px; background: var(--hover); border-radius: 6px; }
</style>
