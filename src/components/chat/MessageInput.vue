<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  Paperclip, Smile, Send, X, CornerUpLeft, Timer,
  Bold, Italic, Underline, Strikethrough, Quote, Code, Link,
} from 'lucide-vue-next'
import AutocompletePopup from './AutocompletePopup.vue'
import TimeTokenPicker from './TimeTokenPicker.vue'
import { slashCommands, matchCommands } from '@/composables/useChatCommands'
import { appearance } from '@/composables/useAppearance'

interface AcItem { key: string; title: string; subtitle?: string; glyph?: string; avatar?: string }

const props = defineProps<{
  modelValue:    string
  placeholder:   string
  sending:       boolean
  replyTargets?: { id: string; author: string }[]
  members?:      { id: string; name: string; username?: string; avatar?: string }[]
  /** The active channel's slowmode in seconds. 0 (or absent) means off — DMs
   *  and groups never have one. */
  slowmode?:      number
  /** The server owner, who the API lets through regardless. Told rather than
   *  left to wonder why a timer they were warned about never appears. */
  slowmodeExempt?: boolean
  /** Epoch ms until this person may post again here. 0 = free to send. */
  cooldownUntil?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [v: string]
  send:                []
  typing:              []
  openEmoji:           []
  openGif:             []
  clearReply:          [id: string]
  clearAllReply:       []
}>()

/**
 * A textarea, not an input.
 *
 * onKeydown has always let Shift+Enter through so it could insert a
 * newline -- but this was <input type="text">, which cannot hold one, so
 * the branch did nothing and multi-line messages were impossible to write
 * even though the renderer displays them fine. The composer also stayed one
 * line tall no matter how much you typed, scrolling sideways.
 */
const inputEl = ref<HTMLTextAreaElement | null>(null)
const setValue = (v: string, caret = v.length) => {
  emit('update:modelValue', v)
  nextTick(() => { inputEl.value?.focus(); inputEl.value?.setSelectionRange(caret, caret) })
}

// ── Selection formatting toolbar ────────────────────────────────────────────
// Desktop opens it by right-clicking a selection. Touch has no right-click, so
// the whole formatting feature was unreachable on a phone.
const toolbar = ref<{ x: number; y: number } | null>(null)
const onContextMenu = (e: MouseEvent) => {
  const el = inputEl.value; if (!el) return
  const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0
  if (end <= start) return            // no selection → allow native menu
  e.preventDefault()
  toolbar.value = { x: e.clientX, y: e.clientY }
}

/*
 * Touch selection.
 *
 * Two taps select the word under the finger, three select everything — the same
 * grammar as a mouse, which is what people already expect from a text field.
 * We implement it rather than relying on the browser because a double-tap on
 * mobile is just as likely to be interpreted as zoom, and the result differs
 * per engine.
 *
 * The toolbar is then anchored to the INPUT, not to the touch point: a finger
 * has no cursor, and a menu under the fingertip is a menu you're covering.
 */
const TAP_WINDOW = 320   // ms within which taps count as one gesture
const TAP_SLOP   = 12    // px of movement still considered a tap

let tapCount = 0
let lastTapAt = 0
let tapX = 0, tapY = 0
let tapTimer: ReturnType<typeof setTimeout> | null = null

const showToolbarForSelection = () => {
  const el = inputEl.value; if (!el) return
  const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0
  if (end <= start) { toolbar.value = null; return }
  const r = el.getBoundingClientRect()
  toolbar.value = { x: r.left + r.width / 2, y: r.top }
}

/** Expand the caret to the word around it. */
const selectWordAt = (pos: number) => {
  const el = inputEl.value; if (!el) return
  const v = props.modelValue
  if (!v) return
  const isWord = (c: string) => /[\p{L}\p{N}_]/u.test(c)
  let s = Math.min(pos, v.length - 1), e = s
  if (!isWord(v[s] ?? '')) { // tapped whitespace/punctuation — take it alone
    el.setSelectionRange(s, Math.min(s + 1, v.length)); showToolbarForSelection(); return
  }
  while (s > 0 && isWord(v[s - 1])) s--
  while (e < v.length && isWord(v[e])) e++
  el.setSelectionRange(s, e)
  showToolbarForSelection()
}

