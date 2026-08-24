<script setup lang="ts">
import { X, Pin } from 'lucide-vue-next'
import type { Message } from '@/types'

const props = defineProps<{ messages: Message[] }>()
const emit  = defineEmits<{ close: [] }>()

const pinned = props.messages.filter(m => m.pinned)
</script>

<template>
  <div class="pinned">
    <div class="pinned-header">
      <Pin :size="16" :stroke-width="2.25" style="color:#f0a500" />
      <span>Pinned Messages</span>
      <button class="pinned-close" @click="emit('close')">
        <X :size="16" :stroke-width="1.5" />
      </button>
    </div>

    <div class="pinned-body">
      <template v-if="pinned.length === 0">
        <div class="pinned-empty">
          <div class="pinned-empty-icon">📌</div>
          <p>This conversation doesn't have any pinned messages… yet.</p>
          <div class="pinned-tip">
            <span style="color:var(--accent);font-weight:700">PRO TIP:</span>
            You can pin a message from its context menu.
          </div>
        </div>
      </template>
      <template v-else>
        <div v-for="m in pinned" :key="m.id" class="pinned-msg">
          <div class="pm-avatar"><Avatar :src="m.avatar" :alt="m.author" :crop="(m as any).avatarCrop" /></div>
          <div class="pm-body">
            <div class="pm-meta">
              <span class="pm-author">{{ m.author }}</span>
              <span class="pm-time">{{ m.time }}</span>
            </div>
            <p class="pm-content">{{ m.content }}</p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
img    { display: block; width: 100%; height: 100%; object-fit: cover; }

.pinned {
  width:100%; background:var(--bg-panel);
  display:flex; flex-direction:column;
  height:100%; overflow:hidden;
}
.pinned-header {
  display: flex; align-items: center; gap: 8px;
  padding: 16px; border-bottom: 1px solid rgba(255,255,255,.06);
  font-size: 14px; font-weight: 700; color: var(--text-strong);
}
.pinned-close {
  margin-left: auto; width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background .12s, color .12s;
}
.pinned-close:hover { background: var(--hover); color: white; }

.pinned-body { flex: 1; overflow-y: auto; padding: 8px; }
.pinned-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 32px 20px; gap: 12px;
}
.pinned-empty-icon { font-size: 48px; }
.pinned-empty p { font-size: 14px; color: var(--text-3); line-height: 1.5; }
.pinned-tip { font-size: 13px; color: var(--text-3); line-height: 1.5; }

.pinned-msg {
  display: flex; gap: 10px; padding: 10px; border-radius: 8px;
  transition: background .1s; cursor: pointer;
}
.pinned-msg:hover { background: var(--hover); }
.pm-avatar { width: 32px; height: 32px; border-radius: 50%; overflow: hidden; flex-shrink: 0; }
.pm-body { flex: 1; min-width: 0; }
.pm-meta { display: flex; align-items: baseline; gap: 6px; margin-bottom: 2px; }
.pm-author { font-size: 13px; font-weight: 600; color: var(--text-strong); }
.pm-time   { font-size: 11px; color: var(--text-faint); }
.pm-content { font-size: 13px; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
