<script setup lang="ts">
/**
 * The single context menu surface. Mounted ONCE at the app root; every
 * right-clickable target drives it through useContextMenu's openMenu().
 *
 * Everything a menu needs lives here so no menu has to reimplement it:
 * positioning that flips near the viewport edge (the old per-menu version
 * hardcoded `innerWidth - 230`, which mispositions any menu of a different
 * size), click-away, Escape, arrow-key navigation and focus return.
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Check, ChevronRight, ChevronLeft } from 'lucide-vue-next'
import { useViewport } from '@/composables/useViewport'
import { useSheetDrag } from '@/composables/useSheetDrag'
import { menu, menuItems as items, closeMenu, isSeparator, isSlider, isAction, hasSubmenu, type MenuAction, type MenuItem } from '@/composables/useContextMenu'

const el   = ref<HTMLElement | null>(null)
const subEl = ref<HTMLElement | null>(null)
const pos  = ref({ x: 0, y: 0 })
const active = ref(-1)

// Open submenu: which row owns it, its items, and where the flyout sits.
const sub = ref<{ index: number; items: MenuItem[]; x: number; y: number } | null>(null)

// ── Mobile: the menu is a bottom sheet, not a popover ───────────────────────
// A cursor-anchored popover has no meaning on a touch screen — there's no
// cursor to anchor to, and a menu pinned to wherever your thumb landed can
// open half off-screen or under it. It comes up from the bottom edge instead,
// where a thumb already is.
const { isMobile } = useViewport()

/**
 * Submenus DRILL on a phone rather than flying out sideways: there is no room
 * beside a full-width sheet, and a floating child popover over a sheet reads
 * as two competing surfaces. Holds the submenu currently being shown.
 */
const drill = ref<{ label: string; items: MenuItem[] } | null>(null)
/** What the sheet is currently listing — the menu, or a submenu drilled into. */
const rows = computed<MenuItem[]>(() => drill.value?.items ?? items.value)

// Physics live in useSheetDrag, shared with ModalBase.
const sheetDrag = useSheetDrag(
  () => el.value?.getBoundingClientRect().height ?? 0,
  () => closeMenu(),
)
const sheetY = sheetDrag.offset
const sheetDragging = sheetDrag.dragging
const onSheetDown = sheetDrag.onPointerDown
const onSheetMove = sheetDrag.onPointerMove
const onSheetUp   = sheetDrag.onPointerUp

// Reset per-open state, or the next menu inherits the last one's drill depth
// and a half-finished drag offset.
watch(() => menu.open, (open) => {
  if (open) { drill.value = null; sheetDrag.reset() }
})
const subActive = ref(-1)

// Indices of items that can actually be focused — separators and disabled rows
// are skipped by the arrow keys rather than swallowing a keypress.
// Sliders are skipped too — they're dragged, not selected, so landing keyboard
// focus on one would be a dead stop.
const navigable = () => items.value
  .map((it, i) => (!isSeparator(it) && !isSlider(it) && !it.disabled ? i : -1))
  .filter(i => i !== -1)

const GAP = 8   // keep this far from the viewport edge

// A range input has no native "filled" side, so the track is a gradient with a
// hard stop at the current value.
const sliderFill = (item: { value: number; min?: number; max?: number }) => {
  const min = item.min ?? 0, max = item.max ?? 200
  const pct = max === min ? 0 : ((item.value - min) / (max - min)) * 100
  return `linear-gradient(to right, var(--accent) 0 ${pct}%, rgba(255,255,255,.14) ${pct}% 100%)`
}

// Measure AFTER render: the menu's size depends on its items, so it can only be
// clamped once it exists. Until then it's rendered invisible to avoid a flash at
// the unclamped position.
const place = async () => {
  pos.value = { x: menu.x, y: menu.y }
  await nextTick()
  const n = el.value; if (!n) return
  // offsetWidth/Height, NOT getBoundingClientRect: the open animation starts at
  // scale(.94), and a rect measured mid-animation reports the menu smaller than
  // it really is — so the clamp under-corrects and the menu still overhangs the
  // edge once the animation settles.
  const w = n.offsetWidth, h = n.offsetHeight
  const vw = window.innerWidth, vh = window.innerHeight
  let { x, y } = menu
  // Flip to the other side of the cursor when there isn't room, then clamp so a
  // menu taller than the viewport is still reachable.
  if (x + w > vw - GAP) x = Math.max(GAP, x - w)
  if (y + h > vh - GAP) y = Math.max(GAP, y - h)
  pos.value = { x, y }
}

watch(() => menu.open, async (open) => {
  if (!open) { active.value = -1; closeSub(); return }
  await place()
  el.value?.focus()
})

// ── Submenus (Mute ▸ durations) ─────────────────────────────────────────────
const closeSub = () => { sub.value = null; subActive.value = -1 }

