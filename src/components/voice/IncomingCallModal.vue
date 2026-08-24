<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { Phone, X } from 'lucide-vue-next'
import { soundRingStart, soundRingStop } from '@/composables/useSocket'

defineProps<{ name: string; avatar: string; avatarCrop?: { zoom: number; x: number; y: number } | null }>()
const emit = defineEmits<{ accept: []; decline: [] }>()

// Ring for as long as this is up; always stop on teardown (answer/decline/unmount).
//
// Mute is NOT checked here. It used to be, as a one-shot onMounted test, and that
// was the wrong shape: `incomingCall` is a computed that returns a fresh object,
// so when it changes without passing through null Vue patches this component
// rather than remounting it — and the gate never re-ran. The single gate now
// lives in ChatApp's incomingCall computed, so a muted conversation produces no
// modal at all and there is nothing here to silence.
onMounted(soundRingStart)
onBeforeUnmount(soundRingStop)
</script>

<template>
  <Teleport to="body">
    <div class="ic-overlay">
      <div class="ic-card">
        <div class="ic-av-wrap">
          <span class="ic-ring" />
          <span class="ic-ring ic-ring2" />
          <Avatar class="ic-av" :size="96" :src="avatar" :alt="name" :crop="avatarCrop" />
        </div>
        <div class="ic-name">{{ name }}</div>
        <div class="ic-sub">Incoming Call…</div>
        <div class="ic-actions">
          <button class="ic-btn decline" v-tip="'Decline'" @click="emit('decline')"><X :size="24" :stroke-width="2.25" /></button>
          <button class="ic-btn accept" v-tip="'Accept'" @click="emit('accept')"><Phone :size="24" :stroke-width="2.25" /></button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ic-overlay {
  /* Above the menus and flyouts (9001/8001). Someone calling you outranks
     whatever popover happens to be open — at 5000 an open context menu's layer
     sat on top of this and the call simply never appeared. */
  position: fixed; inset: 0; z-index: 9700;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.45);
  animation: ic-fade .15s ease;
}
@keyframes ic-fade { from { opacity: 0; } to { opacity: 1; } }

.ic-card {
  width: 280px; padding: 28px 24px 22px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 14px;
  box-shadow: 0 24px 70px rgba(0,0,0,.6);
  display: flex; flex-direction: column; align-items: center;
  animation: ic-pop .22s cubic-bezier(.34,1.56,.64,1);
}
@keyframes ic-pop { from { opacity: 0; transform: scale(.9) translateY(10px); } to { opacity: 1; transform: none; } }

.ic-av-wrap { position: relative; width: 96px; height: 96px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
.ic-av { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; }
.ic-ring {
  position: absolute; inset: 0; border-radius: 50%;
  border: 2px solid var(--accent);
  animation: ic-pulse 1.8s ease-out infinite;
}
.ic-ring2 { animation-delay: .9s; }
@keyframes ic-pulse {
  0%   { transform: scale(1);   opacity: .7; }
  100% { transform: scale(1.5); opacity: 0; }
}

.ic-name { font-size: 19px; font-weight: 700; color: var(--text-strong); }
.ic-sub  { font-size: 13px; color: var(--text-3); margin-top: 4px; }

.ic-actions { display: flex; gap: 36px; margin-top: 24px; }
.ic-btn {
  width: 58px; height: 58px; border-radius: 50%; border: none; cursor: pointer; color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: transform var(--dur-1) var(--ease-out), filter var(--dur-1) var(--ease-out); box-shadow: 0 6px 18px rgba(0,0,0,.35);
}
.ic-btn:hover { transform: translateY(-2px) scale(1.04); filter: brightness(1.08); }
.ic-btn:active { transform: scale(.94); }
.ic-btn.decline { background: #f23f43; }
.ic-btn.accept  { background: #23a55a; }
</style>
