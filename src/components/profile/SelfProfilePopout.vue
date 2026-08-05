<script setup lang="ts">
/**
 * Your own profile popout — opens from the name in the bottom-left user panel.
 *
 * Positioned FIXED and measured from the anchor rather than absolutely, because
 * the left sidebar has `overflow: hidden`; an absolutely-positioned panel gets
 * clipped by it and renders squashed inside the user panel.
 */
import { ref, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { PhPencilSimple, PhCaretRight, PhIdentificationCard, PhCheck } from '@phosphor-icons/vue'
import ProfileCard from './ProfileCard.vue'
import type { PublicUser } from '@/composables/useAuth'

const props = defineProps<{ user: PublicUser; anchor: HTMLElement | null }>()
const emit = defineEmits<{
  close: []; editProfile: []; setStatus: []; copyId: []
  setPresence: [status: string]
}>()

const panel = ref<HTMLElement | null>(null)
const pos   = ref<{ left: number; top: number } | null>(null)
const GAP = 10, EDGE = 8

const place = async () => {
  await nextTick()
  const a = props.anchor?.getBoundingClientRect()
  const p = panel.value
  if (!a || !p) return
  const w = p.offsetWidth, h = p.offsetHeight
  let left = a.left
  let top  = a.top - h - GAP           // opens upward; the panel is pinned to the bottom
  if (top < EDGE) top = Math.min(a.bottom + GAP, window.innerHeight - h - EDGE)
  left = Math.min(Math.max(EDGE, left), window.innerWidth - w - EDGE)
  pos.value = { left, top }
}

const PRESENCE = [
  { id: 'online',    label: 'Online',         color: '#23a55a' },
  { id: 'idle',      label: 'Idle',           color: '#f0b232' },
  { id: 'dnd',       label: 'Do Not Disturb', color: '#f23f43' },
  { id: 'invisible', label: 'Invisible',      color: '#80848e' },
]
const showPresence = ref(false)
const current = computed(() => PRESENCE.find(p => p.id === props.user.status) ?? PRESENCE[0])

// Opening the presence list changes the panel's height, so it has to be
// re-placed or it would grow downward off the bottom of the screen.
const togglePresence = async () => { showPresence.value = !showPresence.value; await place() }

const onDocDown = (e: PointerEvent) => {
  const t = e.target as Node
  if (panel.value?.contains(t)) return
  if (props.anchor?.contains(t)) return   // the anchor's own handler toggles us
  emit('close')
}
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close') }

onMounted(() => {
  void place()
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
      ref="panel" class="spp"
      :style="pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { opacity: 0 }"
      role="dialog" aria-label="Your profile"
    >
      <ProfileCard
        compact status-button
        :username="user.username"
        :display-name="user.displayName"
        :discriminator="user.discriminator"
        :avatar="user.avatar"
        :banner-color="user.bannerColor"
        :status="user.status"
        :custom-status="user.customStatus"
        @edit-status="emit('setStatus')"
      >
        <template #footer>
          <div class="spp-rows">
            <button class="spp-row" @click="emit('editProfile')">
              <PhPencilSimple :size="16" weight="bold" />
              <span>Edit profile</span>
            </button>

            <button class="spp-row" @click="togglePresence">
              <span class="spp-dot" :style="{ background: current.color }" />
              <span>{{ current.label }}</span>
              <PhCaretRight :size="13" weight="bold" class="spp-chev" :class="{ open: showPresence }" />
            </button>
            <div v-if="showPresence" class="spp-presence">
              <button
                v-for="p in PRESENCE" :key="p.id" class="spp-row sub"
                @click="emit('setPresence', p.id); showPresence = false"
              >
                <span class="spp-dot" :style="{ background: p.color }" />
                <span>{{ p.label }}</span>
                <PhCheck v-if="p.id === user.status" :size="14" weight="bold" class="spp-chev" />
              </button>
            </div>

            <button class="spp-row" @click="emit('copyId')">
              <PhIdentificationCard :size="16" weight="bold" />
              <span>Copy user ID</span>
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

.spp {
  position: fixed; z-index: 1200; width: 300px;
  border-radius: 10px; overflow: hidden;
  box-shadow: 0 18px 50px rgba(0,0,0,.7);
  animation: spp-in .13s cubic-bezier(.4,0,.2,1);
}
@keyframes spp-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .spp { animation: none; } }

.spp :deep(.pc) { width: 100%; box-shadow: none; border-radius: 0; }

.spp-rows {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,.07);
  display: flex; flex-direction: column; gap: 2px;
}
.spp-row {
  display: flex; align-items: center; gap: 11px; width: 100%; text-align: left;
  padding: 9px 10px; border-radius: 6px; font-size: 14px; color: var(--text-1);
  transition: background .1s;
}
.spp-row:hover { background: var(--hover-strong); }
.spp-row svg { color: var(--text-2); flex: none; }
.spp-row.sub { padding-left: 18px; font-size: 13.5px; color: var(--text-2); }
.spp-dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
.spp-chev { margin-left: auto; color: var(--text-3); transition: transform .14s; }
.spp-chev.open { transform: rotate(90deg); }
.spp-presence { display: flex; flex-direction: column; gap: 2px; }
</style>
