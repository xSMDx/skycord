<script setup lang="ts">
import { useAppearance } from '@/composables/useAppearance'

const { themePreview, keepPreview, revertPreview } = useAppearance()
</script>

<template>
  <transition name="tpb-slide">
    <div v-if="themePreview.active" class="tpb">
      <span class="tpb-dot" />
      <span class="tpb-text">Previewing a shared theme — your previous look is saved.</span>
      <div class="tpb-actions">
        <button class="tpb-btn ghost" @click="revertPreview">Revert</button>
        <button class="tpb-btn primary" @click="keepPreview">Keep</button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.tpb {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  z-index: 10000;
  display: flex; align-items: center; gap: 14px;
  padding: 12px 14px 12px 18px;
  background: var(--bg-floor); border: 1px solid var(--border);
  border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45);
  max-width: min(560px, calc(100vw - 32px));
}
.tpb-dot {
  width: 9px; height: 9px; border-radius: 50%; background: var(--accent);
  flex-shrink: 0; box-shadow: 0 0 0 4px rgba(var(--accent-rgb), .25);
}
.tpb-text { font-size: 14px; color: var(--text-1); flex: 1; min-width: 0; }
.tpb-actions { display: flex; gap: 8px; flex-shrink: 0; }
.tpb-btn {
  padding: 8px 16px; border-radius: 7px; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: background .12s, transform .1s;
}
.tpb-btn.ghost { color: var(--text-2); background: rgba(128,132,142,.16); }
.tpb-btn.ghost:hover { background: rgba(128,132,142,.28); color: var(--text-strong); }
.tpb-btn.primary { color: var(--text-on-accent); background: var(--accent); }
.tpb-btn.primary:hover { background: var(--accent-hover); transform: translateY(-1px); }

.tpb-slide-enter-active, .tpb-slide-leave-active { transition: opacity .2s, transform .2s; }
.tpb-slide-enter-from, .tpb-slide-leave-to { opacity: 0; transform: translate(-50%, 16px); }
</style>
