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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, provide } from 'vue'
import { useViewport } from '@/composables/useViewport'
import { useSheetDrag } from '@/composables/useSheetDrag'

const props = defineProps<{
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

/**
 * Dismissal is two steps, because the parent owns the mount.
 *
 * Every caller renders this as `<ModalBase v-if="showX" @close="showX = false">`,
 * so emitting `close` directly unmounts this component on the same tick and
 * any leave transition inside it is destroyed before it can play. That is why
 * 21 modals entered over 180ms and then vanished between two frames.
 *
 * So: `requestClose` lowers our own flag, the leave transition runs, and only
 * `@after-leave` emits `close` for the parent to unmount us. No timeout —
 * the transition itself is the clock.
 *
 * Slot content that wants the same treatment injects `modalClose` instead of
 * emitting its own close upward; anything still emitting upward gets the old
 * instant unmount, which is a smaller gap than it was but not yet zero.
 */
const shown = ref(false)
onMounted(() => { shown.value = true })
const requestClose = () => { shown.value = false }
provide('modalClose', requestClose)

const { isMobile } = useViewport()
const sheet = ref<HTMLElement | null>(null)

const drag = useSheetDrag(
  () => sheet.value?.getBoundingClientRect().height ?? 0,
  () => requestClose(),
)

// A sheet that was dragged partway and reopened must start at rest.
watch(isMobile, () => drag.reset())

const sheetStyle = computed(() =>
  isMobile.value && drag.offset.value
    ? { transform: `translateY(${drag.offset.value}px)` }
    : undefined)

/**
 * Making the dialog a dialog.
 *
 * Nineteen modals are built on this shell, and none of them announced
 * itself as one: no role, no name, and -- the part that actually strands
 * someone -- no containment. Tab from inside an open modal walked straight
 * out into the app behind the overlay, where the focus ring was invisible
 * under a 75% black scrim and every control it landed on was one the user
 * had just been told they could not reach.
 *
 * Fixed once here rather than nineteen times, which is also why the name is
 * derived rather than required: most of these modals already render their
 * own heading, so the shell adopts that heading as the accessible name
 * instead of asking every caller to repeat it in a prop.
 */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),\
select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

const labelId = ref('')
let restoreTo: HTMLElement | null = null

// offsetParent is null for anything display:none, which is how the modals
// hide their own conditional rows -- a tab stop the eye cannot see is worse
// than no tab stop.
const focusables = () => Array.from(
  sheet.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []
).filter(el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') { e.stopPropagation(); requestClose(); return }
  if (e.key !== 'Tab') return
  // A cascade panel is teleported to body, so it is visually inside this
  // dialog but a DOM sibling of it. Let its own rows take the focus.
  if ((e.target as HTMLElement)?.closest?.('[data-anchored-panel]')) return

  const f = focusables()
  if (!f.length) { e.preventDefault(); sheet.value?.focus(); return }
  const first = f[0], last = f[f.length - 1]
  const a = document.activeElement
  const outside = !sheet.value?.contains(a)
  if (e.shiftKey ? (a === first || outside) : (a === last || outside)) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
  }
}

onMounted(async () => {
  restoreTo = document.activeElement as HTMLElement | null
  await nextTick()
  const root = sheet.value
  if (!root) return
  // A caller-supplied title wins; otherwise adopt the heading the modal
  // already draws, so the name matches what is on screen.
  if (!props.title) {
    const h = root.querySelector('h1,h2,h3')
    if (h) {
      if (!h.id) h.id = `mb-t-${Math.random().toString(36).slice(2, 9)}`
      labelId.value = h.id
    }
  }
  const auto = root.querySelector<HTMLElement>('[autofocus]')
  ;(auto || focusables()[0] || root).focus()
})

// Coming back out where you went in. Without this, dismissing a modal drops
// focus on <body> and the next Tab restarts from the top of the app.
onBeforeUnmount(() => {
  if (restoreTo && document.contains(restoreTo)) restoreTo.focus()
})
</script>

<template>
  <Teleport to="body">
    <!-- :duration is explicit rather than sniffed. Vue otherwise infers the
         leave length from a transitionend, and a leave that never fires one
         -- a no-op property change, a hidden tab that is not compositing --
         would mean @after-leave never runs and the modal stays mounted
         forever. Stuck open is a worse failure than no animation. -->
    <Transition name="mb" appear :duration="{ enter: 200, leave: 150 }" @after-leave="emit('close')">
    <div
      v-if="shown"
      class="overlay"
      :class="{ mobile: isMobile, top: align === 'top' && !isMobile }"
      :style="z ? { zIndex: z } : undefined"
      @mousedown.self="requestClose"
    >
      <div
        ref="sheet"
        class="modal"
        :class="{ sheet: isMobile, dragging: drag.dragging.value }"
        :style="[isMobile ? sheetStyle : (width ? { width } : {})]"
        role="dialog"
        aria-modal="true"
        :aria-label="title || undefined"
        :aria-labelledby="!title && labelId ? labelId : undefined"
        tabindex="-1"
        @keydown="onKey"
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
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── Dismissal, at last ───────────────────────────────────────────────────
   Enter and exit travel the SAME path — a sheet that rises from the bottom
   leaves to the bottom, a dialog that lifts settles back down. Anything else
   reads as two unrelated events. */
.mb-enter-active            { transition: opacity var(--dur-2) var(--ease-out); }
.mb-leave-active            { transition: opacity var(--dur-exit) var(--ease-in); }
.mb-enter-from, .mb-leave-to{ opacity: 0; }

.mb-enter-active .modal:focus { outline: none; }
.modal { transition:
  transform var(--dur-2) var(--ease-out), opacity var(--dur-2) var(--ease-out); }
.mb-leave-active .modal { transition:
  transform var(--dur-exit) var(--ease-in), opacity var(--dur-exit) var(--ease-in); }
.mb-enter-from .modal,
.mb-leave-to   .modal   { opacity: 0; transform: translateY(8px) scale(.98); }

/* The sheet keeps its own path: straight down, no scale. */
.mb-enter-from .modal.sheet,
.mb-leave-to   .modal.sheet   { opacity: 1; transform: translateY(100%); }
.mb-enter-active .modal.sheet { transition: transform var(--dur-4) var(--ease-out); }
.mb-leave-active .modal.sheet { transition: transform var(--dur-3) var(--ease-in); }

/* A sheet under the finger must not fight the finger. */
.mb-enter-active .modal.dragging,
.mb-leave-active .modal.dragging { transition:none; }

@media (prefers-reduced-motion: reduce) {
  .mb-enter-from .modal, .mb-leave-to .modal,
  .mb-enter-from .modal.sheet, .mb-leave-to .modal.sheet { transform: none; }
}
.overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.75);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
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
}

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
  transition:transform .26s cubic-bezier(.2,.8,.3,1);
}
/* While a finger is down the drag IS the position — easing it would put the
   sheet behind the thumb. */
.modal.sheet.dragging { transition:none; }

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
  .modal, .modal.sheet { animation: none; transition:none; }
  .overlay { animation: none; }
}
</style>
