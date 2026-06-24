<script setup lang="ts">
import {
  PhPencilSimple, PhArrowBendUpLeft, PhCopy,
  PhPushPin, PhEnvelope, PhTrash, PhSmiley
} from '@phosphor-icons/vue'
import type { Message } from '@/types'

const props = defineProps<{
  msg:   Message
  x:     number
  y:     number
  isOwn: boolean
}>()

const emit = defineEmits<{
  close:     []
  edit:      [msg: Message]
  pin:       [msg: Message]
  copy:      [msg: Message]
  copyId:    [msg: Message]
  delete:    [msg: Message]
  react:     [msg: Message, emoji: string]
  openEmoji: [msg: Message]
  reply:     [msg: Message]
  openTree:  [msg: Message]
}>()

const safeX = Math.min(props.x, window.innerWidth  - 230)
const safeY = Math.min(props.y, window.innerHeight - 380)
</script>

<template>
  <div class="ctx-backdrop" @mousedown.self="emit('close')" @contextmenu.prevent>
    <div class="ctx-menu" :style="{ top: safeY + 'px', left: safeX + 'px' }" @click.stop>

      <!-- Quick reactions -->
      <div class="ctx-reactions">
        <button class="ctx-qr" @click="emit('react', msg, '👍'); emit('close')">👍</button>
        <button class="ctx-qr" @click="emit('react', msg, '❤️'); emit('close')">❤️</button>
        <button class="ctx-qr" @click="emit('react', msg, '😂'); emit('close')">😂</button>
        <button class="ctx-qr" @click="emit('react', msg, '😮'); emit('close')">😮</button>
        <button class="ctx-qr" @click="emit('react', msg, '😢'); emit('close')">😢</button>
        <button class="ctx-qr ctx-qr-more" @click="emit('openEmoji', msg); emit('close')" title="More reactions">
          <PhSmiley :size="18" weight="light" />
        </button>
      </div>

      <div class="ctx-sep" />

      <button class="ctx-row" @click="emit('reply', msg); emit('close')">
        <PhArrowBendUpLeft :size="15" weight="light" /><span>Reply</span>
      </button>
      <button v-if="msg.replyTo" class="ctx-row" @click="emit('openTree', msg); emit('close')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8.3 6.8L15.7 11M8.3 17.2L15.7 13"/></svg>
        <span>View Reply Chain</span>
      </button>
      <button v-if="isOwn" class="ctx-row" @click="emit('edit', msg); emit('close')">
        <PhPencilSimple :size="15" weight="light" /><span>Edit Message</span>
      </button>

      <div class="ctx-sep" />

      <button class="ctx-row" @click="emit('copy', msg); emit('close')">
        <PhCopy :size="15" weight="light" /><span>Copy Text</span>
      </button>
      <button class="ctx-row" @click="emit('pin', msg); emit('close')">
        <PhPushPin :size="15" weight="light" />
        <span>{{ msg.pinned ? 'Unpin Message' : 'Pin Message' }}</span>
      </button>
      <button class="ctx-row" @click="emit('close')">
        <PhEnvelope :size="15" weight="light" /><span>Mark as Unread</span>
      </button>
      <button class="ctx-row" @click="emit('copyId', msg); emit('close')">
        <PhCopy :size="15" weight="light" /><span>Copy Message ID</span>
      </button>

      <div class="ctx-sep" />

      <button class="ctx-row danger" @click="emit('delete', msg); emit('close')">
        <PhTrash :size="15" weight="light" /><span>Delete Message</span>
      </button>

    </div>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.ctx-backdrop { position: fixed; inset: 0; z-index: 9000; }

.ctx-menu {
  position: fixed; z-index: 9001;
  background: var(--bg-floor);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px; padding: 6px 0; min-width: 214px;
  box-shadow: 0 8px 32px rgba(0,0,0,.85);
  animation: ctx-pop .12s cubic-bezier(.4,0,.2,1);
}
@keyframes ctx-pop {
  from { opacity: 0; transform: scale(.94) translateY(-4px); }
  to   { opacity: 1; transform: scale(1)   translateY(0);    }
}

.ctx-reactions {
  display: flex; align-items: center;
  padding: 6px 10px 8px; gap: 2px;
}
.ctx-qr {
  flex: 1; height: 36px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
  transition: background .1s, transform .12s;
}
.ctx-qr:hover { background: var(--hover-strong); transform: scale(1.28); }
.ctx-qr-more  { color: var(--text-3); font-size: 16px; }
.ctx-qr-more:hover { color: var(--text-1); }

.ctx-sep { height: 1px; background: rgba(255,255,255,.08); margin: 3px 0; }

.ctx-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; font-size: 14px; color: var(--text-1);
  width: 100%; text-align: left;
  transition: background .08s, color .08s;
}
.ctx-row:hover        { background: var(--accent); color: white; }
.ctx-row.danger       { color: #ed4245; }
.ctx-row.danger:hover { background: #ed4245; color: white; }
</style>