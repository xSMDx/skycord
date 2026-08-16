<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { X, ZoomIn, ZoomOut, Expand } from 'lucide-vue-next'
import type { Message, ReplyGraph } from '@/types'
import ModalBase from './ModalBase.vue'
import { stripMarkers } from '@/utils/richText'

const props = defineProps<{
  graph:   ReplyGraph | null
  loading: boolean
  myId:    string
}>()
const emit = defineEmits<{ close: []; jumpTo: [dbId: string]; edit: [msg: Message] }>()

const isOwn = (m: Message) => m.authorId === props.myId
const keyOf = (m: Message) => (m as any).dbId || String(m.id)

// Column / row sizing — fixed pixel grid, simple and predictable
const COL_W = 230
const ROW_H = 88
const CARD_W = 200
const CARD_H = 56

// ── Lay the DAG out left→right by longest-path depth ────────────────────────
// Column = longest path from a root (a node with no parents). Each node is
// placed exactly once (a node reachable via several parents no longer
// duplicates). Within a column, nodes stack vertically by send time.
interface LaidNode { msg: Message; col: number; row: number; isTarget: boolean }

const laidOut = computed<LaidNode[]>(() => {
  const g = props.graph
  if (!g || !g.nodes.length) return []
  const nodeByKey = new Map(g.nodes.map(n => [keyOf(n), n]))
  const parents = new Map<string, string[]>()
  g.nodes.forEach(n => parents.set(keyOf(n), []))
  for (const e of g.edges) {
    if (nodeByKey.has(e.from) && nodeByKey.has(e.to)) parents.get(e.to)!.push(e.from)
  }

  const col = new Map<string, number>()
  const computing = new Set<string>()
  const colOf = (k: string): number => {
    if (col.has(k)) return col.get(k)!
    if (computing.has(k)) return 0  // cycle guard (shouldn't happen with replies)
    computing.add(k)
    const ps = parents.get(k) || []
    const c = ps.length ? Math.max(...ps.map(colOf)) + 1 : 0
    computing.delete(k)
    col.set(k, c)
    return c
  }
  g.nodes.forEach(n => colOf(keyOf(n)))

  const buckets = new Map<number, string[]>()
  g.nodes.forEach(n => {
    const c = col.get(keyOf(n))!
    if (!buckets.has(c)) buckets.set(c, [])
    buckets.get(c)!.push(keyOf(n))
  })
  const out: LaidNode[] = []
  for (const [c, keys] of buckets) {
    keys.sort((a, b) => nodeByKey.get(a)!.timestamp - nodeByKey.get(b)!.timestamp)
    keys.forEach((k, i) => out.push({ msg: nodeByKey.get(k)!, col: c, row: i, isTarget: k === g.targetId }))
  }
  return out
})

const maxCol = computed(() => laidOut.value.reduce((m, n) => Math.max(m, n.col), 0))
const maxRow = computed(() => laidOut.value.reduce((m, n) => Math.max(m, n.row), 0))

const nodeStyle = (n: LaidNode) => ({
  left: `${n.col * COL_W}px`,
  top:  `${n.row * ROW_H}px`,
})

// ── Connectors: one curved SVG path per parent→child edge ───────────────────
interface Connector { d: string; key: string }

const connectors = computed<Connector[]>(() => {
  const g = props.graph
  if (!g) return []
  const pos = new Map<string, LaidNode>()
  laidOut.value.forEach(n => pos.set(keyOf(n.msg), n))

  const lines: Connector[] = []
  for (const e of g.edges) {
    const p = pos.get(e.from), c = pos.get(e.to)
    if (!p || !c) continue
    const px = p.col * COL_W + CARD_W
    const py = p.row * ROW_H + CARD_H / 2
    const cx = c.col * COL_W
    const cy = c.row * ROW_H + CARD_H / 2
    const midX = (px + cx) / 2
    lines.push({ key: `${e.from}->${e.to}`, d: `M ${px} ${py} C ${midX} ${py}, ${midX} ${cy}, ${cx} ${cy}` })
  }
  return lines
})

const svgW = computed(() => (maxCol.value + 1) * COL_W)
const svgH = computed(() => (maxRow.value + 1) * ROW_H)

// ── Zoom — the tree can get wide fast with several branches ─────────────────
const zoom = ref(1)
const zoomIn    = () => { zoom.value = Math.min(zoom.value + 0.15, 1.6) }
const zoomOut   = () => { zoom.value = Math.max(zoom.value - 0.15, 0.4) }
const zoomReset = () => { zoom.value = 1 }

const scrollEl = ref<HTMLElement | null>(null)
onMounted(async () => {
  await nextTick()
  if (scrollEl.value) scrollEl.value.scrollLeft = 0
})

