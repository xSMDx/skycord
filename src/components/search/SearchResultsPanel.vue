<script setup lang="ts">
/**
 * Search results, in the column to the right of the chat. Each result is drawn
 * by the chat's own renderer, so mentions, links and emoji look as they do in
 * the channel, with the searched words marked. Opening one leaves the panel
 * where it is: the next result stays a click away.
 */
import { ref, computed, watch } from 'vue'
import { X, Hash } from 'lucide-vue-next'
import Skeleton from '@/components/ui/Skeleton.vue'
import { useSearch, type SearchHit } from '@/composables/useSearch'
import { renderMessage } from '@/utils/richText'
import { avatarFor } from '@/composables/useAvatar'
import { highlightHtml, highlightTerms } from '@/composables/searchHighlight'
import type { SuggestChannel } from '@/composables/searchSuggest'

const props = defineProps<{
  channels: SuggestChannel[]
  /** The result opened last, marked so you can see where you were. */
  activeId: string | null
  /** Phone: the panel is the body of the search screen, not a side column. */
  screen?: boolean
}>()
const emit = defineEmits<{ open: [hit: SearchHit]; close: [] }>()

const { results, total, hasMore, loading, error, sort, query, setSort, loadMore, run } = useSearch()

const body = ref<HTMLElement | null>(null)
const channelName = computed(() => new Map(props.channels.map(c => [c.id, c.name])))
const terms = computed(() => highlightTerms(query.value.text))

const countLabel = computed(() => {
  if (loading.value && !results.value.length) return 'Searching…'
  const n = total.value >= 1000 ? '1,000+' : total.value.toLocaleString()
  return `${n} ${total.value === 1 ? 'Result' : 'Results'}`
})

// Same test the chat uses: a message that is nothing but a .gif link is a GIF.
const GIF_URL_RE = /^https?:\/\/\S+\.gif(\?\S*)?$/i
const gifOf = (content: string) => (GIF_URL_RE.test(content.trim()) ? content.trim() : null)

const stamp = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
})
const when = (iso: string) => stamp.format(new Date(iso))
const html = (content: string) => highlightHtml(renderMessage(content), terms.value)
const idOf = (h: SearchHit) => String(h.message._id ?? h.message.id ?? '')

/** A channel label above a result whenever the channel changes, the way the reference groups them. */
const showChannel = (i: number) =>
  !!results.value[i].channelId && results.value[i].channelId !== results.value[i - 1]?.channelId

/** The card opens its message; a link inside it is still just a link. */
const onCard = (e: MouseEvent, hit: SearchHit) => {
  if ((e.target as HTMLElement).closest('a')) return
  emit('open', hit)
}

// A new search starts at its top; more results appended to this one do not move it.
watch(() => results.value[0], () => body.value?.scrollTo({ top: 0 }))
</script>