const onInputPointerUp = (e: PointerEvent) => {
  // Mouse keeps the browser's own double/triple-click behaviour.
  if (e.pointerType === 'mouse') return
  const now = performance.now()
  const near = Math.abs(e.clientX - tapX) < TAP_SLOP && Math.abs(e.clientY - tapY) < TAP_SLOP
  tapCount = (now - lastTapAt < TAP_WINDOW && near) ? tapCount + 1 : 1
  lastTapAt = now; tapX = e.clientX; tapY = e.clientY

  if (tapTimer) clearTimeout(tapTimer)
  // Wait out the window before acting, so a triple isn't handled as a double
  // first and then corrected — that flash of the wrong selection is the thing
  // that makes multi-tap feel broken.
  tapTimer = setTimeout(() => {
    const el = inputEl.value
    if (!el) return
    if (tapCount === 2)      selectWordAt(el.selectionStart ?? 0)
    else if (tapCount >= 3)  { el.setSelectionRange(0, props.modelValue.length); showToolbarForSelection() }
    tapCount = 0
  }, TAP_WINDOW)
}

/** Native long-press selection (and the handles that drag it) also deserves the
 *  toolbar — it's a selection like any other. */
const onSelect = () => {
  if (!toolbar.value) return          // don't pop up unbidden while typing
  showToolbarForSelection()
}
const wrapSelection = (pre: string, post = pre) => {
  const el = inputEl.value; if (!el) return
  const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0
  const v = props.modelValue
  emit('update:modelValue', v.slice(0, start) + pre + v.slice(start, end) + post + v.slice(end))
  nextTick(() => { el.focus(); el.setSelectionRange(start + pre.length, end + pre.length) })
  toolbar.value = null
}

// ── Paste: URL-over-selection → link, rich HTML → markers ───────────────────
const htmlToMarkers = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as HTMLElement
    const inner = Array.from(el.childNodes).map(walk).join('')
    switch (el.tagName) {
      case 'B': case 'STRONG':             return inner ? `**${inner}**` : ''
      case 'I': case 'EM':                 return inner ? `*${inner}*` : ''
      case 'U':                            return inner ? `__${inner}__` : ''
      case 'S': case 'STRIKE': case 'DEL': return inner ? `~~${inner}~~` : ''
      case 'CODE':                         return inner ? '`' + inner + '`' : ''
      case 'A': { const h = el.getAttribute('href'); return h ? `[${inner}](${h})` : inner }
      case 'BR':                           return ' '
      default:                             return inner
    }
  }
  return walk(doc.body).replace(/\s+/g, ' ').trim()
}
const onPaste = (e: ClipboardEvent) => {
  const el = inputEl.value, cb = e.clipboardData
  if (!el || !cb) return
  const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0
  const selected = props.modelValue.slice(start, end)
  const text = cb.getData('text/plain')
  const html = cb.getData('text/html')

  if (selected && /^https?:\/\/\S+$/.test(text.trim())) {
    e.preventDefault()
    const link = `[${selected}](${text.trim()})`
    setValue(props.modelValue.slice(0, start) + link + props.modelValue.slice(end), start + link.length)
    return
  }
  if (html) {
    const md = htmlToMarkers(html)
    if (md && md !== text) {
      e.preventDefault()
      setValue(props.modelValue.slice(0, start) + md + props.modelValue.slice(end), start + md.length)
    }
  }
}

// ── Autocomplete (/ commands, @ mentions) ───────────────────────────────────
const ac = ref<{ kind: 'slash' | 'mention'; start: number; query: string } | null>(null)
const acIndex = ref(0)
const showTimePicker = ref(false)
let mentionStart = 0

const acItems = computed<AcItem[]>(() => {
  if (!ac.value) return []
  if (ac.value.kind === 'slash') {
    return matchCommands(ac.value.query).map(c => ({ key: c.name, title: `/${c.name}`, subtitle: c.description, glyph: c.glyph }))
  }
  const q = ac.value.query.toLowerCase()
  const items: AcItem[] = []
  if ('everyone'.startsWith(q)) items.push({ key: 'everyone', title: '@everyone', subtitle: 'Notify everyone in this chat', glyph: '📣' })
  if ('time'.startsWith(q))     items.push({ key: 'time', title: '@time', subtitle: 'Insert a timezone-aware timestamp', glyph: '🕐' })
  for (const m of (props.members || [])) {
    if (m.name.toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q)) {
      items.push({ key: `member:${m.name}`, title: m.name, subtitle: m.username ? `@${m.username}` : undefined, avatar: m.avatar })
    }
  }
  return items.slice(0, 8)
})
const acHeader = computed(() => ac.value?.kind === 'slash' ? 'Commands' : 'Members')

