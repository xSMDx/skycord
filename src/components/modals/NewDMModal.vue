<script setup lang="ts">
import { ref, computed } from 'vue'
import { X, Search } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import type { Friend } from '@/types'

const props = defineProps<{ friends: Friend[]; title?: string }>()
const emit  = defineEmits<{ close: []; create: [ids: string[]] }>()

const search   = ref('')
const selected = ref<Set<string>>(new Set())

const filtered = computed(() =>
  props.friends.filter(f =>
    f.name.toLowerCase().includes(search.value.toLowerCase())
  )
)

const toggle = (id: string) => {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}

const statusColor: Record<string, string> = {
  online: '#23a55a', idle: '#f0a500', dnd: '#ed4245', offline: '#80848e'
}

const create = () => {
  if (selected.value.size === 0) return
  emit('create', [...selected.value])
}
</script>

<template>
  <ModalBase width="460px" @close="emit('close')">
    <div class="ndm">
      <!-- Header -->
      <div class="ndm-header">
        <div>
          <h2 class="ndm-title">{{ title || 'New Message' }}</h2>
          <p class="ndm-sub">Group DMs can have up to 10 members.</p>
        </div>
        <button class="ndm-close" aria-label="Close" @click="emit('close')">
          <X :size="20" :stroke-width="1.5" />
        </button>
      </div>

      <!-- Search -->
      <div class="ndm-search">
        <Search :size="14" :stroke-width="1.5" />
        <input
          v-model="search"
          type="text"
          placeholder="Search for friends"
          autofocus
        />
      </div>

      <!-- Friend list -->
      <div class="ndm-list">
        <div
          v-for="f in filtered" :key="f.id"
          class="ndm-item"
          :class="{ selected: selected.has(f.id) }"
          @click="toggle(f.id)"
        >
          <div class="ndm-avatar">
            <Avatar :src="f.avatar" :alt="f.name" :crop="(f as any).avatarCrop" />
            <span class="ndm-status" :style="{ background: statusColor[f.status] }" />
          </div>
          <div class="ndm-info">
            <span class="ndm-name">{{ f.name }}</span>
            <span class="ndm-tag">{{ f.username ?? f.name.toLowerCase() }}</span>
          </div>
          <div class="ndm-checkbox" :class="{ checked: selected.has(f.id) }">
            <svg v-if="selected.has(f.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </div>
        <div v-if="filtered.length === 0" class="ndm-empty">No friends found</div>
      </div>

      <!-- Footer -->
      <div class="ndm-footer">
        <button class="ndm-cancel" @click="emit('close')">Cancel</button>
        <button
          class="ndm-create"
          :disabled="selected.size === 0"
          @click="create"
        >{{ selected.size > 1 ? 'Create Group Message' : 'Create Message' }}</button>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
img    { display: block; width: 100%; height: 100%; object-fit: cover; }

.ndm { display: flex; flex-direction: column; background: var(--bg-panel); border-radius: 12px; }
.ndm-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 20px 0; }
.ndm-title  { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.ndm-sub    { font-size: 13px; color: var(--text-3); margin-top: 2px; }
.ndm-close  {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.ndm-close:hover { background: var(--hover); color: white; }

.ndm-search {
  display: flex; align-items: center; gap: 8px;
  margin: 16px 20px 0;
  background: rgba(0,0,0,.3); border: 1.5px solid rgba(255,255,255,.08);
  border-radius: 8px; padding: 8px 12px;
  transition: border-color var(--dur-2) var(--ease-out);
}
.ndm-search:focus-within { border-color: var(--accent); }
.ndm-search input { flex: 1; font-size: 14px; color: var(--text-1); background: none; border: none; outline: none; }
.ndm-search input::placeholder { color: var(--text-faint); }

.ndm-list { flex: 1; overflow-y: auto; padding: 8px 8px; max-height: 320px; margin-top: 8px; }
.ndm-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px; border-radius: 8px; cursor: pointer;
  transition: background var(--dur-1) var(--ease-out);
}
.ndm-item:hover { background: var(--hover); }
.ndm-item.selected { background: rgba(var(--accent-rgb),.12); }
.ndm-avatar { position: relative; width: 36px; height: 36px; flex-shrink: 0; }
.ndm-avatar img { border-radius: 50%; }
.ndm-status {
  position: absolute; bottom: -1px; right: -1px;
  width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid var(--bg-panel);
}
.ndm-info  { flex: 1; }
.ndm-name  { display: block; font-size: 15px; font-weight: 600; color: var(--text-strong); }
.ndm-tag   { display: block; font-size: 12px; color: var(--text-3); }
.ndm-checkbox {
  width: 20px; height: 20px; border-radius: 4px;
  border: 2px solid var(--text-3); display: flex; align-items: center; justify-content: center;
  transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
.ndm-checkbox.checked { background: var(--accent); border-color: var(--accent); }
.ndm-empty { text-align: center; color: var(--text-faint); font-size: 14px; padding: 24px; }

.ndm-footer {
  display: flex; gap: 10px; padding: 16px 20px;
  border-top: 1px solid rgba(255,255,255,.06);
}
.ndm-cancel {
  flex: 1; padding: 10px; border-radius: 6px;
  font-size: 14px; font-weight: 600; color: var(--text-1);
  background: rgba(255,255,255,.06);
  transition: background var(--dur-1) var(--ease-out);
}
.ndm-cancel:hover { background: var(--hover-strong); }
.ndm-create {
  flex: 2; padding: 10px; border-radius: 6px;
  font-size: 14px; font-weight: 600; color: white;
  background: var(--accent); transition: background var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.ndm-create:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
.ndm-create:disabled { opacity: .5; cursor: not-allowed; }
</style>