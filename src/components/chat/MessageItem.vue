<script setup lang="ts">
import { computed } from 'vue'
import { Pencil, CornerUpLeft, Ellipsis, UserPlus, ArrowRight, ArrowLeft, PhoneCall, PhoneOff } from 'lucide-vue-next'
import type { Message } from '@/types'
import GroupInviteCard from './GroupInviteCard.vue'
import ServerInviteCard from './ServerInviteCard.vue'
import ThemeCard from './ThemeCard.vue'
import { renderMessage, stripMarkers } from '@/utils/richText'
import { appearance } from '@/composables/useAppearance'

const compact = computed(() => appearance.msgLayout === 'compact')

const props = defineProps<{ msg: Message; idx: number; consecutive: boolean; isOwn: boolean; isEditing: boolean; editText: string; hoveredId: number | null; myId: string }>()
const emit  = defineEmits<{
  hover:         [id: number | null]
  react:         [msgId: number, emoji: string]
  openEmoji:     [msgId: number]
  edit:          [msg: Message]
  editChange:    [text: string]
  editSave:      []
  editCancel:    []
  openCtx:       [e: MouseEvent, msg: Message]
  clickAuthor:   [authorId: string]
  reply:         [msg: Message]
  openReplyTree: [msg: Message]
  jumpToMessage: [dbId: string]
  groupJoined:   [group: any]
  serverJoined:  [server: any, channel: { id: string; name: string } | null]
}>()

// Both call logs share systemType 'call', so the start/end distinction comes
// from the content the server writes ("… started a call" vs "Call ended").
const callEnded = computed(() =>
  props.msg.systemType === 'call' && /\bended\b/i.test(props.msg.content || ''))

/**
 * Tooltip for a reaction pill.
 *
 * Discord names the reactors ("reacted by SMD"). We can't yet: the server sends
 * `userIds` with every reaction, but the client's Reaction type drops them and
 * this component only receives `myId` — there's no id→name map here to resolve
 * against. Rather than print a name we haven't got, this says what's actually
 * known. Plumbing userIds through the type and passing a member map would make
 * the full Discord version possible.
 */
const reactionTip = (r: { emoji: string; count: number; reacted: boolean }) => {
  const others = r.reacted ? r.count - 1 : r.count
  if (r.reacted && others === 0) return `${r.emoji}  you reacted`
  if (r.reacted) return `${r.emoji}  you and ${others} ${others === 1 ? 'other' : 'others'} reacted`
  return `${r.emoji}  ${r.count} ${r.count === 1 ? 'reaction' : 'reactions'}`
}

// System log line (join/leave/add/rename/icon/call) — icon + colour per type.
const systemIcon = computed(() => {
  switch (props.msg.systemType) {
    case 'add':   return UserPlus
    case 'join':  return ArrowRight
    case 'leave': return ArrowLeft
    case 'call':  return callEnded.value ? PhoneOff : PhoneCall
    default:      return Pencil   // rename / icon
  }
})

// A message whose ENTIRE content is a .gif URL (what GIF picker sends —
// see ChatApp's handleGifSelect) renders as an actual image instead of text.
// Matches any source and tolerates query params, which some GIF CDNs append.
const GIF_URL_RE = /^https?:\/\/\S+\.gif(\?\S*)?$/i
const gifUrl = (content: string): string | null => {
  const trimmed = content.trim()
  return GIF_URL_RE.test(trimmed) ? trimmed : null
}

// Emoji-only messages (1-3 emoji, nothing else) render larger — matches the
// convention Discord/Slack/Telegram all use. Built from a proper "emoji cluster"
// pattern (pictographic + optional skin-tone modifier + optional variation selector,
// repeated via ZWJ for sequences like family emoji 👨‍👩‍👧) rather than a naive
// character-count heuristic, which misfires constantly on real emoji since most
// are multiple Unicode codepoints, not one.
const EMOJI_CLUSTER =
  '\\p{Extended_Pictographic}(\\p{Emoji_Modifier})?(\\uFE0F)?' +
  '(\\u200d\\p{Extended_Pictographic}(\\p{Emoji_Modifier})?(\\uFE0F)?)*'