const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s

// Render a message whose whole content is a .gif URL as the actual GIF (same
// rule as MessageItem) instead of showing the raw link.
const GIF_URL_RE = /^https?:\/\/\S+\.gif(\?\S*)?$/i
const gifUrl = (c: string): string | null => {
  const t = c.trim()
  return GIF_URL_RE.test(t) ? t : null
}

// ── Per-card context menu (jump / copy / edit) ──────────────────────────────
const ctx = ref<{ x: number; y: number; msg: Message } | null>(null)
const openCtx = (e: MouseEvent, msg: Message) => { ctx.value = { x: e.clientX, y: e.clientY, msg } }
const closeCtx = () => { ctx.value = null }
const ctxJump = () => { if (ctx.value && (ctx.value.msg as any).dbId) emit('jumpTo', (ctx.value.msg as any).dbId); closeCtx() }
const ctxCopy = async () => { if (ctx.value) { try { await navigator.clipboard.writeText(ctx.value.msg.content) } catch { /* ignore */ } } closeCtx() }
const ctxEdit = () => { if (ctx.value) emit('edit', ctx.value.msg); closeCtx() }
</script>

<template>
  <ModalBase width="min(900px, 94vw)" :z="2000" @close="emit('close')">
    <div class="rt-modal" @click.stop>

        <div class="rt-header">
          <div class="rt-header-text">
            <h3>Reply Tree</h3>
            <p>Every branch of replies that led to this point</p>
          </div>
          <div class="rt-header-actions">
            <button class="rt-zoom-btn" @click="zoomOut" v-tip="'Zoom out'"><ZoomOut :size="15" :stroke-width="1.5" /></button>
            <button class="rt-zoom-btn" @click="zoomReset" v-tip="'Reset zoom'"><Expand :size="14" :stroke-width="1.5" /></button>
            <button class="rt-zoom-btn" @click="zoomIn" v-tip="'Zoom in'"><ZoomIn :size="15" :stroke-width="1.5" /></button>
            <button class="rt-close" @click="emit('close')"><X :size="18" :stroke-width="1.5" /></button>
          </div>
        </div>

        <div class="rt-body" ref="scrollEl">
          <div v-if="loading" class="rt-loading">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5865f2" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            Tracing the conversation…
          </div>

          <div v-else-if="!graph || !graph.nodes.length" class="rt-empty">
            <div class="rt-empty-icon">🔗</div>
            <p>Nothing to show</p>
          </div>

          <div v-else class="rt-canvas-wrap">
            <div class="rt-canvas" :style="{ width: svgW + 'px', height: svgH + 'px', transform: `scale(${zoom})`, transformOrigin: 'top left' }">

              <!-- Connector lines drawn first, underneath the cards -->
              <svg class="rt-svg" :width="svgW" :height="svgH">
                <path
                  v-for="c in connectors" :key="c.key"
                  :d="c.d" class="rt-edge"
                />
              </svg>

              <!-- Cards positioned on the grid -->
              <div
                v-for="n in laidOut" :key="keyOf(n.msg)"
                class="rt-card"
                :class="{ own: isOwn(n.msg), target: n.isTarget }"
                :style="nodeStyle(n)"
                @click="(n.msg as any).dbId && emit('jumpTo', (n.msg as any).dbId)"
                @contextmenu.prevent.stop="openCtx($event, n.msg)"
              >
                <div class="rt-card-meta">
                  <span class="rt-card-author">{{ n.msg.author }}</span>
                  <span class="rt-card-time">{{ n.msg.time }}</span>
                </div>
                <img v-if="gifUrl(n.msg.content)" :src="gifUrl(n.msg.content)!" class="rt-card-gif" alt="GIF" loading="lazy" />
                <p v-else class="rt-card-content">{{ truncate(stripMarkers(n.msg.content), 70) }}</p>
                <span v-if="n.isTarget" class="rt-card-badge">you held here</span>
              </div>

            </div>
          </div>
        </div>

        <div class="rt-footer">
          <span>Click a message to jump · right-click for more · scroll to pan</span>
        </div>
      </div>

      <!-- Per-card context menu -->
      <div v-if="ctx" class="rt-ctx-overlay" @click="closeCtx" @contextmenu.prevent="closeCtx">
        <div class="rt-ctx" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }" @click.stop>
          <button class="rt-ctx-item" @click="ctxJump">Jump to message</button>
          <button class="rt-ctx-item" @click="ctxCopy">Copy text</button>
          <button v-if="isOwn(ctx.msg)" class="rt-ctx-item" @click="ctxEdit">Edit message</button>
        </div>
    </div>
  </ModalBase>