const refreshAc = () => {
  const el = inputEl.value; if (!el) { ac.value = null; return }
  const before = el.value.slice(0, el.selectionStart ?? 0)
  const slash = /^\/(\w*)$/.exec(before)
  if (slash) { ac.value = { kind: 'slash', start: 0, query: slash[1] }; acIndex.value = 0; return }
  const mention = /(?:^|\s)@([\w-]*)$/.exec(before)
  if (mention) { ac.value = { kind: 'mention', start: (el.selectionStart ?? 0) - mention[1].length - 1, query: mention[1] }; acIndex.value = 0; return }
  ac.value = null
}

const onInput = (e: Event) => {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
  emit('typing')
  // Editing the text after opening the @time picker dismisses it (e.g. deleting
  // the "@" you typed) — otherwise it lingered with nothing tying it to input.
  if (showTimePicker.value) showTimePicker.value = false
  nextTick(refreshAc)
}

const replaceToken = (text: string) => {
  const el = inputEl.value; if (!el || !ac.value) return
  const caret = el.selectionStart ?? 0
  const newCaret = ac.value.start + text.length
  const nv = el.value.slice(0, ac.value.start) + text + el.value.slice(caret)
  ac.value = null
  setValue(nv, newCaret)
}

const chooseAc = (key: string) => {
  if (!ac.value) return
  if (ac.value.kind === 'slash') { replaceToken(`/${key} `); return }
  if (key === 'everyone') { replaceToken('@everyone '); return }
  if (key === 'time') { mentionStart = ac.value.start; ac.value = null; showTimePicker.value = true; return }
  replaceToken(`<@${key.slice('member:'.length)}> `)
}

const onTimePick = (token: string) => {
  const el = inputEl.value; if (!el) { showTimePicker.value = false; return }
  const caret = el.selectionStart ?? mentionStart
  const nv = el.value.slice(0, mentionStart) + token + ' ' + el.value.slice(caret)
  showTimePicker.value = false
  setValue(nv, mentionStart + token.length + 1)
}

// ── Slowmode ────────────────────────────────────────────────────────────────
/**
 * A ticking clock, running only while there is something to count down.
 *
 * `Date.now()` is not reactive, so the remaining time has to be recomputed
 * from a ref that changes — otherwise the number renders once and then sits
 * there. The interval is started and cleared by the watcher below rather than
 * left running for the life of the component: this is a chat window that
 * stays open all day, and a timer that ticks forever to display nothing is a
 * wakeup every second for no reason.
 */
const nowMs = ref(Date.now())
let cooldownTimer: ReturnType<typeof setInterval> | null = null
const stopCooldownTimer = () => { if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null } }

const cooldownLeft = computed(() =>
  Math.max(0, Math.ceil(((props.cooldownUntil ?? 0) - nowMs.value) / 1000)))
const cooling = computed(() => cooldownLeft.value > 0)

watch(() => props.cooldownUntil ?? 0, until => {
  stopCooldownTimer()
  if (until <= Date.now()) return
  nowMs.value = Date.now()
  cooldownTimer = setInterval(() => {
    nowMs.value = Date.now()
    if (nowMs.value >= until) stopCooldownTimer()
  }, 250)   // finer than 1s so the number never appears to skip or stick
}, { immediate: true })

onBeforeUnmount(stopCooldownTimer)

/** How the channel's setting reads in prose, for the immune tooltip. */
const slowmodeLabel = computed(() => {
  const s = props.slowmode ?? 0
  if (s % 3600 === 0) return `${s / 3600}h`
  if (s % 60 === 0)   return `${s / 60}m`
  return `${s}s`
})

