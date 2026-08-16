<script setup lang="ts">
/**
 * The shared modal shell.
 *
 * Desktop: a centred dialog. Phone: a bottom sheet, because a centred box on a
 * 390px screen is a desktop dialog wearing a smaller suit — it floats with dead
 * margins, its controls sit mid-screen out of thumb reach, and it has no
 * gesture to dismiss. A sheet rises from the edge the thumb is already at, and
 * you throw it away rather than hunting for an X.
 *
 * Doing this HERE converts every modal built on ModalBase at once, and means
 * one implementation of the drag physics rather than one per modal.
 */
import { ref, computed, watch } from 'vue'
import { useViewport } from '@/composables/useViewport'
import { useSheetDrag } from '@/composables/useSheetDrag'

defineProps<{
  title?: string
  width?: string
  /** Stack above another modal. EditField opens on top of Settings, which
   *  already owns an overlay — without this it would render underneath it. */
  z?: number
  /** Desktop placement. 'top' is for command-palette-style surfaces (the quick
   *  switcher) that belong high on screen near the typing focus. Ignored on a
   *  phone, where everything is a sheet at the bottom edge. */
  align?: 'center' | 'top'
}>()
const emit = defineEmits<{ close: [] }>()

const { isMobile } = useViewport()
const sheet = ref<HTMLElement | null>(null)

const drag = useSheetDrag(
  () => sheet.value?.getBoundingClientRect().height ?? 0,
  () => emit('close'),
)

// A sheet that was dragged partway and reopened must start at rest.
watch(isMobile, () => drag.reset())

const sheetStyle = computed(() =>
  isMobile.value && drag.offset.value
    ? { transform: `translateY(${drag.offset.value}px)` }
    : undefined)
</script>

<template>
  <Teleport to="body">
    <div
      class="overlay"
      :class="{ mobile: isMobile, top: align === 'top' && !isMobile }"
      :style="z ? { zIndex: z } : undefined"
      @mousedown.self="emit('close')"
    >
      <div
        ref="sheet"
        class="modal"
        :class="{ sheet: isMobile, dragging: drag.dragging.value }"
        :style="[isMobile ? sheetStyle : (width ? { width } : {})]"
        @keydown.esc="emit('close')"
      >
        <!-- The handle is the drag surface. Confining it here means a drag
             never starts on a control the user meant to press. -->
        <div
          v-if="isMobile"
          class="m-grab"
          @pointerdown="drag.onPointerDown"
          @pointermove="drag.onPointerMove"
          @pointerup="drag.onPointerUp"
          @pointercancel="drag.onPointerUp"
        >
          <span class="m-handle" />
        </div>
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

/* ── Phone: bottom sheet ──────────────────────────────────────────────── */
.overlay.top { align-items: flex-start; padding-top: 15vh; }
.overlay.mobile { align-items: flex-end; padding-top: 0; }
.modal.sheet {
  width: 100%; max-width: none;
  /* Not 100%: leaving the top of the screen uncovered keeps the app visible
     behind the sheet, so it reads as a layer over your place rather than a
     new screen you navigated to. */
  max-height: 88vh;
  border-radius: 18px 18px 0 0;
  /* The sheet owns the bottom edge, so it owns the home indicator inset. */
  padding-bottom: env(safe-area-inset-bottom);
  animation: sheet-up .26s cubic-bezier(.2,.8,.3,1);
  transition: transform .26s cubic-bezier(.2,.8,.3,1);
}
/* While a finger is down the drag IS the position — easing it would put the
   sheet behind the thumb. */
.modal.sheet.dragging { transition: none; }
@keyframes sheet-up { from { transform: translateY(100%) } to { transform: translateY(0) } }

.m-grab {
  flex-shrink: 0; padding: 8px 0 2px;
  touch-action: none;           /* this strip owns vertical drags */
  cursor: grab;
}
.m-handle {
  display: block; width: 36px; height: 4px; margin: 0 auto;
  background: var(--text-faint); border-radius: 2px; opacity: .6;
}

@media (prefers-reduced-motion: reduce) {
  .modal, .modal.sheet { animation: none; transition: none; }
  .overlay { animation: none; }
}
</style>