// Opens to the right of the parent row, flipping to its left when there isn't
// room. Anchored to the ROW, not the cursor, so it lines up with what opened it.
const openSub = async (index: number, items: MenuItem[], rowEl: HTMLElement) => {
  if (sub.value?.index === index) return
  const r = rowEl.getBoundingClientRect()
  sub.value = { index, items, x: r.right - 4, y: r.top - 6 }
  subActive.value = -1
  await nextTick()
  const n = subEl.value; if (!n) return
  const w = n.offsetWidth, h = n.offsetHeight
  let { x, y } = sub.value
  // Flip across the PARENT so the flyout never lands on top of it.
  if (x + w > window.innerWidth - GAP)  x = Math.max(GAP, r.left + 4 - w)
  if (y + h > window.innerHeight - GAP) y = Math.max(GAP, window.innerHeight - GAP - h)
  sub.value = { ...sub.value, x, y }
}

const onRowEnter = (i: number, item: MenuAction, e: MouseEvent) => {
  // Hover means nothing on a touch screen, and letting it fire would open a
  // flyout the moment a finger grazes a row while scrolling.
  if (isMobile.value) return
  active.value = i
  if (hasSubmenu(item)) void openSub(i, item.submenu!, e.currentTarget as HTMLElement)
  else closeSub()   // moving onto a plain row dismisses a sibling's flyout
}

const select = (item: MenuAction) => {
  if (item.disabled) return
  // A submenu parent has no action of its own — clicking it just opens the
  // flyout, so swallow the click rather than closing the whole menu.
  if (hasSubmenu(item)) {
    if (isMobile.value) drill.value = { label: item.label, items: item.submenu! }
    return
  }
  if (item.keepOpen) { void item.onSelect?.(); return }   // toggles stay open
  closeMenu()
  void item.onSelect?.()
}

const move = (dir: 1 | -1) => {
  const nav = navigable(); if (!nav.length) return
  const at = nav.indexOf(active.value)
  active.value = nav[(at + dir + nav.length) % nav.length] ?? nav[0]
  closeSub()
}

const subNavigable = () => (sub.value?.items ?? [])
  .map((it, i) => (isAction(it) && !it.disabled ? i : -1))
  .filter(i => i !== -1)

const onKey = (e: KeyboardEvent) => {
  if (!menu.open) return

  // While a flyout is open the arrows drive IT, so keyboard users aren't stuck
  // moving the parent selection underneath an open submenu.
  if (sub.value) {
    const nav = subNavigable()
    switch (e.key) {
      case 'Escape':
      case 'ArrowLeft': e.preventDefault(); closeSub(); el.value?.focus(); return
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' ? 1 : -1
        const at  = nav.indexOf(subActive.value)
        subActive.value = nav[(at + dir + nav.length) % nav.length] ?? nav[0]
        return
      }
      case 'Enter':
      case ' ': {
        const it = sub.value.items[subActive.value]
        if (it && !isSeparator(it)) { e.preventDefault(); select(it) }
        return
      }
    }
    return
  }

  switch (e.key) {
    case 'Escape':    e.preventDefault(); closeMenu(); break
    case 'ArrowDown': e.preventDefault(); move(1);  break
    case 'ArrowUp':   e.preventDefault(); move(-1); break
    case 'Home':      e.preventDefault(); active.value = navigable()[0] ?? -1; break
    case 'End':       e.preventDefault(); active.value = navigable().slice(-1)[0] ?? -1; break
    case 'ArrowRight': {
      // → opens the flyout on a submenu row, mirroring native menus.
      const it = items.value[active.value]
      if (it && hasSubmenu(it)) {
        e.preventDefault()
        const row = el.value?.querySelectorAll('.cm-row')[
          items.value.slice(0, active.value).filter(x => !isSeparator(x)).length] as HTMLElement | undefined
        if (row) void openSub(active.value, it.submenu!, row)
      }
      break
    }
    case 'Enter':
    case ' ': {
      const it = items.value[active.value]
      if (it && !isSeparator(it)) { e.preventDefault(); select(it) }
      break
    }
  }
}

// Scrolling or resizing would leave the menu stranded next to nothing.
const onDismiss = () => closeMenu()

