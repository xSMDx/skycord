<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import MessageItem    from './MessageItem.vue'
import TypingIndicator from './TypingIndicator.vue'
import type { Message } from '@/types'

const props = defineProps<{ messages: Message[]; myId: string; typers: string[]; channelName: string; isDM: boolean; dmPartner?: { name: string; avatar: string | null }; group?: { name: string; avatar?: string | null }; loadingMsgs: boolean }>()
const emit  = defineEmits<{
  react:         [msgId: number, emoji: string]
  openEmoji:     [msgId: number]
  edit:          [msg: Message]
  openCtx:       [e: MouseEvent, msg: Message]
  clickAuthor:   [authorId: string]
  reply:         [msg: Message]
  openReplyTree: [msg: Message]
  jumpToMessage: [dbId: string]
  groupJoined:   [group: any]
}>()

const el          = ref<HTMLElement | null>(null)
const hoveredId   = ref<number | null>(null)
const editingId   = ref<number | null>(null)
const editingText = ref('')

// Ids present the moment history finished loading for the current chat — these
// are excluded from the send/receive pop-in animation so opening a chat with 50
// messages doesn't animate all 50 in at once. Only ids that show up AFTER this
// snapshot (genuine new sends or incoming messages) get the animation.
const settledIds = ref<Set<number>>(new Set())

watch(() => props.loadingMsgs, (loading, wasLoading) => {
  if (wasLoading && !loading) {
    settledIds.value = new Set(props.messages.map(m => m.id))
  }
})
// Also capture on mount in case loadingMsgs starts false (e.g. server channel
// view, which doesn't go through the same REST loading flow as DMs)
if (!props.loadingMsgs) settledIds.value = new Set(props.messages.map(m => m.id))

const isNewMessage = (id: number) => !settledIds.value.has(id)

// Interleave per-day date dividers with messages. A divider is emitted whenever
// the calendar day changes (and before the first message).
type Row =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'msg'; key: number; msg: Message; idx: number }
const dayLabel = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  let lastDay = ''
  props.messages.forEach((msg, idx) => {
    const day = new Date(msg.timestamp).toDateString()
    if (day !== lastDay) {
      lastDay = day
      out.push({ kind: 'divider', key: `d-${day}`, label: dayLabel(msg.timestamp) })
    }
    out.push({ kind: 'msg', key: msg.id, msg, idx })
  })
  return out
})

// Stack consecutive messages from the same author into one group (hides the
// repeated avatar/name) — but only when they're close in time, on the same day,
// and neither is a system log. Mirrors Discord's grouping.
const STACK_WINDOW_MS = 7 * 60 * 1000
const isConsecutive = (i: number) => {
  if (i <= 0) return false
  const cur = props.messages[i], prev = props.messages[i - 1]
  if (cur.kind === 'system' || prev.kind === 'system') return false
  if (cur.authorId !== prev.authorId) return false
  if (new Date(cur.timestamp).toDateString() !== new Date(prev.timestamp).toDateString()) return false
  return (cur.timestamp - prev.timestamp) < STACK_WINDOW_MS
}
const isOwn         = (m: Message) => m.authorId === props.myId

watch(() => props.messages.length, async () => { await nextTick(); if (el.value) el.value.scrollTop = el.value.scrollHeight })

const scrollToBottom = async () => { await nextTick(); if (el.value) el.value.scrollTop = el.value.scrollHeight }

const startEdit = (msg: Message) => { editingId.value = msg.id; editingText.value = msg.content }
const startEditExternal = (msg: Message) => startEdit(msg)
defineExpose({ scrollToBottom, startEditExternal })