/** mm:ss once past a minute — "3:04" reads faster than "184s". */
const cooldownText = computed(() => {
  const s = cooldownLeft.value
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`
})

// ── Submit (runs slash commands) ────────────────────────────────────────────
const submit = () => {
  // Refused here as well as by the API. The server is the authority — this
  // only saves a round trip and stops the composer from clearing itself into
  // a request that was never going to land.
  if (cooling.value) return
  const m = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(props.modelValue)
  if (m) {
    const cmd = slashCommands.find(c => c.name === m[1].toLowerCase())
    if (cmd) {
      const res = cmd.run((m[2] || '').trim())
      if (res.send !== undefined) {
        if (res.send) { emit('update:modelValue', res.send); nextTick(() => emit('send')) }
        else emit('update:modelValue', '')
        return
      }
      if (res.insert !== undefined) { setValue(res.insert); return }
    }
  }
  emit('send')
}

const onKeydown = (e: KeyboardEvent) => {
  if (showTimePicker.value && e.key === 'Escape') { e.preventDefault(); showTimePicker.value = false; return }
  if (ac.value && acItems.value.length) {
    if (e.key === 'ArrowDown') { e.preventDefault(); acIndex.value = (acIndex.value + 1) % acItems.value.length; return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); acIndex.value = (acIndex.value - 1 + acItems.value.length) % acItems.value.length; return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseAc(acItems.value[acIndex.value].key); return }
    if (e.key === 'Escape') { e.preventDefault(); ac.value = null; return }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return }
  emit('typing')
}
const onBlur = () => setTimeout(() => { ac.value = null; showTimePicker.value = false }, 150)

/**
 * Grow with the content, up to a ceiling.
 *
 * Height is reset to auto before reading scrollHeight, because scrollHeight
 * never reports less than the element's current height -- without the reset
 * the box would grow and then refuse to shrink when you delete a line.
 */
const MAX_ROWS_PX = 50 * 4   // roughly four lines before it scrolls instead
const autoGrow = () => {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, MAX_ROWS_PX) + 'px'
}

// Sending clears the text from the parent, which is not something the input
// event sees -- without this the box keeps the height of the message you
// just sent.
watch(() => props.modelValue, () => nextTick(autoGrow))
onMounted(autoGrow)
</script>

<template>
  <div class="input-area">
    <!-- Slash / mention autocomplete -->
    <div v-if="ac && acItems.length" class="ac-float">
      <AutocompletePopup :header="acHeader" :items="acItems" :selectedIndex="acIndex" @select="chooseAc" @hover="acIndex = $event" />
    </div>
    <!-- @time picker -->
    <div v-if="showTimePicker" class="tt-float">
      <TimeTokenPicker @pick="onTimePick" @close="showTimePicker = false" />
    </div>

    <!-- Selection formatting toolbar -->
    <Teleport to="body">
      <template v-if="toolbar">
        <!-- pointerdown as well as mousedown: on touch, pointerdown fires first
             and blurs the input, collapsing the selection before the button's
             click ever runs — so the format would apply to nothing. -->
        <div class="fmt-overlay" @mousedown="toolbar = null" @pointerdown="toolbar = null"></div>
        <div class="fmt-toolbar" :style="{ left: toolbar.x + 'px', top: (toolbar.y - 46) + 'px' }" @mousedown.prevent @pointerdown.prevent>
          <button v-tip="'Bold'" @click="wrapSelection('**')"><Bold :size="16" :stroke-width="2.25" /></button>
          <button v-tip="'Italic'" @click="wrapSelection('*')"><Italic :size="16" /></button>
          <button v-tip="'Underline'" @click="wrapSelection('__')"><Underline :size="16" /></button>
          <button v-tip="'Strikethrough'" @click="wrapSelection('~~')"><Strikethrough :size="16" /></button>
          <button v-tip="'Quote'" @click="wrapSelection('> ', '')"><Quote :size="16" /></button>
          <button v-tip="'Code'" @click="wrapSelection('`')"><Code :size="16" /></button>
          <button v-tip="'Link'" @click="wrapSelection('[', '](https://)')"><Link :size="16" /></button>
        </div>
      </template>
    </Teleport>

    <!-- Slowmode status, above the box and right-aligned.
         Only one of the two ever shows: you are either exempt (and will never
         see a countdown) or you are not. Absent entirely when the channel has
         no slowmode, so a normal channel gains no furniture. -->
    <div v-if="slowmode && (slowmodeExempt || cooling)" class="sm-bar">
      <span v-if="slowmodeExempt" class="sm-tag" v-tip="`Slowmode is ${slowmodeLabel}, but it does not apply to you`">
        <Timer :size="12" :stroke-width="2.25" /> Slowmode Immune
      </span>
      <span v-else class="sm-tag cooling" aria-live="polite">
        <Timer :size="12" :stroke-width="2.25" /> Wait {{ cooldownText }}
      </span>
    </div>

    <!-- Reply strip — visually fused to the top of the input box. One chip per
         targeted message (multi-parent replies). -->
    <Transition name="reply-strip">
      <div v-if="replyTargets && replyTargets.length" class="reply-strip">
        <span class="reply-strip-label">Replying to</span>
        <div class="reply-chips">
          <span v-for="t in replyTargets" :key="t.id" class="reply-chip">
            <CornerUpLeft :size="12" :stroke-width="2.25" />
            <span class="reply-chip-name">{{ t.author }}</span>
            <button class="reply-chip-x" v-tip="'Remove'" @click.stop="emit('clearReply', t.id)">
              <X :size="11" :stroke-width="2.25" />
            </button>
          </span>
        </div>
        <button class="reply-strip-close" v-tip="'Cancel all'" @click.stop="emit('clearAllReply')">
          <X :size="14" :stroke-width="2.25" />
        </button>
      </div>
    </Transition>

    <div class="input-wrapper" :class="{ sending, 'with-reply': replyTargets && replyTargets.length }">
      <button class="input-attach btn-attach" v-tip="'Attach file'">
        <Paperclip :size="20" :stroke-width="1.5" />
      </button>

      <textarea
        ref="inputEl"
        :value="modelValue"
        rows="1"
        @input="onInput"
        @keydown="onKeydown"
        @paste="onPaste"
        @contextmenu="onContextMenu"
        @pointerup="onInputPointerUp"
        @select="onSelect"
        @blur="onBlur"
        :placeholder="cooling ? `Slowmode — you can post again in ${cooldownText}` : placeholder"
        :aria-label="placeholder"
        class="msg-input"
        :disabled="sending || cooling"
      ></textarea>

      <div class="input-actions">
        <button class="input-action-btn btn-gif" v-tip="'GIF'" @click.stop="emit('openGif')">
          <span class="gif-label">GIF</span>
        </button>
        <button class="input-action-btn btn-emoji" v-tip="'Emoji'" @click.stop="emit('openEmoji')">
          <Smile :size="18" :stroke-width="1.5" />
        </button>
      </div>

      <button
        v-if="appearance.showSendButton"
        class="send-btn"
        :class="{ ready: modelValue.trim() && !sending }"
        @click.stop="submit"
        :disabled="!modelValue.trim() || sending"
        v-tip="'Send'"
      >
        <svg v-if="sending" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <Send v-else :size="16" :stroke-width="1.5" />
      </button>
    </div>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
input, textarea { background: none; border: none; outline: none; color: inherit; font: inherit; }

.input-area { padding: 0 16px 16px; flex-shrink: 0; position: relative; }

/* Autocomplete + time picker float above the input box */
.ac-float { position: absolute; left: 16px; right: 16px; bottom: 100%; margin-bottom: 8px; z-index: 50; }
.tt-float { position: absolute; left: 16px; bottom: 100%; margin-bottom: 8px; z-index: 51; }

/* Reply strip fused to the input box */
/* Sits above the composer, right-aligned and quiet — a status, not a control.
   No background plate: it reads as a note on the box below it rather than as
   another strip competing with the reply strip. */
.sm-bar { display: flex; justify-content: flex-end; padding: 0 4px 4px; }
.sm-tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; letter-spacing: .2px;
  color: var(--text-3);
}
/* The countdown is the one that has to be noticed: it is the reason the box
   below stopped accepting typing. */
.sm-tag.cooling { color: var(--accent); font-variant-numeric: tabular-nums; }

.reply-strip {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px 8px 14px;
  background: var(--bg-panel);
  border-radius: 10px 10px 0 0;
  border-bottom: 1px solid rgba(0,0,0,.22);
}
.reply-strip-label { font-size: 13px; color: var(--text-2); flex-shrink: 0; }
.reply-chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 0; }
.reply-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 4px 2px 8px; border-radius: 12px;
  background: rgba(var(--accent-rgb),.16); color: var(--accent-text);
  font-size: 12.5px; font-weight: 600; max-width: 180px;
}
.reply-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reply-chip-x {
  width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--accent-text); transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.reply-chip-x:hover { background: var(--hover-strong); color: var(--text-strong); }
