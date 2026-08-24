<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Users } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const props = defineProps<{ code: string }>()
const emit  = defineEmits<{ joined: [group: any] }>()

const { getInvite, joinViaInvite } = useApi()

type State = 'loading' | 'loaded' | 'error' | 'joined'
const state     = ref<State>('loading')
const groupInfo = ref<{ id: string; name: string | null; memberCount: number; memberNames: string[]; isMember: boolean } | null>(null)
const joining   = ref(false)

const displayName = (info: typeof groupInfo.value) => {
  if (!info) return 'Group DM'
  return info.name ?? info.memberNames.slice(0, 3).join(', ') + (info.memberNames.length > 3 ? ` and ${info.memberNames.length - 3} more` : '')
}

onMounted(async () => {
  try {
    const res = await getInvite(props.code)
    groupInfo.value = res.group
    // Already in the group → show "Joined" immediately rather than "Join".
    state.value = res.group.isMember ? 'joined' : 'loaded'
  } catch {
    state.value = 'error'
  }
})

const join = async () => {
  if (joining.value || state.value === 'joined') return
  joining.value = true
  try {
    const res = await joinViaInvite(props.code)
    state.value = 'joined'
    emit('joined', res.group)
  } catch {
    // expired or full — show error
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
        <div class="ic-icon ic-icon--err"><Users :size="22" :stroke-width="2.25" /></div>
        <div class="ic-body">
          <span class="ic-name">Invite Invalid</span>
          <span class="ic-sub">This invite is invalid or has expired.</span>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="ic-icon">
        <Users :size="22" :stroke-width="2.25" />
      </div>
      <div class="ic-body">
        <span class="ic-name">{{ displayName(groupInfo) }}</span>
        <span class="ic-sub">
          <span class="ic-dot" />{{ groupInfo?.memberCount }} Member{{ groupInfo?.memberCount !== 1 ? 's' : '' }}
        </span>
      </div>
      <button
        class="ic-btn"
        :class="{ joined: state === 'joined' }"
        :disabled="state === 'joined' || joining"
        @click.stop="join"
      >{{ state === 'joined' ? 'Joined' : joining ? '…' : 'Join' }}</button>
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
  background: var(--state-fault); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; color: var(--text-strong);
}
.ic-icon--err { background: #4f3535; }

.ic-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ic-name { font-size: 15px; font-weight: 700; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ic-sub  { font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 5px; }
.ic-dot  {
  display: inline-block; width: 7px; height: 7px;
  border-radius: 50%; background: var(--state-live); flex-shrink: 0;
}

.ic-btn {
  padding: 8px 16px; border-radius: 6px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
  background: var(--accent); color: var(--text-on-accent);
  transition: background var(--dur-1) var(--ease-out), opacity var(--dur-1) var(--ease-out);
  flex-shrink: 0;
}
.ic-btn:hover:not(:disabled) { background: var(--accent-hover); }
.ic-btn.joined { background: rgba(255,255,255,.1); color: var(--text-2); cursor: default; }
.ic-btn:disabled { opacity: .7; cursor: not-allowed; }
</style>