// Click-away WITHOUT a backdrop element.
//
// A full-screen backdrop is the easy way to catch outside clicks, and it costs
// two real bugs: it swallows the click that dismisses it — so opening a menu
// and then clicking a conversation needs two clicks, the first only closing the
// menu — and being a stacking-context sibling it covered the incoming-call
// modal, which sits lower. Listening on the document instead means there is
// nothing over the app: the dismissing click lands on whatever you aimed at.
const onDocPointerDown = (e: PointerEvent) => {
  if (!menu.open) return
  const t = e.target as Node
  if (el.value?.contains(t) || subEl.value?.contains(t)) return
  closeMenu()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onDismiss)
  window.addEventListener('scroll', onDismiss, true)
  // Capture phase: close before the app's own handlers run, so a click never
  // acts on a stale menu — but the event still reaches its target.
  document.addEventListener('pointerdown', onDocPointerDown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onDismiss)
  window.removeEventListener('scroll', onDismiss, true)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<template>
  <Teleport v-if="menu.open" to="body">
    <!-- Scrim, mobile only: a sheet needs something to sit against, and a
         tappable area to dismiss into that isn't a 44px target. -->
    <div v-if="isMobile" class="cm-scrim" @click="closeMenu" @contextmenu.prevent />
    <div
      ref="el"
      class="cm"
      :class="{ sheet: isMobile, dragging: sheetDragging }"
      tabindex="-1"
      role="menu"
      :style="isMobile
        ? { transform: sheetY ? `translateY(${sheetY}px)` : undefined }
        : { left: pos.x + 'px', top: pos.y + 'px' }"
      @click.stop
      @contextmenu.prevent.stop
    >
      <!-- Grab area: the handle and the title row are the drag surface, so a
           drag never starts on a row you meant to tap. -->
      <div
        v-if="isMobile"
        class="cm-grab"
        @pointerdown="onSheetDown" @pointermove="onSheetMove"
        @pointerup="onSheetUp" @pointercancel="onSheetUp"
      >
        <span class="cm-handle" />
        <button v-if="drill" class="cm-back" @click.stop="drill = null">
          <ChevronLeft :size="16" :stroke-width="2.25" /> {{ drill.label }}
        </button>
      </div>

      <!-- Escape hatch for menus that aren't a list of rows (the message menu's
           quick-reaction strip is the one real case). -->
      <slot v-if="!drill" name="header" />

      <template v-for="(item, i) in rows" :key="i">
        <div v-if="isSeparator(item)" class="cm-sep" />
        <!-- Slider: a live control, so clicks inside must NOT close the menu. -->
        <div v-if="isSlider(item)" class="cm-slider" @click.stop>
          <div class="cm-slider-top">
            <span>{{ item.label }}</span>
            <span class="cm-slider-val">{{ (item.format ?? (v => String(v)))(item.value) }}</span>
          </div>
          <input type="range"
                 :min="item.min ?? 0" :max="item.max ?? 200" :value="item.value"
                 :style="{ background: sliderFill(item) }"
                 @input="item.onInput(+($event.target as HTMLInputElement).value)" />
        </div>
        <!-- A positive `isAction` guard rather than v-else: type narrowing does
             not carry across a v-if/v-else chain, so under v-else this branch
             still sees the whole union and every action-only field below is
             unchecked. Same runtime behaviour, real coverage. -->
        <button
          v-if="isAction(item)"
          class="cm-row"
          role="menuitem"
          :class="{ danger: item.danger, active: i === active, disabled: item.disabled }"
          :disabled="item.disabled"
          :aria-haspopup="item.submenu ? 'menu' : undefined"
          :aria-expanded="item.submenu ? sub?.index === i : undefined"
          @click="select(item)"
          @mouseenter="onRowEnter(i, item, $event)"
        >
          <component :is="item.icon" v-if="item.icon" :size="15" :stroke-width="1.5" />
          <span class="cm-label">{{ item.label }}</span>
          <Check v-if="item.check" :size="14" :stroke-width="2.25" class="cm-check" />
          <ChevronRight v-if="item.submenu" :size="12" :stroke-width="2.25" class="cm-caret" />
        </button>
      </template>
    </div>

    <!-- Submenu flyout. A sibling of the parent menu, not a child, so it can't
         be clipped by the parent's rounded corners or overflow. -->
    <div
      v-if="sub && !isMobile"
      ref="subEl"
      class="cm cm-sub"
      role="menu"
      :style="{ left: sub.x + 'px', top: sub.y + 'px' }"
      @click.stop
      @contextmenu.prevent.stop
      @mouseleave="closeSub()"
    >
      <template v-for="(item, j) in sub.items" :key="j">
        <div v-if="isSeparator(item)" class="cm-sep" />
        <button
          v-if="isAction(item)"
          class="cm-row"
          role="menuitem"
          :class="{ danger: item.danger, active: j === subActive, disabled: item.disabled }"
          :disabled="item.disabled"
          @click="select(item)"
          @mouseenter="subActive = j"
        >
          <component :is="item.icon" v-if="item.icon" :size="15" :stroke-width="1.5" />
          <span class="cm-label">{{ item.label }}</span>
          <Check v-if="item.check" :size="14" :stroke-width="2.25" class="cm-check" />
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

