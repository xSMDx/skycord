<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { PhPhone, PhX } from '@phosphor-icons/vue'
import { soundRingStart, soundRingStop } from '@/composables/useSocket'

defineProps<{ name: string; avatar: string }>()
const emit = defineEmits<{ accept: []; decline: [] }>()

// Ring while the modal is up; always stop on teardown (answer / decline / unmount).
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
          <img class="ic-av" :src="avatar" :alt="name" />
        </div>
        <div class="ic-name">{{ name }}</div>
        <div class="ic-sub">Incoming Call…</div>
        <div class="ic-actions">
          <button class="ic-btn decline" title="Decline" @click="emit('decline')"><PhX :size="24" weight="bold" /></button>
          <button class="ic-btn accept" title="Accept" @click="emit('accept')"><PhPhone :size="24" weight="fill" /></button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ic-overlay {
  position: fixed; inset: 0; z-index: 5000;
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
.ic-sub  { font-size: 13px; color: var(--text-3); margin-top: 3px; }

.ic-actions { display: flex; gap: 36px; margin-top: 24px; }
.ic-btn {
  width: 58px; height: 58px; border-radius: 50%; border: none; cursor: pointer; color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: transform .12s, filter .12s; box-shadow: 0 6px 18px rgba(0,0,0,.35);
}
.ic-btn:hover { transform: translateY(-2px) scale(1.04); filter: brightness(1.08); }
.ic-btn:active { transform: scale(.94); }
.ic-btn.decline { background: #f23f43; }
.ic-btn.accept  { background: #23a55a; animation: ic-jiggle 1.6s ease-in-out infinite; }
@keyframes ic-jiggle { 0%,92%,100% { transform: none; } 94% { transform: rotate(-12deg); } 96% { transform: rotate(12deg); } 98% { transform: rotate(-8deg); } }
</style>
