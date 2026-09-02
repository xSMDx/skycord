<script setup lang="ts">
/**
 * Server Settings — the shell.
 *
 * Full-screen, matching the user Settings modal rather than the small
 * EditChannelModal card. Server settings and user settings are the same KIND
 * of surface — a grouped nav down the left, one page at a time on the right —
 * so they should feel the same. The reference screenshots do this too.
 *
 * UI ONLY at this stage. Everything without a backend carries a TBD marker
 * rather than being hidden: a row that says "not yet" reads as a plan, a
 * missing row reads as something the app cannot do. Nothing here pretends to
 * work, which was the whole problem with the "1 device" row and the video
 * button.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { X, Trash2 } from 'lucide-vue-next'
import { useApi, type WireServer } from '@/composables/useApi'
import { useAuth } from '@/composables/useAuth'
import { useViewport } from '@/composables/useViewport'
import ServerProfilePage from '../settings/server/ServerProfilePage.vue'
import '@/styles/settingsShared.css'

const props = defineProps<{ serverId: string }>()
const emit = defineEmits<{ close: []; toast: [msg: string] }>()

const { getServerDetail } = useApi()
const { user } = useAuth()
const { isMobile } = useViewport()

const server = ref<WireServer | null>(null)
const isOwner = computed(() => !!server.value && !!user.value && server.value.owner === user.value.id)

/**
 * `ready: false` means the screen has no backend yet and shows a placeholder.
 *
 * The list is deliberately NOT a copy of the reference. Server Tag, Boost
 * Perks, Engagement, App Directory, Enable Community, Server Template, AutoMod
 * and Integrations are Discord *platform* features — Nitro monetisation, their
 * bot marketplace, their moderation service. Cloning the chrome without the
 * thing behind it is how you get a settings screen full of rows that do
 * nothing, which is what this whole pass has been removing.
 */
const NAV: { label?: string; items: { id: string; label: string; ready: boolean }[] }[] = [
  { items: [
    { id: 'profile', label: 'Server Profile', ready: true },
    { id: 'access',  label: 'Access',         ready: false },
  ] },
  { label: 'Expression', items: [
    { id: 'emoji',      label: 'Emoji',      ready: false },
    { id: 'stickers',   label: 'Stickers',   ready: false },
    { id: 'soundboard', label: 'Soundboard', ready: false },
  ] },
  { label: 'People', items: [
    { id: 'members', label: 'Members', ready: false },
    { id: 'roles',   label: 'Roles',   ready: false },
    { id: 'invites', label: 'Invites', ready: false },
  ] },
  { label: 'Moderation', items: [
    { id: 'audit', label: 'Audit Log', ready: false },
    { id: 'bans',  label: 'Bans',      ready: false },
  ] },
]

const page = ref('profile')
const currentLabel = computed(() =>
  page.value === 'delete' ? 'Delete Server'
    : NAV.flatMap(g => g.items).find(i => i.id === page.value)?.label ?? '')

/** On a phone the nav is a screen of its own, pushed aside by the detail. */
const mobileDetail = ref(false)
watch(isMobile, m => { if (!m) mobileDetail.value = false })
const selectPage = (id: string) => {
  page.value = id
  if (isMobile.value) mobileDetail.value = true
}

onMounted(async () => {
  try { server.value = (await getServerDetail(props.serverId)).server }
  catch { emit('toast', 'Could not load this server'); emit('close') }
})

// Esc closes, matching the reference's own "ESC" affordance beside the X. On a
// phone it first backs out of the detail, because that is the screen you are
// actually looking at.
const onKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (isMobile.value && mobileDetail.value) { mobileDetail.value = false; return }
  emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="sv-overlay">
      <div class="sv" :class="{ mobile: isMobile, 'm-detail': mobileDetail }">

        <!-- ── Nav ── -->
        <nav class="sv-nav">
          <div class="sv-nav-inner">
            <div class="sv-servername">{{ server?.name ?? '—' }}</div>

            <template v-for="(group, gi) in NAV" :key="gi">
              <div v-if="group.label" class="sv-navgroup">{{ group.label }}</div>
              <button
                v-for="item in group.items" :key="item.id"
                class="sv-navitem"
                :class="{ active: page === item.id }"
                @click="selectPage(item.id)"
              >
                <span class="sv-navitem-label">{{ item.label }}</span>
                <span v-if="!item.ready" class="st-tbd">TBD</span>
              </button>
            </template>

            <div class="sv-navsep" />
            <button
              v-if="isOwner"
              class="sv-navitem danger"
              :class="{ active: page === 'delete' }"
              @click="selectPage('delete')"
            >
              <span class="sv-navitem-label">Delete Server</span>
              <Trash2 :size="14" :stroke-width="2" />
            </button>
          </div>
        </nav>

        <!-- ── Content ── -->
        <main class="sv-main">
          <!-- On a phone the detail is its own screen and needs its own way back. -->
          <button v-if="isMobile" class="sv-back" @click="mobileDetail = false">
            ← {{ currentLabel }}
          </button>

          <div class="sv-scroll">
            <!-- Only the page being viewed is mounted; a settings surface with
                 ten pages should not build ten of them to show one. -->
            <Transition name="sv-page" mode="out-in">
              <ServerProfilePage
                v-if="page === 'profile' && server"
                key="profile"
                :server="server"
                :is-owner="isOwner"
                @toast="m => emit('toast', m)"
              />
              <div v-else :key="page" class="st-placeholder">
                <span class="st-placeholder-title">{{ currentLabel }} — not built yet</span>
                <span class="st-placeholder-sub">
                  The screen is designed; the server side it needs does not
                  exist. Listed rather than hidden, so the plan is visible.
                </span>
              </div>
            </Transition>
          </div>
        </main>

        <!-- Matches the reference: a circled X with ESC underneath, outside the
             content column so it never collides with a scrolling page. -->
        <button v-if="!isMobile" class="sv-close" aria-label="Close settings" @click="emit('close')">
          <span class="sv-close-x"><X :size="18" :stroke-width="2" /></span>
          <span class="sv-close-esc">ESC</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sv-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: var(--bg-raised);
}
.sv { display: flex; height: 100%; width: 100%; position: relative; }

