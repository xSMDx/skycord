<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useApi } from '@/composables/useApi'
import { useServers, serverIconFor } from '@/composables/useServers'

const props = defineProps<{ code: string }>()
const emit  = defineEmits<{ joined: [server: any] }>()

const { getServerInvite, joinServerInvite } = useApi()
const { receiveDetail } = useServers()

type State = 'loading' | 'loaded' | 'error' | 'joined'
const state      = ref<State>('loading')
const serverInfo = ref<{ id: string; name: string; icon: string | null; memberCount: number } | null>(null)
const full       = ref(false)
const joining    = ref(false)

// Real icon when the server has one; otherwise the same initials-on-colour
// fallback a member with no avatar gets, so an icon-less server never looks
// like a broken image.
const iconSrc = computed(() => serverIconFor(serverInfo.value?.name ?? '?', serverInfo.value?.icon ?? null))

onMounted(async () => {
  try {
    const res = await getServerInvite(props.code)
    serverInfo.value = res.server
    full.value = res.full
    // Already in the server → show "Joined" immediately rather than "Join".
    state.value = res.alreadyMember ? 'joined' : 'loaded'
  } catch {
    state.value = 'error'
  }
})

const join = async () => {
  if (joining.value || state.value === 'joined' || full.value) return
  joining.value = true
  try {
    const res = await joinServerInvite(props.code)
    // `joined: false` means "you were already a member" — still success, not
    // an error, so it gets the same "Joined" state as a fresh join.
    receiveDetail(res.server, res.channels)
    state.value = 'joined'
    emit('joined', res.server)
  } catch {
    // expired, revoked, or the server filled up between preview and join
    state.value = 'error'
  } finally {
    joining.value = false
  }
}
</script>

<template>
  <div class="invite-card">
    <template v-if="state === 'loading'">
      <div class="ic-loading">Loading invite…</div>
    </template>

    <template v-else-if="state === 'error'">
      <div class="ic-error">
        <div class="ic-icon ic-icon--err">!</div>
        <div class="ic-body">
          <span class="ic-name">Invite Invalid</span>
          <span class="ic-sub">This invite is invalid or has expired.</span>
        </div>
      </div>
    </template>

    <template v-else>
      <img class="ic-icon ic-icon--img" :src="iconSrc" alt="" />
      <div class="ic-body">
        <span class="ic-name">{{ serverInfo?.name }}</span>
        <span class="ic-sub">
          <span class="ic-dot" />{{ serverInfo?.memberCount }} Member{{ serverInfo?.memberCount !== 1 ? 's' : '' }}
        </span>
      </div>
      <button
        class="ic-btn"
        :class="{ joined: state === 'joined' }"
        :disabled="state === 'joined' || joining || full"
        @click.stop="join"
      >{{ state === 'joined' ? 'Joined' : joining ? '…' : full ? 'Full' : 'Join' }}</button>
    </template>
  </div>
</template>

<style scoped>
.invite-card {
  display: flex; align-items: center; gap: 12px;
  background: var(--bg-floor); border: 1px solid rgba(255,255,255,.06);
  border-radius: 8px; padding: 12px 16px;
  margin-top: 6px; max-width: 380px;
}

.ic-loading { color: var(--text-3); font-size: 13px; }

.ic-error { display: flex; align-items: center; gap: 12px; }

.ic-icon {
  width: 44px; height: 44px; border-radius: 10px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; color: var(--text-strong);
}
.ic-icon--err { background: #4f3535; font-size: 20px; font-weight: 700; }
.ic-icon--img { object-fit: cover; }

.ic-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ic-name { font-size: 15px; font-weight: 700; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ic-sub  { font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 5px; }
.ic-dot  {
  display: inline-block; width: 7px; height: 7px;
  border-radius: 50%; background: #23a55a; flex-shrink: 0;
}

.ic-btn {
  padding: 8px 16px; border-radius: 6px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
  background: var(--accent); color: var(--text-on-accent);
  transition: background .12s, opacity .12s;
  flex-shrink: 0;
}
.ic-btn:hover:not(:disabled) { background: var(--accent-hover); }
.ic-btn.joined { background: rgba(255,255,255,.1); color: var(--text-2); cursor: default; }
.ic-btn:disabled { opacity: .7; cursor: not-allowed; }
</style>
