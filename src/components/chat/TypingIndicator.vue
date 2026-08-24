<script setup lang="ts">
defineProps<{ typers: string[] }>()
</script>

<template>
  <transition name="ti-slide">
    <div v-if="typers.length" class="ti-wrap">
      <div class="ti-dots">
        <span class="dot d1" />
        <span class="dot d2" />
        <span class="dot d3" />
      </div>
      <span class="ti-text">
        <strong>{{ typers.join(', ') }}</strong>
        {{ typers.length === 1 ? 'is' : 'are' }} typing
      </span>
    </div>
  </transition>
</template>

<style scoped>
.ti-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 20px 2px;
  min-height: 28px;
}

.ti-dots {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Each dot pulses in sequence: . → .. → ... → loop */
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.3;
  animation: dot-pulse 1.4s ease-in-out infinite;
}
.d1 { animation-delay: 0s;    }
.d2 { animation-delay: 0.22s; }
.d3 { animation-delay: 0.44s; }

@keyframes dot-pulse {
  0%,  60%, 100% { opacity: 0.25; transform: scale(0.8);  }
  30%            { opacity: 1;    transform: scale(1.25); }
}

.ti-text {
  font-size: 12px;
  color: var(--text-3);
  font-style: italic;
}
.ti-text strong {
  color: var(--text-2);
  font-style: normal;
  font-weight: 600;
}

/* Slide up / down transition */
.ti-slide-enter-active,
.ti-slide-leave-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
  overflow: hidden;
}
.ti-slide-enter-from,
.ti-slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
}
.ti-slide-enter-to,
.ti-slide-leave-from {
  opacity: 1;
  max-height: 32px;
}
</style>