const EMOJI_ONLY_RE = new RegExp(`^(${EMOJI_CLUSTER}\\s*){1,3}$`, 'u')
const isJumboEmoji = (content: string) => EMOJI_ONLY_RE.test(content.trim())

// Detect invite URLs — extract code and render embedded card
const INVITE_RE = /https?:\/\/[^/\s]+\/invite\/([A-Za-z0-9_-]{6,12})\/?/
const inviteCode = computed(() => {
  const m = INVITE_RE.exec(props.msg.content)
  return m?.[1] ?? null
})

// Server invites use /join/<code>; /invite/<code> above is group invites.
const JOIN_RE = /https?:\/\/[^/\s]+\/join\/([A-Za-z0-9_-]{6,16})\/?/
const joinCode = computed(() => JOIN_RE.exec(props.msg.content)?.[1] ?? null)

// Detect a shared theme — inline code (sykord-theme:…) or a /theme/<slug> link.
const THEME_CODE_RE = /sykord-theme:[A-Za-z0-9_-]+/
const THEME_LINK_RE = /https?:\/\/[^/\s]+\/theme\/([A-Za-z0-9_-]{6,16})\/?/
const themeRef = computed<{ code?: string; slug?: string } | null>(() => {
  const code = THEME_CODE_RE.exec(props.msg.content)?.[0]
  if (code) return { code }
  const slug = THEME_LINK_RE.exec(props.msg.content)?.[1]
  if (slug) return { slug }
  return null
})
// The ugly base64 code is hidden from the rendered text (the card replaces it);
// links stay visible like invite links do.
const displayContent = computed(() =>
  themeRef.value?.code ? props.msg.content.replace(THEME_CODE_RE, '').trim() : props.msg.content,
)

// @everyone pings highlight the whole message row (Discord-style gold rail + tint).
const hasEveryone = computed(() => /@everyone\b/.test(props.msg.content || ''))

// Hold-to-view-tree gesture on the reply pill (Telegram-style long-press).
// Short tap → jump to the original message. Hold past the threshold → open the full chain.
const HOLD_MS = 350
let holdTimer: ReturnType<typeof setTimeout> | null = null
let wasHeld   = false