const saveEdit  = () => {
  if (editingId.value === null || !editingText.value.trim()) return
  const msg = props.messages.find(m => m.id === editingId.value)
  if (msg) emit('edit', { ...msg, content: editingText.value.trim() })
  editingId.value = null; editingText.value = ''
}
const cancelEdit = () => { editingId.value = null; editingText.value = '' }
</script>
<template>
  <div class="ml" ref="el">
    <div class="welcome">
      <template v-if="isDM && dmPartner">
        <div class="dm-av"><img :src="dmPartner.avatar ?? undefined" :alt="dmPartner.name"/></div>
        <h3>{{ dmPartner.name }}</h3>
        <p>This is the beginning of your direct message history with <strong>{{ dmPartner.name }}</strong>.</p>
      </template>
      <template v-else-if="group">
        <div class="dm-av group-av">
          <img v-if="group.avatar" :src="group.avatar" :alt="group.name"/>
          <svg v-else width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <h3>{{ group.name }}</h3>
        <p>Welcome to the beginning of the <strong>{{ group.name }}</strong> group.</p>
      </template>
      <template v-else>
        <div class="ch-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg></div>
        <h3>Welcome to #{{ channelName }}!</h3>
        <p>This is the very beginning of the <strong>#{{ channelName }}</strong> channel.</p>
      </template>
    </div>

    <div v-if="loadingMsgs" class="ml-loading">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5865f2" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
      Loading messages…
    </div>
    <div v-else-if="messages.length===0 && !isDM" class="ml-empty"><p>No messages yet. Say something! 👋</p></div>

    <TransitionGroup :name="messages.length ? 'msg-pop' : ''" tag="div" class="msg-list-inner">
      <template v-for="row in rows" :key="row.key">
        <div v-if="row.kind === 'divider'" class="day-divider"><span>{{ row.label }}</span></div>
        <MessageItem
          v-else
          :msg="row.msg" :idx="row.idx"
          :consecutive="isConsecutive(row.idx)"
          :isOwn="isOwn(row.msg)"
          :isEditing="editingId===row.msg.id"
          :editText="editingText"
          :hoveredId="hoveredId"
          :myId="myId"
          :class="{ 'msg-no-anim': !isNewMessage(row.msg.id) }"
          @hover="hoveredId=$event"
          @react="(msgId,emoji) => emit('react',msgId,emoji)"
          @openEmoji="(msgId) => emit('openEmoji',msgId)"
          @edit="startEdit($event)"
          @editChange="editingText=$event"
          @editSave="saveEdit"
          @editCancel="cancelEdit"
          @openCtx="(e,msg) => emit('openCtx',e,msg)"
          @clickAuthor="(id) => emit('clickAuthor',id)"
          @reply="(msg) => emit('reply',msg)"
          @openReplyTree="(msg) => emit('openReplyTree',msg)"
          @jumpToMessage="(dbId) => emit('jumpToMessage',dbId)"
          @groupJoined="(g) => emit('groupJoined',g)"
        />
      </template>
    </TransitionGroup>

    <TypingIndicator :typers="typers" />
  </div>
</template>
<style scoped>
*{box-sizing:border-box;margin:0;padding:0}img{display:block;width:100%;height:100%;object-fit:cover}
.ml{flex:1;overflow-y:auto;padding:8px 0 0;display:flex;flex-direction:column}
.welcome{padding:20px 16px 16px;border-bottom:1px solid rgba(255,255,255,.05);margin-bottom:8px}
.ch-icon{width:52px;height:52px;border-radius:14px;background:var(--accent);display:flex;align-items:center;justify-content:center;margin-bottom:12px}
.dm-av{width:64px;height:64px;border-radius:50%;overflow:hidden;margin-bottom:14px;border:3px solid var(--bg-panel)}
.group-av{display:flex;align-items:center;justify-content:center;background:var(--accent);border:none}
.group-av svg{width:30px;height:30px}
.welcome h3{font-size:26px;font-weight:800;color: var(--text-strong);margin-bottom:4px}
.welcome p{font-size:14px;color:var(--text-3)}
.welcome strong{color: var(--text-strong)}
.ml-loading,.ml-empty{display:flex;align-items:center;gap:10px;padding:24px 16px;color:var(--text-faint);font-size:14px}
@keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin .8s linear infinite;flex-shrink:0}
.ml::-webkit-scrollbar{width:4px}.ml::-webkit-scrollbar-track{background:transparent}.ml::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px}

/* New message pop-in — only applies to genuinely new sends/receives via the
   msg-no-anim escape hatch set by MessageList for anything present at the
   moment a chat's history finished loading (see settledIds in the script). */
.msg-list-inner { display: contents; }

/* Per-day date divider */
.day-divider{display:flex;align-items:center;margin:14px 16px 6px;height:0}
.day-divider::before,.day-divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.07)}
.day-divider span{padding:0 10px;font-size:11px;font-weight:700;color:var(--text-3);white-space:nowrap}
.msg-pop-enter-active { transition: opacity .22s ease, transform .22s cubic-bezier(.34,1.56,.64,1); }
.msg-pop-enter-from   { opacity: 0; transform: translateY(8px) scale(.97); }
.msg-no-anim.msg-pop-enter-active { transition: none; }
.msg-no-anim.msg-pop-enter-from   { opacity: 1; transform: none; }
</style>