/* No backdrop element by design — see onDocPointerDown. Nothing of this
   component ever covers the app, so nothing can swallow a click or hide a
   modal underneath it. */
.cm {
  position: fixed; z-index: 9001;
  background: var(--bg-floor);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px; padding: 6px 0; min-width: 200px; max-width: 280px;
  box-shadow: 0 8px 32px rgba(0,0,0,.85);
  animation: cm-pop .12s cubic-bezier(.4,0,.2,1);
  outline: none;
}
/* ── Mobile: bottom sheet ──────────────────────────────────────────────────
   Anchoring a menu to a tap point is a desktop idea. On a phone it comes up
   from the bottom edge, full width, where the thumb already is and where
   nothing can push it off-screen. */
.cm-scrim {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0,0,0,.5);
  animation: cm-scrim-in .18s ease;
}
@keyframes cm-scrim-in { from { opacity: 0 } to { opacity: 1 } }

.cm.sheet {
  left: 0; right: 0; bottom: 0; top: auto;
  width: 100%; min-width: 0; max-width: none;
  border: none; border-top: 1px solid rgba(255,255,255,.08);
  border-radius: 16px 16px 0 0;
  padding: 0 0 max(8px, env(safe-area-inset-bottom));
  max-height: 75vh; overflow-y: auto;
  animation: cm-sheet-up .22s cubic-bezier(.2,.8,.3,1);
  /* No transition while a finger is on it: the drag IS the position, and
     easing it would put the sheet behind the thumb. */
  transition: transform .22s cubic-bezier(.2,.8,.3,1);
}
.cm.sheet.dragging { transition: none; }
@keyframes cm-sheet-up { from { transform: translateY(100%) } to { transform: translateY(0) } }

.cm-grab {
  position: sticky; top: 0; z-index: 1;
  background: var(--bg-floor);
  padding: 8px 0 4px;
  touch-action: none;          /* the sheet owns vertical drags here */
  cursor: grab;
}
.cm-handle {
  display: block; width: 36px; height: 4px; margin: 0 auto;
  background: var(--text-faint); border-radius: 2px; opacity: .6;
}
.cm-back {
  display: flex; align-items: center; gap: 4px;
  width: 100%; min-height: 44px; padding: 0 14px;
  background: none; border: none; cursor: pointer;
  color: var(--text-2); font-size: 13px; font-weight: 600;
}
.cm-back:active { color: var(--text-1); }

/* Rows get real touch targets. 8px 14px is a mouse-sized row. */
.cm.sheet .cm-row {
  min-height: 48px; padding: 0 18px; font-size: 15px; gap: 14px;
}
.cm.sheet .cm-row:active { background: var(--hover); }
.cm.sheet .cm-sep { margin: 4px 0; }
.cm.sheet .cm-slider { padding: 10px 18px; }

@media (prefers-reduced-motion: reduce) {
  .cm.sheet { animation: none; transition: none; }
  .cm-scrim { animation: none; }
}

@keyframes cm-pop {
  from { opacity: 0; transform: scale(.94) translateY(-4px); }
  to   { opacity: 1; transform: scale(1)   translateY(0);    }
}

.cm-sep { height: 1px; background: rgba(255,255,255,.08); margin: 3px 0; }

.cm-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; font-size: 14px; color: var(--text-1);
  width: 100%; text-align: left;
  transition: background .08s, color .08s;
}
/* Hover and keyboard focus share one state, so arrowing through the menu looks
   identical to mousing through it. */
.cm-row:hover, .cm-row.active         { background: var(--accent); color: #fff; }
.cm-row.danger                        { color: #ed4245; }
.cm-row.danger:hover,
.cm-row.danger.active                 { background: #ed4245; color: #fff; }
.cm-row.disabled                      { color: var(--text-3); cursor: default; }
.cm-row.disabled:hover                { background: none; color: var(--text-3); }
.cm-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cm-check { flex: none; }
.cm-slider { padding: 8px 14px 10px; display: flex; flex-direction: column; gap: 6px; }
.cm-slider-top {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 13px; color: var(--text-2);
}
.cm-slider-val { font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.cm-slider input[type=range] {
  width: 100%; height: 4px; border-radius: 2px; appearance: none;
  background: rgba(255,255,255,.14); outline: none; cursor: pointer;
}
.cm-slider input[type=range]::-webkit-slider-thumb {
  appearance: none; width: 13px; height: 13px; border-radius: 50%;
  background: var(--text-1); border: none; cursor: pointer;
}
.cm-caret { flex: none; opacity: .55; }
.cm-row:hover .cm-caret, .cm-row.active .cm-caret { opacity: 1; }
/* Above the parent, so an overlapping flyout is never rendered behind it. */
.cm-sub { z-index: 9002; }
</style>