<template>
  <aside class="srp" :class="{ screen }" aria-label="Search results">
    <header class="srp-head">
      <p class="srp-count" aria-live="polite">{{ countLabel }}</p>
      <div class="srp-sort" role="group" aria-label="Sort results">
        <button type="button" class="srp-tab" :aria-pressed="sort === 'newest'" @click="setSort('newest')">Newest</button>
        <button type="button" class="srp-tab" :aria-pressed="sort === 'relevant'" @click="setSort('relevant')">Most relevant</button>
      </div>
      <button v-if="!screen" type="button" class="srp-close" aria-label="Close search results" @click="emit('close')">
        <X :size="16" :stroke-width="2.25" aria-hidden="true" />
      </button>
    </header>

    <div ref="body" class="srp-body" :class="{ busy: loading && results.length }">
      <div v-if="loading && !results.length" class="srp-sk" role="status" aria-label="Searching">
        <div v-for="n in 5" :key="n" class="srp-sk-row">
          <Skeleton circle :h="32" />
          <div class="srp-sk-lines">
            <Skeleton :w="96 + (n % 3) * 24" :h="12" />
            <Skeleton :w="`${90 - (n % 2) * 30}%`" :h="12" :dim="0.8" />
          </div>
        </div>
      </div>

      <div v-else-if="error" class="srp-note">
        <p>{{ error }}</p>
        <button type="button" class="srp-more" @click="run()">Try again</button>
      </div>

      <p v-else-if="!results.length" class="srp-note">
        No results<template v-if="query.text.trim()"> for “{{ query.text.trim() }}”</template>.
        <template v-if="query.chips.length"> Removing a filter may find more.</template>
      </p>

      <ol v-else class="srp-list">
        <li v-for="(hit, i) in results" :key="idOf(hit)">
          <p v-if="showChannel(i)" class="srp-chan">
            <Hash :size="14" :stroke-width="2.25" aria-hidden="true" />{{ channelName.get(hit.channelId!) ?? 'unknown channel' }}
          </p>
          <article class="srp-hit" :class="{ on: activeId === idOf(hit) }" @click="onCard($event, hit)">
            <span class="srp-av">
              <Avatar
                :src="hit.message.authorAvatar || avatarFor(hit.message.authorName)" alt=""
                :crop="hit.message.authorAvatarCrop ?? null"
              />
            </span>
            <div class="srp-main">
              <p class="srp-meta">
                <span class="srp-author">{{ hit.message.authorName }}</span>
                <time class="srp-time" :datetime="hit.message.createdAt">{{ when(hit.message.createdAt) }}</time>
              </p>
              <img v-if="gifOf(hit.message.content)" :src="gifOf(hit.message.content)!" class="srp-gif" alt="GIF" loading="lazy" />
              <!-- renderMessage escapes the text before it adds any markup, and
                   highlightHtml only wraps text between tags. -->
              <div v-else class="srp-text" v-html="html(hit.message.content)" />
            </div>
            <button type="button" class="srp-jump" @click.stop="emit('open', hit)">Jump</button>
          </article>
        </li>
      </ol>

      <button v-if="hasMore && results.length" type="button" class="srp-more" :disabled="loading" @click="loadMore()">
        {{ loading ? 'Loading…' : 'Load more' }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.srp {
  width: clamp(300px, 30vw, 400px); flex-shrink: 0; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--bg-panel); border-left: 1px solid rgba(0,0,0,.25);
  font-family: var(--font-ui);
  animation: srp-in var(--dur-3) var(--ease-out);
}
@keyframes srp-in { from { opacity: 0; transform: translateX(8px); } }
.srp.screen { width: auto; flex: 1; border-left: none; background: transparent; animation: none; }