const onReplyPillDown = () => {
  wasHeld = false
  holdTimer = setTimeout(() => {
    wasHeld = true
    emit('openReplyTree', props.msg)
  }, HOLD_MS)
}
const onReplyPillUp = (parentId: string) => {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
  if (!wasHeld) emit('jumpToMessage', parentId)
}
const onReplyPillLeave = () => {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
}
</script>
<template>
  <!-- System log line (group rename / icon / add / join / leave) -->
  <div v-if="msg.kind === 'system'" class="msg-system" :class="['sys-' + (msg.systemType || 'rename'), { 'call-ended': callEnded }]"
       @contextmenu.prevent="emit('openCtx', $event, msg)">
    <span class="msg-system-icon"><component :is="systemIcon" :size="16" :stroke-width="2.25" /></span>
    <span class="msg-system-text">{{ msg.content }}</span>
    <span v-if="msg.systemType === 'rename' || msg.systemType === 'icon'" class="msg-system-link">Edit Group</span>
    <span class="msg-system-time">{{ msg.time }}</span>
  </div>

  <div v-else class="msg" :class="{ consecutive, own: isOwn, compact, failed: (msg as any).failed, mentioned: hasEveryone }"
    :data-msg-id="msg.id"
    @mouseenter="emit('hover', msg.id)" @mouseleave="emit('hover', null)"
    @contextmenu.prevent="emit('openCtx', $event, msg)">

    <div class="msg-left">
      <div v-if="!consecutive && !compact" class="msg-av" @click.stop="emit('clickAuthor', msg.authorId)">
        <Avatar :src="msg.avatar" :alt="msg.author" :crop="(msg as any).avatarCrop" />
      </div>
      <span v-else class="msg-ts">{{ msg.time }}</span>
    </div>

    <div class="msg-body">
      <!-- Reply previews — one pill per parent (multi-parent). Tap to jump,
           hold to see the full chain. Stacked pills share a left rail. -->
      <div v-if="msg.replyTo?.length" class="reply-previews" :class="{ multi: msg.replyTo.length > 1 }">
        <div v-for="p in msg.replyTo" :key="p.id" class="reply-preview"
          @mousedown.stop="onReplyPillDown"
          @mouseup.stop="onReplyPillUp(p.id)"
          @mouseleave="onReplyPillLeave"
          v-tip="'Click to jump · hold to see reply chain'">
          <svg class="reply-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 17l-5-5 5-5M4 12h11a4 4 0 0 1 4 4v1"/>
          </svg>
          <span class="reply-author">{{ p.author }}</span>
          <span class="reply-content">{{ stripMarkers(p.content) }}</span>
        </div>
      </div>

      <div v-if="!consecutive && !compact" class="msg-meta">
        <span class="msg-author" @click.stop="emit('clickAuthor', msg.authorId)">{{ msg.author }}</span>
        <span class="msg-time">{{ msg.time }}</span>
        <span v-if="msg.edited"  class="msg-edited">(edited)</span>
        <span v-if="msg.pinned"  class="msg-pin">📌</span>
        <span v-if="(msg as any).failed" class="msg-fail">Failed</span>
      </div>

      <template v-if="!isEditing">
        <span v-if="compact" class="msg-author msg-author-inline" @click.stop="emit('clickAuthor', msg.authorId)">{{ msg.author }}</span>
        <img v-if="gifUrl(msg.content)" :src="gifUrl(msg.content)!" class="msg-gif" alt="GIF" loading="lazy" />
        <p v-else-if="displayContent" class="msg-text" :class="{ jumbo: isJumboEmoji(displayContent) }" v-html="renderMessage(displayContent)" />
        <span v-if="compact && msg.edited" class="msg-edited">(edited)</span>
      </template>
      <template v-else>
        <div class="edit-wrap">
          <input class="edit-input" :value="editText"
            @input="emit('editChange', ($event.target as HTMLInputElement).value)"
            @keydown.enter.exact.prevent="emit('editSave')"
            @keydown.esc="emit('editCancel')" autofocus />
          <div class="edit-hint">
            esc to <button class="el" @click="emit('editCancel')">cancel</button>
            · enter to <button class="el" @click="emit('editSave')">save</button>
          </div>
        </div>
      </template>

      <GroupInviteCard v-if="inviteCode" :code="inviteCode" @joined="emit('groupJoined', $event)" />
      <ServerInviteCard v-if="joinCode" :code="joinCode" @joined="(s, ch) => emit('serverJoined', s, ch)" />
      <ThemeCard v-if="themeRef" v-bind="themeRef" />

      <div v-if="msg.reactions?.length" class="msg-reactions">
        <button v-for="r in msg.reactions" :key="r.emoji"
          class="rp" :class="{ active: r.reacted }"
          v-tip="reactionTip(r)"
          @click.stop="emit('react', msg.id, r.emoji)">
          {{ r.emoji }} <span>{{ r.count }}</span>
        </button>
        <button class="rp-add" v-tip="'Add Reaction'" @click.stop="emit('openEmoji', msg.id)">+</button>
      </div>
    </div>

    <div v-show="hoveredId === msg.id && !isEditing" class="msg-actions"
      @mouseenter="emit('hover', msg.id)" @click.stop>
      <button class="ap" @click.stop="emit('openEmoji', msg.id)" v-tip="'React'">😀</button>
      <button class="ap" @click.stop="emit('reply', msg)" v-tip="'Reply'"><CornerUpLeft :size="15" :stroke-width="1.5"/></button>
      <button v-if="isOwn" class="ap" @click.stop="emit('edit', msg)" v-tip="'Edit'"><Pencil :size="15" :stroke-width="1.5"/></button>
      <button class="ap" @click.stop="emit('openCtx', $event, msg)" v-tip="'More'"><Ellipsis :size="15" :stroke-width="1.5"/></button>
    </div>
  </div>
