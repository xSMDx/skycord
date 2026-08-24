<script setup lang="ts">
/**
 * Conversation details — the screen behind the header's chevron on a phone.
 *
 * A pushed SCREEN rather than a sheet, deliberately. A sheet is for a glance
 * you dismiss (the member list, a menu); this is a place you travel to, browse,
 * and come back from, and it will grow tabs of scrollable content. Giving it
 * the same grammar as a menu would misrepresent how deep it goes.
 *
 * Media / Pins / Links / Files are present but disabled, with the reason shown.
 * A tab bar that hides three of its five tabs until some later release is
 * worse than one that admits what isn't built: the shape of the screen is the
 * promise, and hiding it means redesigning the header again later.
 */
import { computed, ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import {
  ChevronLeft, Search, Bell, Settings as SettingsIcon,
  UserPlus, UsersRound, Crown, ChevronRight, SlidersHorizontal, Volume2,
} from 'lucide-vue-next'
import { statusColor, statusLabel } from '@/composables/usePresence'

export type DetailsTab = 'members' | 'media' | 'pins' | 'links' | 'files'

const props = defineProps<{
  /**
   * `channel` covers a server channel, voice included. No call site passes it
   * yet — this screen is the phone layout's, and that is on hold — but the
   * kind is part of the app's vocabulary now, and the branches below are what
   * stop a channel from being described as a group DM the day one arrives.
   */
  kind: 'dm' | 'group' | 'channel'
  title: string
  /** Usernames under the title — who this conversation is with. */
  subtitle: string
  avatar: string | null
  members: { id: string; username: string; displayName?: string; avatar?: string | null; status?: string }[]
  memberCount?: number
  maxMembers?: number
  ownerId?: string
  tab: DetailsTab
  /** Open with the search field already expanded — the chat header's search
   *  icon lands here rather than expanding in place. */
  startSearching?: boolean
}>()

const emit = defineEmits<{
  close: []
  'update:tab': [t: DetailsTab]
  addMembers: []
  openMember: [id: string]
  openSettings: []
  search: []
  mute: []
}>()

/** Tabs the data actually exists for. The rest render disabled, not hidden. */
const TABS: { id: DetailsTab; label: string; ready: boolean }[] = [
  { id: 'members', label: 'Members', ready: true },
  { id: 'media',   label: 'Media',   ready: false },
  { id: 'pins',    label: 'Pins',    ready: false },
  { id: 'links',   label: 'Links',   ready: false },
  { id: 'files',   label: 'Files',   ready: false },
]

const countLabel = computed(() => {
  const n = props.memberCount ?? props.members.length
  return props.maxMembers ? `${n}/${props.maxMembers}` : String(n)
})

const initial = (n: string) => (n || '?').charAt(0).toUpperCase()
const pick = (t: DetailsTab, ready: boolean) => { if (ready) emit('update:tab', t) }

// ── Search ──────────────────────────────────────────────────────────────────
/**
 * The field TAKES OVER the header row rather than appearing beside the action
 * icons. At 390px there is no room for a usable input plus three 44px buttons,
 * and a field squeezed into what's left is worse than no field. Bell and
 * settings step aside while you're typing and come back when you're done —
 * they aren't gone, they're just not what you're doing right now.
 */
const searching = ref(!!props.startSearching)
const query = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const shell = ref<HTMLElement | null>(null)

const openSearch = async () => {
  searching.value = true
  await nextTick()
  inputEl.value?.focus()
}
const closeSearch = () => { searching.value = false; query.value = '' }

/**
 * Anywhere outside the field and the filter button collapses it. Listens on
 * pointerdown, not click: a click fires on the nearest common ancestor of its
 * down and up targets, so dragging to select text in the field and releasing
 * outside would close the very thing you were using.
 */
const onOutside = (e: PointerEvent) => {
  if (!searching.value) return
  const t = e.target as HTMLElement
  if (t.closest('.cd-searchwrap')) return
  closeSearch()
}
onMounted(() => document.addEventListener('pointerdown', onOutside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))

if (props.startSearching) nextTick(() => inputEl.value?.focus())
</script>

<template>
  <div class="cd">
    <!-- Header. Back sits where back always sits; the actions match the ones
         the chat header offers, so moving between the two doesn't relearn. -->
    <header ref="shell" class="cd-head" :class="{ searching }">
      <button class="cd-icon cd-back" aria-label="Back to conversation" @click="emit('close')">
        <ChevronLeft :size="22" :stroke-width="2.25" />
      </button>

      <!-- The field and the filter travel together: the filter only means
           anything while there's a query to filter. -->
      <div class="cd-searchwrap">
        <div class="cd-searchfield" @click="openSearch">
          <Search class="cd-search-ico" :size="20" :stroke-width="2" />
          <input
            v-show="searching"
            ref="inputEl"
            v-model="query"
            class="cd-search-input"
            type="search"
            enterkeyhint="search"
            :placeholder="`Search in ${title}`"
            :aria-label="`Search in ${title}`"
            @keydown.esc="closeSearch"
          />
        </div>
        <button
          v-show="searching"
          class="cd-icon cd-filter"
          aria-label="Search filters"
          @click.stop
        >
          <SlidersHorizontal :size="20" :stroke-width="2" />
        </button>
      </div>

      <!-- Hidden while searching, not removed: keeping them in the layout
           means the row doesn't reflow when the field opens and closes. -->
      <div class="cd-head-actions">
        <button class="cd-icon" aria-label="Notification settings" @click="emit('mute')">
          <Bell :size="20" :stroke-width="2" />
        </button>
        <!-- Group settings, not conversation settings: it opens the rename /
             icon editor for a group DM. A channel's settings belong to the
             server and are not this screen's to offer, and a DM has none at
             all — so this stays the one kind's row it has always been. -->
        <button v-if="kind === 'group'" class="cd-icon" aria-label="Group settings" @click="emit('openSettings')">
          <SettingsIcon :size="20" :stroke-width="2" />
        </button>
      </div>
    </header>

    <!-- Identity -->
    <div class="cd-id">
      <div class="cd-av">
        <Avatar v-if="avatar" :src="avatar" :alt="title" />
        <UsersRound v-else-if="kind === 'group'" :size="26" :stroke-width="2" />
        <!-- A channel has no face, and its initial letter would read as a
             person's. It gets the icon its sidebar row has instead. -->
        <Volume2 v-else-if="kind === 'channel'" :size="26" :stroke-width="2" />
        <template v-else>{{ initial(title) }}</template>
      </div>
      <div class="cd-id-text">
        <h1 class="cd-title">{{ title }}</h1>
        <p v-if="subtitle" class="cd-sub">{{ subtitle }}</p>
      </div>
    </div>

    <!-- Tabs -->
    <nav class="cd-tabs" role="tablist">
      <button
        v-for="t in TABS" :key="t.id"
        class="cd-tab"
        :class="{ on: tab === t.id, soon: !t.ready }"
        role="tab" :aria-selected="tab === t.id" :disabled="!t.ready"
        :title="t.ready ? undefined : 'Coming with channels'"
        @click="pick(t.id, t.ready)"
      >{{ t.label }}</button>
    </nav>

    <div class="cd-body">
      <template v-if="tab === 'members'">
        <button v-if="kind === 'group'" class="cd-row cd-add" @click="emit('addMembers')">
          <span class="cd-row-ico"><UserPlus :size="20" :stroke-width="2" /></span>
          <span class="cd-row-label">Add Members</span>
          <ChevronRight :size="18" :stroke-width="2.25" class="cd-row-chev" />
        </button>

        <h2 class="cd-section">Members — {{ countLabel }}</h2>
        <ul class="cd-members">
          <li v-for="m in members" :key="m.id">
            <button class="cd-member" @click="emit('openMember', m.id)">
              <span class="cd-m-av">
                <Avatar v-if="m.avatar" :src="m.avatar" :alt="m.displayName || m.username" :crop="(m as any).avatarCrop" />
                <template v-else>{{ initial(m.displayName || m.username) }}</template>
                <span
                  class="cd-m-dot"
                  :style="{ background: statusColor(m.status) }"
                  :aria-label="statusLabel(m.status)"
                />
              </span>
              <span class="cd-m-text">
                <span class="cd-m-name">
                  {{ m.displayName || m.username }}
                  <Crown v-if="m.id === ownerId" :size="14" :stroke-width="2.5" class="cd-m-owner" />
                </span>
                <span class="cd-m-user">{{ m.username }}</span>
              </span>
            </button>
          </li>
        </ul>
      </template>

      <!-- Disabled tabs can still be reached by keyboard; say why rather than
           showing an empty pane that reads as a loading failure. -->
      <p v-else class="cd-soon">
        {{ TABS.find(t => t.id === tab)?.label }} arrives with channels, which brings the
        indexing this needs.
      </p>
    </div>
  </div>
</template>

<style scoped>
.cd {
  position: absolute; inset: 0; z-index: 40;
  display: flex; flex-direction: column;
  background: var(--bg-chat);
  padding-top: env(safe-area-inset-top);
}

.cd-head {
  flex-shrink: 0; height: 56px;
  display: flex; align-items: center; gap: 2px;
  padding: 0 4px;
}
.cd-head-actions { display: flex; align-items: center; flex-shrink: 0; }

/* ── Search ─────────────────────────────────────────────────────────────
   Collapsed, the field is a 44px circle that reads as an icon. Expanded, it
   grows along the row and the trailing actions fold away. One element the
   whole time, so open and close are the same path run in both directions
   rather than two effects that have to be kept in sync. */
.cd-searchwrap {
  display: flex; align-items: center; gap: 2px;
  flex: 1; min-width: 0; justify-content: flex-end;
}
.cd-searchfield {
  display: flex; align-items: center; gap: 8px;
  height: 44px; width: 44px; min-width: 44px;
  padding: 0 12px; border-radius: 22px;
  border: 1.5px solid transparent; background: transparent;
  color: var(--text-2); cursor: pointer; overflow: hidden;
  transition:width .28s cubic-bezier(.2,.8,.3,1), background var(--dur-3) var(--ease-out), border-color var(--dur-3) var(--ease-out), padding .28s cubic-bezier(.2,.8,.3,1);
}
.cd-head.searching .cd-searchfield {
  width: 100%; cursor: text;
  background: var(--bg-raised);
  border-color: var(--accent);
  padding: 0 14px;
}
.cd-search-ico { flex-shrink: 0; }
.cd-head.searching .cd-search-ico { color: var(--text-3); }
.cd-search-input {
  flex: 1; min-width: 0; height: 100%;
  border: none; background: none; outline: none;
  color: var(--text-1); font-size: 16px;   /* 16px or iOS zooms the page */
  /* Cancel the UA's search-field affordances so it matches the app. */
  appearance: none; -webkit-appearance: none;
}
.cd-search-input::-webkit-search-cancel-button { display: none; }
.cd-search-input::placeholder { color: var(--text-faint); }

/* The trailing actions collapse to zero width so the field can take the row,
   and animate on width rather than being removed — removing them makes the
   row jump instead of moving. */
.cd-head.searching .cd-head-actions { width: 0; overflow: hidden; }
.cd-head-actions { transition:width .28s cubic-bezier(.2,.8,.3,1); }
.cd-filter { flex-shrink: 0; color: var(--text-2); }
.cd-filter:active { background: var(--hover); color: var(--text-1); }

@media (prefers-reduced-motion: reduce) {
  .cd-searchfield, .cd-head-actions { transition:none; }
}
.cd-icon {
  display: flex; align-items: center; justify-content: center;
  min-width: 44px; min-height: 44px;
  border: none; background: none; cursor: pointer;
  color: var(--text-2); border-radius: 8px;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.cd-icon:active { background: var(--hover); color: var(--text-1); }

/* Identity */
.cd-id { display: flex; align-items: center; gap: 14px; padding: 4px 16px 20px; }
.cd-av {
  width: 64px; height: 64px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent); color: #fff;
  font-size: 24px; font-weight: 700; overflow: hidden;
}
.cd-av img { width: 100%; height: 100%; object-fit: cover; }
.cd-id-text { min-width: 0; }
/* Tighter leading and negative tracking as the type grows — a display size
   set at body metrics reads as too loose. */
.cd-title {
  font-size: 22px; font-weight: 700; color: var(--text-strong);
  line-height: 1.15; letter-spacing: -.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cd-sub {
  font-size: 14px; color: var(--text-3); margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Tabs */
.cd-tabs {
  flex-shrink: 0; display: flex; gap: 4px;
  padding: 0 12px; border-bottom: 1px solid var(--border);
  overflow-x: auto; scrollbar-width: none;
}
.cd-tabs::-webkit-scrollbar { display: none; }
.cd-tab {
  position: relative; flex-shrink: 0;
  min-height: 44px; padding: 0 10px;
  border: none; background: none; cursor: pointer;
  color: var(--text-3); font-size: 15px; font-weight: 600;
  transition: color var(--dur-1) var(--ease-out);
}
.cd-tab.on { color: var(--accent); }
.cd-tab.on::after {
  content: ''; position: absolute; left: 8px; right: 8px; bottom: -1px;
  height: 2px; background: var(--accent); border-radius: 2px 2px 0 0;
}
/* Dimmed, not hidden: the shape of the screen is a promise about what's
   coming, and hiding tabs means redesigning this header when they land. */
.cd-tab.soon { color: var(--text-faint); opacity: .55; cursor: default; }

.cd-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 12px 32px; }

/* Rows */
.cd-row {
  display: flex; align-items: center; gap: 14px; width: 100%;
  min-height: 56px; padding: 0 14px;
  border: none; border-radius: 10px; cursor: pointer;
  background: var(--bg-raised); color: var(--text-1);
  text-align: left; transition: background var(--dur-1) var(--ease-out);
}
.cd-row:active { background: var(--hover); }
.cd-row-ico { display: flex; color: var(--text-2); flex-shrink: 0; }
.cd-row-label { flex: 1; font-size: 15px; font-weight: 600; }
.cd-row-chev { color: var(--text-faint); flex-shrink: 0; }

.cd-section {
  font-size: 13px; font-weight: 700; letter-spacing: .02em;
  color: var(--text-3); text-transform: none;
  margin: 24px 4px 8px;
}

.cd-members { list-style: none; margin: 0; padding: 0; background: var(--bg-raised); border-radius: 10px; overflow: hidden; }
.cd-members li + li { border-top: 1px solid var(--border); }
.cd-member {
  display: flex; align-items: center; gap: 12px; width: 100%;
  min-height: 60px; padding: 8px 14px;
  border: none; background: none; cursor: pointer; text-align: left;
  transition: background var(--dur-1) var(--ease-out);
}
.cd-member:active { background: var(--hover); }
.cd-m-av {
  position: relative; width: 40px; height: 40px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  background: var(--accent); color: #fff; font-weight: 700; overflow: visible;
}
.cd-m-av img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.cd-m-dot {
  position: absolute; right: -1px; bottom: -1px;
  width: 13px; height: 13px; border-radius: 50%;
  border: 2.5px solid var(--bg-raised);
}
.cd-m-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.cd-m-name {
  display: flex; align-items: center; gap: 6px;
  font-size: 15px; font-weight: 600; color: var(--text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cd-m-owner { color: #f0b232; flex-shrink: 0; }
.cd-m-user { font-size: 13px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cd-soon { padding: 32px 16px; text-align: center; color: var(--text-3); font-size: 14px; line-height: 1.5; }

@media (prefers-reduced-motion: reduce) {
  .cd-icon, .cd-row, .cd-member, .cd-tab { transition:none; }
}
</style>