.srp-head {
  height: 48px; flex-shrink: 0;
  display: flex; align-items: center; gap: 8px; padding: 0 8px 0 16px;
  border-bottom: 1px solid rgba(0,0,0,.25);
}
.srp.screen .srp-head { padding: 0 16px; }
.srp-count {
  margin: 0 auto 0 0; white-space: nowrap;
  font-size: 14px; font-weight: 700; color: var(--text-strong); font-variant-numeric: tabular-nums;
}
.srp-sort { display: flex; gap: 2px; padding: 2px; border-radius: var(--edge-md); background: var(--bg-input); }
.srp-tab {
  padding: 4px 8px; border: none; border-radius: var(--edge-sm); background: none; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 600; color: var(--text-3); white-space: nowrap;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.srp-tab:hover { color: var(--text-1); }
.srp-tab[aria-pressed="true"] { background: var(--hover-strong); color: var(--text-strong); }
.srp-close {
  width: 30px; height: 30px; flex: none; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; color: var(--text-3);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.srp-close:hover { background: var(--hover); color: var(--text-strong); }

.srp-body {
  flex: 1; min-height: 0; overflow: hidden auto; overscroll-behavior: contain;
  padding: 8px 8px 16px;
  transition: opacity var(--dur-2) var(--ease-out);
}
/* A new sort or search is on its way: the old answer stays readable but steps back. */
.srp-body.busy { opacity: .6; }
.srp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.srp-chan {
  display: flex; align-items: center; gap: 4px; margin: 6px 0 0; padding: 0 6px 2px;
  font-size: 12px; font-weight: 700; color: var(--text-3);
}

.srp-hit {
  position: relative; display: flex; gap: 12px;
  padding: 10px 12px; border-radius: var(--edge-lg);
  background: var(--bg-chat); border: 1px solid transparent;
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
@media (hover: hover) { .srp-hit:hover { background: var(--bg-chatbar); } }
.srp-hit:active { box-shadow: inset 0 0 0 100vmax var(--press-veil); }
.srp-hit.on { border-color: var(--active-ring); }
.srp-av { display: flex; width: 32px; height: 32px; flex: none; }
.srp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.srp-meta { display: flex; align-items: baseline; gap: 8px; min-width: 0; margin: 0; }
.srp-author {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 14px; font-weight: 600; color: var(--text-strong);
}
.srp-time { flex: none; font-size: 12px; color: var(--text-faint); white-space: nowrap; }
.srp-gif { max-width: 180px; max-height: 140px; margin-top: 4px; border-radius: var(--edge-md); }

/* Shown on hover or focus, the way the reference's is; the card itself is
   the bigger target, this is the one a keyboard can reach. */
.srp-jump {
  position: absolute; top: 8px; right: 8px;
  padding: 3px 8px; border: none; border-radius: var(--edge-sm); cursor: pointer;
  background: var(--bg-input); color: var(--text-1); font: inherit; font-size: 12px; font-weight: 600;
  opacity: 0; transition: opacity var(--dur-1) var(--ease-out), background var(--dur-1) var(--ease-out);
}
.srp-hit:hover .srp-jump, .srp-hit:focus-within .srp-jump { opacity: 1; }
.srp-jump:hover { background: var(--hover-strong); }

/* ── The message, drawn as the chat draws it ────────────────────────────── */
.srp-text {
  font-size: 14px; line-height: 1.4; color: var(--text-1); word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden;
}
.srp-text :deep(.sr-hit) { background: var(--mention-all-bg); color: var(--text-strong); border-radius: 2px; padding: 0 1px; }
.srp-text :deep(.mention) { color: var(--mention-fg); background: var(--mention-bg); padding: 0 4px; border-radius: var(--edge-sm); font-weight: 500; }
.srp-text :deep(.mention-all) { color: var(--mention-all-fg); background: var(--mention-all-bg); padding: 0 4px; border-radius: var(--edge-sm); font-weight: 600; }
.srp-text :deep(.emoji) { display: inline-block; width: 1.35em; height: 1.35em; vertical-align: -.28em; margin: 0 .02em; object-fit: contain; }
.srp-text :deep(.msg-link) { color: var(--text-link); text-decoration: var(--link-decoration, none); word-break: break-all; }
.srp-text :deep(.msg-link:hover) { text-decoration: underline; }
.srp-text :deep(.msg-time-token) { background: var(--time-token-bg); color: var(--time-token-fg); padding: 0 4px; border-radius: var(--edge-sm); font-weight: 500; }
.srp-text :deep(.msg-bq) { display: block; margin: 2px 0; padding: 1px 0 1px 10px; box-shadow: inset 3px 0 0 var(--hover-strong); color: var(--text-2); }
.srp-text :deep(.msg-cb) {
  display: block; margin: 4px 0; padding: 8px 10px;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--edge-md);
  font-family: var(--font-mono); font-size: 13px; color: var(--text-1); white-space: pre-wrap; word-break: break-word;
}
.srp-text :deep(.ic) { font-family: var(--font-mono); font-size: 13px; background: var(--bg-input); padding: 1px 4px; border-radius: var(--edge-sm); color: var(--text-1); }

.srp-note { margin: 0; padding: 16px 6px; font-size: 13px; line-height: 1.5; color: var(--text-3); }
.srp-note p { margin: 0 0 10px; }
.srp-more {
  display: block; width: 100%; margin-top: 12px; padding: 9px 16px;
  border: none; border-radius: var(--edge-md); cursor: pointer;
  background: var(--bg-input); color: var(--text-1); font: inherit; font-size: 14px; font-weight: 600;
  transition: background var(--dur-1) var(--ease-out);
}
.srp-more:hover:not(:disabled) { background: var(--hover-strong); }
.srp-more:disabled { opacity: .6; cursor: default; }
.srp-note .srp-more { width: auto; margin: 0; }

.srp-sk { display: flex; flex-direction: column; gap: 16px; padding: 8px 6px; }
.srp-sk-row { display: flex; gap: 12px; }
.srp-sk-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; padding-top: 2px; }
</style>