</template>

<style scoped>
/* ModalBase owns the overlay, box chrome and the phone sheet; only the
   inner layout belongs here now. */
.rt-modal { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
@keyframes rt-fade { from{opacity:0} to{opacity:1} }
@keyframes rt-pop { from{opacity:0;transform:scale(.93) translateY(10px)} to{opacity:1;transform:scale(1) translateY(0)} }

.rt-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 16px 18px 14px;
  border-bottom: 1px solid rgba(255,255,255,.06);
  flex-shrink: 0;
}
.rt-header-text h3 { font-size: 16px; font-weight: 700; color: var(--text-strong); }
.rt-header-text p  { font-size: 12.5px; color: var(--text-3); margin-top: 2px; }
.rt-header-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.rt-zoom-btn {
  width: 28px; height: 28px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background .12s, color .12s;
}
.rt-zoom-btn:hover { background: var(--hover-strong); color: var(--text-strong); }
.rt-close {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background .12s, color .12s; margin-left: 6px;
}
.rt-close:hover { background: var(--hover-strong); color: var(--text-strong); }

.rt-body { flex: 1; overflow: auto; padding: 24px; position: relative; }

.rt-loading, .rt-empty {
  display: flex; flex-direction: column; align-items: center;
  gap: 10px; padding: 48px 16px; color: var(--text-faint); text-align: center;
}
.rt-loading { flex-direction: row; justify-content: center; }
.rt-empty-icon { font-size: 32px; }
.rt-empty p { font-size: 14px; font-weight: 600; color: var(--text-1); }

@keyframes spin { to { transform: rotate(360deg) } }
.spin { animation: spin .8s linear infinite; }

/* The scaled canvas holding both the SVG connector layer and the cards */
.rt-canvas-wrap { min-width: 100%; min-height: 100%; }
.rt-canvas { position: relative; transition: transform .15s ease; }

.rt-svg { position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible; }
.rt-edge {
  fill: none;
  stroke: rgba(255,255,255,.14);
  stroke-width: 2;
}

.rt-card {
  position: absolute;
  width: 200px;
  padding: 9px 12px;
  border-radius: 9px;
  background: var(--bg-raised);
  border: 1px solid rgba(255,255,255,.06);
  cursor: pointer;
  transition: background .12s, border-color .12s, transform .1s;
}
.rt-card:hover { background: #25272c; border-color: rgba(255,255,255,.14); transform: translateY(-1px); }
.rt-card.own { background: rgba(var(--accent-rgb),.1); border-color: rgba(var(--accent-rgb),.25); }
.rt-card.own:hover { background: rgba(var(--accent-rgb),.16); }
.rt-card.target {
  border-color: rgba(var(--accent-rgb),.6);
  box-shadow: 0 0 0 1px rgba(var(--accent-rgb),.3), 0 4px 16px rgba(var(--accent-rgb),.2);
}

.rt-card-meta { display: flex; align-items: baseline; gap: 6px; margin-bottom: 3px; }
.rt-card-author { font-size: 12.5px; font-weight: 700; color: var(--text-strong); }
.rt-card-time   { font-size: 10.5px; color: var(--text-faint); }
.rt-card-content {
  font-size: 12.5px; color: #c4c7cd; line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.rt-card-gif { display: block; max-width: 100%; max-height: 90px; border-radius: 6px; object-fit: cover; }

/* Context menu */
.rt-ctx-overlay { position: fixed; inset: 0; z-index: 2100; }
.rt-ctx {
  position: absolute; min-width: 168px;
  background: var(--bg-floor); border: 1px solid rgba(0,0,0,.4); border-radius: 8px;
  padding: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.6);
}
.rt-ctx-item {
  display: block; width: 100%; text-align: left;
  padding: 8px 10px; border-radius: 5px;
  font-size: 13.5px; font-weight: 500; color: var(--text-2);
  transition: background .12s, color .12s;
}
.rt-ctx-item:hover { background: var(--accent); color: var(--text-on-accent); }
.rt-card-badge {
  display: inline-block; margin-top: 5px;
  font-size: 9.5px; font-weight: 700; color: #8d96f8;
  background: rgba(var(--accent-rgb),.18); padding: 1px 6px; border-radius: 4px;
  letter-spacing: .3px; text-transform: uppercase;
}

.rt-footer {
  padding: 9px 18px; border-top: 1px solid rgba(255,255,255,.06);
  font-size: 11.5px; color: var(--text-faint); text-align: center; flex-shrink: 0;
}

.rt-body::-webkit-scrollbar { height: 6px; width: 6px; }
.rt-body::-webkit-scrollbar-track { background: transparent; }
.rt-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 3px; }
</style>