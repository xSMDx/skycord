<script setup lang="ts">
defineProps<{ title?: string; width?: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <div class="modal" :style="width ? { width } : {}" @keydown.esc="emit('close')">
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.75);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  animation: fade-in .15s ease;
}
@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
.modal {
  background: var(--bg-panel);
  border-radius: 12px;
  width: 480px;
  max-width: 95vw;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 80px rgba(0,0,0,.7);
  animation: slide-up .18s cubic-bezier(.4,0,.2,1);
}
@keyframes slide-up { from { transform: translateY(16px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
</style>