</template>
<style scoped>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
button{background:none;border:none;cursor:pointer;color:inherit;font:inherit}
img{display:block;width:100%;height:100%;object-fit:cover}
/* System log line */
.msg-system{display:flex;align-items:center;gap:8px;padding:3px 48px 3px 18px;font-size:13.5px;color:var(--text-3)}
.msg-system-icon{display:flex;align-items:center;justify-content:center;width:22px;color:var(--text-3);flex-shrink:0}
.msg-system-text{color:var(--text-2)}
.msg-system.sys-join .msg-system-icon{color:#23a55a}
.msg-system.sys-leave .msg-system-icon{color:#f23f43}
.msg-system.sys-add .msg-system-icon{color:#23a55a}
/* Call logs: green when a call starts, red once it ends */
.msg-system.sys-call .msg-system-icon{color:#23a55a}
.msg-system.sys-call.call-ended .msg-system-icon{color:#f23f43}
.msg-system-link{color:#00a8fc;font-weight:500;cursor:pointer}
.msg-system-link:hover{text-decoration:underline}
.msg-system-time{font-size:11px;color:#5c5e66;margin-left:2px}

.msg{display:flex;align-items:flex-start;padding:var(--msg-pad-y, 1px) 48px var(--msg-pad-y, 1px) 16px;position:relative;transition: background var(--dur-1) var(--ease-out)}
.msg:hover{background:rgba(0,0,0,.1)}
.msg.mentioned{background:var(--mention-row-bg);box-shadow:inset 2px 0 0 var(--mention-row-bar)}
.msg.mentioned:hover{background:var(--mention-row-bg-hover)}
.msg:not(.consecutive){margin-top:var(--msg-group-gap, 17px)}
.msg.consecutive{padding-top:0}
.msg.failed .msg-text{color:#f08080}
.msg-left{width:56px;flex-shrink:0;display:flex;align-items:flex-start;justify-content:center;padding-top:4px}
.msg-av{width:32px;height:32px;border-radius:50%;overflow:hidden;cursor:pointer;flex-shrink:0;background:var(--bg-panel);transition: transform var(--dur-2) var(--ease-out)}
.msg:hover .msg-av{transform:scale(1.06)}
.msg-ts{font-size:10px;color:transparent;line-height:22px;padding-left:2px;transition: color var(--dur-1) var(--ease-out);white-space:nowrap}
.msg:hover .msg-ts{color:#4e5058}
.msg-body{flex:1;min-width:0;padding-top:3px}
.reply-previews{display:flex;flex-direction:column;gap:1px;margin-bottom:4px}
.reply-preview{display:flex;align-items:center;gap:6px;margin-left:6px;font-size:13px;color:#8a8e96;overflow:hidden;position:relative;padding-left:14px;cursor:pointer;border-radius:4px;transition: background var(--dur-1) var(--ease-out);width:fit-content;max-width:100%}
.reply-preview:hover{background:var(--hover)}
.reply-preview:active{background:rgba(255,255,255,.08)}
.reply-preview::before{content:'';position:absolute;left:0;top:50%;width:10px;height:12px;border-left:2px solid #4e5058;border-top:2px solid #4e5058;border-radius:6px 0 0 0}
.reply-icon{flex-shrink:0;color:var(--text-faint);display:none}
.reply-author{color:var(--accent-text);font-weight:600;white-space:nowrap}
.reply-content{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9a9ea6}
.msg-meta{display:flex;align-items:baseline;gap:8px;margin-bottom:2px;flex-wrap:wrap}
.msg-author{font-size:15px;font-weight:700;color: var(--text-strong);cursor:pointer;transition: color var(--dur-1) var(--ease-out)}
.msg-author:hover{color:var(--name-hover, #8d96f8)}
.msg-time{font-size:11px;color:#4e5058}
.msg-edited{font-size:10px;color:var(--text-faint);font-style:italic}
.msg-pin{font-size:11px}
.msg-fail{font-size:11px;color:#f08080}
.msg-text{font-size:var(--msg-font-size, 15px);line-height:1.5;color:var(--text-1);word-break:break-word}
.msg-gif{max-width:320px;max-height:240px;border-radius:8px;display:block;cursor:pointer}
.msg-text.jumbo{font-size:42px;line-height:1.25}
.msg-text :deep(.mention){color:var(--mention-fg);background:var(--mention-bg);padding:0 3px;border-radius:3px;cursor:pointer;font-weight:500}
.msg-text :deep(.emoji){width:1.35em;height:1.35em;vertical-align:-.28em;margin:0 .02em;object-fit:contain;display:inline-block}
.msg-text :deep(.msg-link){color:#00a8fc;text-decoration:var(--link-decoration, none);word-break:break-all}
.msg-text :deep(.msg-link):hover{text-decoration:underline}

/* Compact message display — single line: [time] Author text */
.msg.compact{align-items:baseline;padding-top:1px;padding-bottom:1px}
.msg.compact:not(.consecutive){margin-top:6px}
.msg.compact .msg-left{width:auto;min-width:46px;justify-content:flex-end;padding:0 8px 0 0}
.msg.compact .msg-ts{color:#72767d;line-height:1.5}
.msg.compact:hover .msg-ts{color:#b5bac1}
.msg.compact .msg-body{padding-top:0}
.msg-author-inline{display:inline;margin-right:8px;font-size:var(--msg-font-size, 15px);line-height:1.5;vertical-align:baseline}
.msg.compact .msg-text{display:inline}
.msg-text :deep(strong){font-weight:700;color: var(--text-strong)}
.msg-text :deep(em){font-style:italic}
.msg-text :deep(u){text-decoration:underline}
.msg-text :deep(s){text-decoration:line-through;color:#9a9ea6}
.msg-text :deep(.mention-all){color: var(--mention-all-fg);background:var(--mention-all-bg);padding:0 3px;border-radius:3px;font-weight:600}
.msg-text :deep(.msg-time-token){background:var(--time-token-bg);color:var(--time-token-fg);padding:0 4px;border-radius:3px;font-weight:500;cursor:default}
.msg-text :deep(.msg-bq){border-left:3px solid #4e5058;padding:1px 0 1px 10px;margin:2px 0;color:#c4c7cd}
.msg-text :deep(.msg-cb){display:block;background:var(--bg-input);border:1px solid rgba(255,255,255,.08);border-radius:5px;padding:7px 10px;margin:3px 0;font-family: var(--font-mono);font-size:13px;color:#e3e3e3;white-space:pre-wrap;word-break:break-word}
.msg-text :deep(.ic){font-family: var(--font-mono);font-size:13px;background:rgba(0,0,0,.3);padding:1px 4px;border-radius:3px;color:#e3e3e3}
.edit-wrap{display:flex;flex-direction:column;gap:4px}
.edit-input{width:100%;padding:8px 12px;border-radius:8px;background:#40444b;border:1.5px solid rgba(var(--accent-rgb),.6);font-size:15px;color:var(--text-1);outline:none;font-family:inherit}
.edit-hint{font-size:12px;color:var(--text-faint)}
.el{color:var(--accent);font-size:12px;font-weight:600}
.el:hover{text-decoration:underline}
.msg-reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.rp{display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:2px 7px;font-size:14px;cursor:pointer;transition: background var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out)}
.rp span{font-size:12px;font-weight:600;color:var(--text-2)}
.rp:hover{background:var(--hover-strong);transform:scale(1.08)}
.rp.active{background:rgba(var(--accent-rgb),.2);border-color:rgba(var(--accent-rgb),.5)}
.rp.active span{color:#8d96f8}
.rp-add{width:24px;height:24px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--text-3);cursor:pointer;transition: background var(--dur-1) var(--ease-out)}
.rp-add:hover{background:var(--hover-strong);color: var(--text-strong)}
.msg-actions{position:absolute;right:10px;top:-16px;background:var(--bg-panel);border:1px solid rgba(255,255,255,.08);border-radius:7px;display:flex;gap:1px;padding:3px;box-shadow:0 4px 14px rgba(0,0,0,.4);z-index:10}
.ap{width:28px;height:28px;border-radius:5px;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:16px;transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out)}
.ap:hover{background:var(--hover-strong);color:var(--text-1);transform:scale(1.15)}
.ap:active{transform:scale(.9)}
</style>