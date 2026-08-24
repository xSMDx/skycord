<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { X } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import { useApi } from '@/composables/useApi'
import type { Group, Friend } from '@/types'

const MAX_GROUP_MEMBERS = 10

const props = defineProps<{ group: Group; friends: Friend[] }>()
const emit  = defineEmits<{ close: []; added: [group: Group] }>()

const { addGroupMembers, createGroupInvite } = useApi()

const search    = ref('')
const selected  = ref<Set<string>>(new Set())
const adding    = ref(false)
const error     = ref('')

const inviteUrl = ref('')
const copied    = ref(false)

const statusColor: Record<string, string> = {
  online: 'var(--state-live)', idle: '#f0a500', dnd: 'var(--state-fault)', offline: '#80848e',
}

const remaining = computed(() => Math.max(0, MAX_GROUP_MEMBERS - props.group.memberCount))

// Friends who aren't already in the group, filtered by the search box.
const memberIds = computed(() => new Set(props.group.members.map(m => m.id)))
const addable = computed(() =>
  props.friends
    .filter(f => !memberIds.value.has(f.id))
    .filter(f => f.name.toLowerCase().includes(search.value.toLowerCase()))
)

const toggle = (id: string) => {
  if (selected.value.has(id)) { selected.value.delete(id) }
  else if (selected.value.size < remaining.value) { selected.value.add(id) }
  selected.value = new Set(selected.value)
}

const add = async () => {
  if (adding.value || selected.value.size === 0) return
  adding.value = true
  error.value  = ''
  try {
    const res = await addGroupMembers(props.group.id, [...selected.value])
    emit('added', res.group as Group)
    emit('close')
  } catch (e: any) {
    error.value = e?.message || 'Could not add members'
  } finally {
    adding.value = false
  }
}

// Copy with a fallback for non-secure contexts (LAN IP, http://) where the
// async Clipboard API is unavailable — the hidden-textarea + execCommand path
// still works there.
const fallbackCopy = (text: string): boolean => {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus(); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

const flagCopied = () => {
  copied.value = true
  setTimeout(() => { copied.value = false }, 1600)
}

const copyLink = async () => {
  if (!inviteUrl.value) return
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(inviteUrl.value); flagCopied(); return }
    catch { /* fall through to execCommand */ }
  }
  if (fallbackCopy(inviteUrl.value)) flagCopied()
}

onMounted(async () => {
  try {
    const res = await createGroupInvite(props.group.id)
    inviteUrl.value = `${location.origin}/invite/${res.code}`
  } catch { /* invite link optional — friend checkboxes still work */ }
})
</script>

<template>
  <ModalBase width="460px" @close="emit('close')">
    <div class="ig">
      <div class="ig-header">
        <div>
          <h2 class="ig-title">Invite to Group DM</h2>
          <p class="ig-sub">You can add {{ remaining }} more {{ remaining === 1 ? 'person' : 'people' }}.</p>
        </div>
        <button class="ig-close" @click="emit('close')" aria-label="Close">
          <X :size="20" :stroke-width="1.5" />
        </button>
      </div>

      <div class="ig-search-row">
        <input
          v-model="search"
          class="ig-search"
          type="text"
          placeholder="Search"
          autofocus
        />
        <button class="ig-add" :disabled="adding || selected.size === 0" @click="add">
          {{ adding ? '…' : 'Add' }}
        </button>
      </div>
      <p class="ig-hint">Add friends or server members to group DMs.</p>

      <div class="ig-list">
        <div
          v-for="f in addable" :key="f.id"
          class="ig-item" :class="{ selected: selected.has(f.id) }"
          @click="toggle(f.id)"
        >
          <div class="ig-avatar">
            <Avatar :src="f.avatar" :alt="f.name" :crop="(f as any).avatarCrop" />
            <span class="ig-status" :style="{ background: statusColor[f.status] }" />
          </div>
          <div class="ig-info">
            <span class="ig-name">{{ f.name }}</span>
            <span class="ig-tag">{{ f.username ?? f.name.toLowerCase() }}</span>
          </div>
          <div class="ig-checkbox" :class="{ checked: selected.has(f.id) }">
            <svg v-if="selected.has(f.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </div>
        <div v-if="addable.length === 0" class="ig-empty">No friends to add</div>
      </div>

      <p v-if="error" class="ig-error">{{ error }}</p>

      <!-- Invite link -->
      <div class="ig-linkbox">
        <span class="ig-link-label">Or, send an invite link</span>
        <div class="ig-link-row">
          <input class="ig-link" :value="inviteUrl" readonly placeholder="Generating link…" />
          <button class="ig-copy" :class="{ copied }" :disabled="!inviteUrl" @click="copyLink">
            {{ copied ? 'Copied!' : 'Copy' }}
          </button>
        </div>
        <span class="ig-expiry">Your invite link expires in 24 hours.</span>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