/* ── Nav ── */
/* The rail is darker than the page, which is the app's own depth model:
   chrome recedes, content sits forward. Right-aligned inner column so the nav
   hugs the content rather than floating in a wide empty gutter. */
.sv-nav {
  width: 268px; flex-shrink: 0;
  background: var(--bg-floor);
  overflow: hidden auto;
  display: flex; justify-content: flex-end;
}
.sv-nav-inner { width: 218px; padding: 60px 12px 40px 0; display: flex; flex-direction: column; gap: 2px; }

.sv-servername {
  font-size: 12px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--text-3); padding: 0 10px 8px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sv-navgroup {
  font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--text-3); padding: 16px 10px 6px;
}
.sv-navitem {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 10px; border-radius: 6px;
  font-size: 15px; font-weight: 500; color: var(--text-2); text-align: left;
  background: none; border: none; cursor: pointer; font-family: inherit;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.sv-navitem-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sv-navitem:hover { background: var(--hover); color: var(--text-strong); }
.sv-navitem:active { transform: scale(.99); }
/* Neutral fill plus a hairline ring, never an accent fill — DESIGN.md's
   anti-patterns table forbids the latter by name. */
.sv-navitem.active {
  background: var(--active-bg);
  box-shadow: inset 0 0 0 1px var(--active-ring);
  color: var(--text-strong);
}
.sv-navitem.danger { color: #f0716f; }
.sv-navitem.danger:hover { background: rgba(237,66,69,.12); color: #ff8785; }
.sv-navsep { height: 1px; background: var(--divider); margin: 12px 10px; }

/* ── Content ── */
.sv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
/* The right padding is a gutter for the close button, which is positioned
   over this area. Without it the X lands on top of whatever sits at the top
   right of a page — on Server Profile that is the preview card. */
.sv-scroll { flex: 1; overflow: hidden auto; padding: 60px 104px 80px 40px; }
/* Wide enough for a form column with a sidebar beside it. 740 was a reading
   measure, which is the right number for a page of prose and the wrong one
   here: it squeezed the form to 400px and left 350px of the window empty.
   Individual pages set their own text measure inside this. */
.sv-scroll > * { max-width: 940px; }

/*
 * Page switch. Clicked tens of times in a sitting, so it is deliberately
 * almost nothing: 120ms, opacity and a 4px rise, no horizontal slide. Enough
 * that the pane does not hard-cut, short enough that it never stands between
 * you and the thing you clicked. `mode="out-in"` because two settings pages
 * crossfading through each other is legible as neither.
 */
.sv-page-enter-active { transition: opacity var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out); }
.sv-page-leave-active { transition: opacity 90ms var(--ease-in); }
.sv-page-enter-from { opacity: 0; transform: translateY(4px); }
.sv-page-leave-to { opacity: 0; }

/* ── Close ── */
.sv-close {
  position: absolute; top: 60px; right: 40px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  background: none; border: none; cursor: pointer; color: var(--text-3);
  transition: color var(--dur-1) var(--ease-out);
}
.sv-close-x {
  width: 36px; height: 36px; border-radius: 50%;
  border: 2px solid currentColor;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.sv-close-esc { font-size: 11px; font-weight: 700; letter-spacing: .4px; }
.sv-close:hover { color: var(--text-strong); }
.sv-close:hover .sv-close-x { background: var(--hover); }
.sv-close:active .sv-close-x { transform: scale(.94); }

.sv-back {
  display: none;
  align-items: center; gap: 6px;
  padding: 14px 16px; font-size: 15px; font-weight: 600;
  color: var(--text-1); background: none; border: none; cursor: pointer;
  font-family: inherit; text-align: left;
}

/* ── Phone: two screens, the nav pushed aside by the detail ── */
@media (max-width: 768px) {
  .sv { overflow: hidden; }
  .sv-nav, .sv-main {
    position: absolute; inset: 0; width: 100%;
    transition: transform var(--dur-3) var(--ease-out), opacity var(--dur-3) var(--ease-out);
  }
  .sv-nav { z-index: 1; justify-content: flex-start; }
  .sv-nav-inner { width: 100%; padding: 20px 12px 40px; }
  .sv-main { z-index: 2; transform: translate3d(100%, 0, 0); background: var(--bg-raised); }
  .sv.m-detail .sv-nav { transform: translate3d(-28%, 0, 0); opacity: .6; }
  .sv.m-detail .sv-main { transform: translate3d(0, 0, 0); box-shadow: -8px 0 24px rgba(0,0,0,.45); }
  .sv-navitem { min-height: 44px; }
  .sv-back { display: flex; }
  .sv-scroll { padding: 4px 16px 60px; max-width: none; }
  .sv-scroll > * { max-width: none; }
}
</style>
