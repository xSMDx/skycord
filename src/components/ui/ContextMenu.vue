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
import { PhCheck } from '@phosphor-icons/vue'
import { menu, closeMenu, isSeparator, type MenuAction } from '@/composables/useContextMenu'

const el   = ref<HTMLElement | null>(null)
const pos  = ref({ x: 0, y: 0 })
const active = ref(-1)

// Indices of items that can actually be focused — separators and disabled rows
// are skipped by the arrow keys rather than swallowing a keypress.
const navigable = () => menu.items
  .map((it, i) => (!isSeparator(it) && !it.disabled ? i : -1))
  .filter(i => i !== -1)

const GAP = 8   // keep this far from the viewport edge

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
  if (!open) { active.value = -1; return }
  await place()
  el.value?.focus()
})

const select = (item: MenuAction) => {
  if (item.disabled) return
  closeMenu()
  void item.onSelect()
}

const move = (dir: 1 | -1) => {
  const nav = navigable(); if (!nav.length) return
  const at = nav.indexOf(active.value)
  active.value = nav[(at + dir + nav.length) % nav.length] ?? nav[0]
}

const onKey = (e: KeyboardEvent) => {
  if (!menu.open) return
  switch (e.key) {
    case 'Escape':    e.preventDefault(); closeMenu(); break
    case 'ArrowDown': e.preventDefault(); move(1);  break
    case 'ArrowUp':   e.preventDefault(); move(-1); break
    case 'Home':      e.preventDefault(); active.value = navigable()[0] ?? -1; break
    case 'End':       e.preventDefault(); active.value = navigable().slice(-1)[0] ?? -1; break
    case 'Enter':
    case ' ': {
      const it = menu.items[active.value]
      if (it && !isSeparator(it)) { e.preventDefault(); select(it) }
      break
    }
  }
}

// Scrolling or resizing would leave the menu stranded next to nothing.
const onDismiss = () => closeMenu()

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onDismiss)
  window.addEventListener('scroll', onDismiss, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onDismiss)
  window.removeEventListener('scroll', onDismiss, true)
})
</script>

<template>
  <div v-if="menu.open" class="cm-backdrop"
       @mousedown.self="closeMenu()"
       @contextmenu.prevent="closeMenu()">
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

      <template v-for="(item, i) in menu.items" :key="i">
        <div v-if="isSeparator(item)" class="cm-sep" />
        <button
          v-else
          class="cm-row"
          role="menuitem"
          :class="{ danger: item.danger, active: i === active, disabled: item.disabled }"
          :disabled="item.disabled"
          @click="select(item)"
          @mouseenter="active = i"
        >
          <component :is="item.icon" v-if="item.icon" :size="15" weight="light" />
          <span class="cm-label">{{ item.label }}</span>
          <PhCheck v-if="item.check" :size="14" weight="bold" class="cm-check" />
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.cm-backdrop { position: fixed; inset: 0; z-index: 9000; }

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
</style>