.reply-strip-close {
  width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-2); background: rgba(255,255,255,.06);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.reply-strip-close:hover { background: var(--hover-strong); color: var(--text-strong); }
.reply-strip-enter-active, .reply-strip-leave-active { transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out); }
.reply-strip-enter-from, .reply-strip-leave-to { opacity: 0; transform: translateY(6px); }

.input-wrapper {
  display: flex; align-items: center; gap: 4px;
  background: var(--bg-chatbar); border-radius: 10px;
  padding: 0 8px 0 4px;
  border: 1px solid transparent;
  transition: background var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out);
}
.input-wrapper.with-reply   { border-radius: 0 0 10px 10px; }
/* The composer's focus signal is the wrapper, not an outline on the textarea.
   The global :focus-visible backstop drew a 2px hard white rectangle around
   the field -- and because Chromium always matches :focus-visible on a text
   input, even a mouse click got it, so the harshest treatment in the app was
   also the one shown most often. The accent border, halo and lift below say
   "focused" at least as clearly and belong to the design. */
.input-wrapper:focus-within {
  background: var(--bg-chatbar-focus);
  border-color: rgba(var(--accent-rgb),.55);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb),.10);
}
/* Suppressing the ring HERE rather than only under [data-input="pointer"], so
   tabbing to the composer gets the same treatment as clicking it. This is not
   a focus indicator being removed -- the rule above replaces it with one that
   changes border, background and halo together. */