img { display: block; width: 100%; height: 100%; object-fit: cover; }

.ig { display: flex; flex-direction: column; }
.ig-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px 0; }
.ig-title  { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.ig-sub    { font-size: 13px; color: var(--text-3); margin-top: 2px; }
.ig-close  {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.ig-close:hover { background: var(--hover); color: var(--text-strong); }

.ig-search-row { display: flex; gap: 10px; padding: 16px 20px 0; }
.ig-search {
  flex: 1; padding: 9px 12px; border-radius: 6px;
  background: var(--bg-input); border: 1px solid transparent;
  font-size: 14px; color: var(--text-1); outline: none; transition: border-color var(--dur-2) var(--ease-out);
}
.ig-search:focus { border-color: var(--accent); }
.ig-search::placeholder { color: var(--text-faint); }
.ig-add {
  padding: 0 22px; border-radius: 4px;
  font-size: 14px; font-weight: 600; color: var(--text-on-accent);
  background: var(--accent); transition: background var(--dur-1) var(--ease-out), opacity var(--dur-1) var(--ease-out);
}
.ig-add:hover:not(:disabled) { background: var(--accent-hover); }
.ig-add:disabled { opacity: .5; cursor: not-allowed; }

.ig-hint { padding: 8px 20px 0; font-size: 12px; color: var(--text-3); }

.ig-list { padding: 8px 12px; max-height: 280px; overflow-y: auto; margin-top: 4px; }
.ig-item {
  display: flex; align-items: center; gap: 12px;
  padding: 7px 8px; border-radius: 6px; cursor: pointer; transition: background var(--dur-1) var(--ease-out);
}
.ig-item:hover { background: var(--hover); }
.ig-item.selected { background: rgba(var(--accent-rgb),.12); }
.ig-avatar { position: relative; width: 32px; height: 32px; flex-shrink: 0; }
.ig-avatar img { border-radius: 50%; }
.ig-status {
  position: absolute; bottom: -1px; right: -1px;
  width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--bg-panel);
}
.ig-info { flex: 1; min-width: 0; }
.ig-name { display: block; font-size: 14px; font-weight: 600; color: var(--text-strong); }
.ig-tag  { display: block; font-size: 12px; color: var(--text-3); }
.ig-checkbox {
  width: 20px; height: 20px; border-radius: 4px; flex-shrink: 0;
  border: 2px solid var(--text-faint); display: flex; align-items: center; justify-content: center;
  transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
.ig-checkbox.checked { background: var(--accent); border-color: var(--accent); }

.ig-empty { text-align: center; color: var(--text-faint); font-size: 14px; padding: 20px; }
.ig-error { padding: 0 20px; font-size: 13px; color: #fa777c; }

.ig-linkbox {
  display: flex; flex-direction: column; gap: 8px;
  padding: 16px 20px 20px; margin-top: 4px;
  background: var(--bg-input);
}
.ig-link-label { font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--text-2); }
.ig-link-row { display: flex; gap: 10px; }
.ig-link {
  flex: 1; padding: 9px 12px; border-radius: 6px;
  background: var(--bg-panel); border: none;
  font-size: 14px; color: var(--text-1); outline: none;
}
.ig-copy {
  padding: 0 22px; border-radius: 4px;
  font-size: 14px; font-weight: 600; color: var(--text-on-accent);
  background: var(--accent); transition: background var(--dur-1) var(--ease-out), opacity var(--dur-1) var(--ease-out);
}
.ig-copy:hover:not(:disabled) { background: var(--accent-hover); }
.ig-copy.copied { background: #248046; }
.ig-copy:disabled { opacity: .5; cursor: not-allowed; }
.ig-expiry { font-size: 12px; color: var(--text-3); }
</style>
