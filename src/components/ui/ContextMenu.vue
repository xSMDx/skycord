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
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { PhCheck, PhCaretRight } from '@phosphor-icons/vue'
import { menu, menuItems as items, closeMenu, isSeparator, isSlider, hasSubmenu, type MenuAction, type MenuItem } from '@/composables/useContextMenu'

const el   = ref<HTMLElement | null>(null)
const subEl = ref<HTMLElement | null>(null)
const pos  = ref({ x: 0, y: 0 })
const active = ref(-1)

// Open submenu: which row owns it, its items, and where the flyout sits.
const sub = ref<{ index: number; items: MenuItem[]; x: number; y: number } | null>(null)
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
  active.value = i
  if (hasSubmenu(item)) void openSub(i, item.submenu!, e.currentTarget as HTMLElement)
  else closeSub()   // moving onto a plain row dismisses a sibling's flyout
}

const select = (item: MenuAction) => {
  if (item.disabled) return
  // A submenu parent has no action of its own — clicking it just opens the
  // flyout, so swallow the click rather than closing the whole menu.
  if (hasSubmenu(item)) return
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
  .map((it, i) => (!isSeparator(it) && !it.disabled ? i : -1))
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
    <div
      ref="el"
      class="cm"
      tabindex="-1"
      role="menu"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @click.stop
      @contextmenu.prevent.stop
    >
      <!-- Escape hatch for menus that aren't a list of rows (the message menu's
           quick-reaction strip is the one real case). -->
      <slot name="header" />

      <template v-for="(item, i) in items" :key="i">
        <div v-if="isSeparator(item)" class="cm-sep" />
        <!-- Slider: a live control, so clicks inside must NOT close the menu. -->
        <div v-else-if="isSlider(item)" class="cm-slider" @click.stop>
          <div class="cm-slider-top">
            <span>{{ item.label }}</span>
            <span class="cm-slider-val">{{ (item.format ?? (v => String(v)))(item.value) }}</span>
          </div>
          <input type="range"
                 :min="item.min ?? 0" :max="item.max ?? 200" :value="item.value"
                 :style="{ background: sliderFill(item) }"
                 @input="item.onInput(+($event.target as HTMLInputElement).value)" />
        </div>
        <button
          v-else
          class="cm-row"
          role="menuitem"
          :class="{ danger: item.danger, active: i === active, disabled: item.disabled }"
          :disabled="item.disabled"
          :aria-haspopup="item.submenu ? 'menu' : undefined"
          :aria-expanded="item.submenu ? sub?.index === i : undefined"
          @click="select(item)"
          @mouseenter="onRowEnter(i, item, $event)"
        >
          <component :is="item.icon" v-if="item.icon" :size="15" weight="light" />
          <span class="cm-label">{{ item.label }}</span>
          <PhCheck v-if="item.check" :size="14" weight="bold" class="cm-check" />
          <PhCaretRight v-if="item.submenu" :size="12" weight="bold" class="cm-caret" />
        </button>
      </template>
    </div>

    <!-- Submenu flyout. A sibling of the parent menu, not a child, so it can't
         be clipped by the parent's rounded corners or overflow. -->
    <div
      v-if="sub"
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
          v-else
          class="cm-row"
          role="menuitem"
          :class="{ danger: item.danger, active: j === subActive, disabled: item.disabled }"
          :disabled="item.disabled"
          @click="select(item)"
          @mouseenter="subActive = j"
        >
          <component :is="item.icon" v-if="item.icon" :size="15" weight="light" />
          <span class="cm-label">{{ item.label }}</span>
          <PhCheck v-if="item.check" :size="14" weight="bold" class="cm-check" />
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