.input-wrapper:focus-within .msg-input:focus-visible { outline: none !important; }
.input-wrapper.sending      { opacity: .7; pointer-events: none; }

.input-attach {
  width: 36px; height: 36px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint); flex-shrink: 0;
  transition: color var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.input-attach:hover { color: var(--text-1); transform: rotate(15deg); }
.input-attach:active { transform: rotate(15deg) scale(.94); }

.msg-input {
  flex: 1; padding: 12px 4px;
  font-size: 15px; color: var(--text-1);
  /* A textarea is inline-block and sits on the text baseline, which left a
     few pixels of descender gap under it inside the flex row. */
  display: block;
  resize: none;
  /* Both axes, deliberately. Naming only overflow-y leaves overflow-x
     computing to `auto` — the spec promotes `visible` to `auto` whenever the
     other axis is not visible — so a single sub-pixel of horizontal overflow
     drew a 4px bar across the bottom of the composer, using the global
     ::-webkit-scrollbar height and its visible thumb. It reads as a stray
     slider sitting in the chat bar. The text wraps (word-break below), so
     there is never anything to reach sideways. */
  overflow: hidden auto;
  max-height: 200px;
  line-height: 1.375;
  /* Long unbroken strings must wrap rather than force the row wider. */
  word-break: break-word;
}
.msg-input::placeholder { color: var(--text-faint); }
.msg-input:disabled     { opacity: .5; }

.input-actions { display: flex; gap: 2px; }
.input-action-btn {
  width: 30px; height: 30px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint); transition: color var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
/* Colour for hover, scale for press. These sit next to the composer and are
   used constantly; a 12% grow on every pass of the pointer is noise. */
.input-action-btn:hover { color: var(--text-1); }
/* These press states existed only inside the phone media query, so on desktop
   clicking emoji, GIF or attach gave no feedback at all — the button looked
   inert until the picker opened. */
.input-action-btn:active { transform: scale(.94); }
.gif-label { font-size: 11px; font-weight: 800; letter-spacing: -.3px; }

