<script setup lang="ts">
defineProps<{
  header: string
  items: { key: string; title: string; subtitle?: string; glyph?: string; avatar?: string }[]
  selectedIndex: number
}>()
const emit = defineEmits<{ select: [key: string]; hover: [index: number] }>()
</script>

<template>
  <div class="ac" @mousedown.prevent>
    <div class="ac-header">{{ header }}</div>
    <div class="ac-list">
      <button
        v-for="(it, i) in items" :key="it.key"
        class="ac-item" :class="{ active: i === selectedIndex }"
        @mouseenter="emit('hover', i)"
        @click="emit('select', it.key)"
      >
        <span class="ac-icon">
          <Avatar v-if="it.avatar" :src="it.avatar" :alt="it.title" :crop="(it as any).avatarCrop" />
          <span v-else class="ac-glyph">{{ it.glyph || '/' }}</span>
        </span>
        <span class="ac-text">
          <span class="ac-title">{{ it.title }}</span>
          <span v-if="it.subtitle" class="ac-sub">{{ it.subtitle }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
img { display: block; width: 100%; height: 100%; object-fit: cover; }

.ac {
  background: var(--bg-panel); border: 1px solid rgba(0,0,0,.4); border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0,0,0,.55); overflow: hidden;
}
.ac-header {
  font-size: 12px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--text-2); padding: 10px 14px 6px;
}
.ac-list { max-height: 280px; overflow-y: auto; padding: 0 6px 6px; }
.ac-item {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  padding: 8px 8px; border-radius: 6px; transition: background var(--dur-1) var(--ease-out);
}
.ac-item.active { background: rgba(var(--accent-rgb),.22); }
.ac-icon {
  width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0; overflow: hidden;
  background: var(--bg-input); display: flex; align-items: center; justify-content: center;
}
.ac-glyph { font-size: 16px; }
.ac-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ac-title { font-size: 14px; font-weight: 600; color: #f2f3f5; white-space: nowrap; }
.ac-sub { font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