.send-btn {
  width: 32px; height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint); background: rgba(255,255,255,.04);
  transition: background var(--dur-1) var(--ease-out),
              color      var(--dur-1) var(--ease-out),
              opacity    var(--dur-1) var(--ease-out),
              transform  var(--dur-1) var(--ease-out);
}
.send-btn.ready { background: var(--accent); color: white; }
.send-btn.ready:hover  { background: var(--accent-hover); transform: scale(1.06) rotate(8deg); }
.send-btn.ready:active { transform: scale(.93); }
.send-btn:disabled { cursor: not-allowed; }

/* ── Phone ────────────────────────────────────────────────────────────────
   A media query rather than a .shell.mobile class: this is the composer, the
   most tapped surface in the app, and it should not depend on a JS-set class
   to get usable targets. The breakpoint matches useViewport's MOBILE_MAX.

   These could NOT be fixed from ChatApp's stylesheet. Vue scoped CSS stamps
   its data attribute on the LAST element of a selector, so ChatApp's rule for
   "input" compiles to input[data-v-chatapp] and never matches a field that
   lives inside this component. */
@media (max-width: 768px) {
  /* Measured at 390px: attach 36x36, GIF and emoji 30x30, send 32x32 — every
     one of them under the 44px minimum, on the controls used most often. */
  /* flex-shrink matters here: widening these three made the row wide enough
     to compete for space, and send — the only one without it — was squeezed
     to 16px wide. A fixed width is not a width if the parent can override it. */
  .input-attach,
  .input-action-btn,
  .send-btn { width: 44px; height: 44px; flex-shrink: 0; }
  .input-actions { gap: 0; flex-shrink: 0; }

  /* GIF comes off the composer on a phone, and its 44px goes to the input
     (.msg-input is flex:1, so the space is handed over without a layout
     change). Nothing is lost: this button and the emoji button open the SAME
     picker — it only preselects the GIFs tab — so GIFs stay one tap away via
     emoji, on a row that has room for four 44px targets instead of five. */
  .btn-gif { display: none; }

  /* iOS zooms the page when a focused field is under 16px and never zooms
     back. This is a platform constraint, not a type choice. */
  .msg-input { font-size: 16px; }

  /* The composer is the bottom-most thing in the column and had a flat 16px,
     so on a phone with a home indicator it sat underneath it. max(), not
     16px + env(): the 16px IS the design gap, and where the inset is larger
     it already provides that gap — adding them stacks two gaps and gives up
     scroll height for nothing. Phones without an indicator report 0 and keep
     the original 16. */
  .input-area { padding-bottom: max(16px, env(safe-area-inset-bottom)); }

  /* Hover does not exist on touch, so the only feedback these had was a
     transform that never fired. Press states, on pointer-down. */
  .input-attach:active,
  .input-action-btn:active { color: var(--text-1); transform: scale(.92); }
  .send-btn:active { transform: scale(.92); }

  /* Send, with nothing typed, carried a faint plate (rgba(255,255,255,.04))
     that reads as a subtle affordance at its desktop 32px. Blown up to the
     44px touch target it became a large grey square sitting immediately
     beside two bare icons of the same size — the odd one out in a row of
     three, and the more prominent for being the disabled one.
     No plate until it can actually send; then the accent fill earns it. */
  .send-btn:not(.ready) { background: transparent; }

  /* Matching the other two so the row reads as one set of controls. */
  .send-btn { border-radius: 6px; }

  /* The glyph did not grow with the button: a 16px icon centred in 44px next
     to 18px icons in the same 44px looked shrunken. Set on the SVG because
     lucide writes width/height as attributes, which CSS overrides. */
  .send-btn svg { width: 20px; height: 20px; }
}

@keyframes spin { to { transform: rotate(360deg) } }
.spin { animation: spin .8s linear infinite; }

/* Selection formatting toolbar (teleported to body, fixed at the cursor) */
.fmt-overlay { position: fixed; inset: 0; z-index: 1400; }
.fmt-toolbar {
  position: fixed; z-index: 1401; transform: translateX(-50%);
  display: flex; gap: 1px; padding: 4px;
  background: var(--bg-panel); border: 1px solid rgba(0,0,0,.4); border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0,0,0,.5);
}
.fmt-toolbar button {
  width: 30px; height: 30px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-2); transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.fmt-toolbar button:hover { background: var(--hover-strong); color: var(--text-strong); }
</style>