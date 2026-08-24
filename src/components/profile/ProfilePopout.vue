<script setup lang="ts">
/**
 * The anchored profile popout — your own (from the user panel) and other
 * people's (from a member row). One component for both: the card is identical
 * and only the action rows differ, so splitting it would guarantee drift.
 *
 * Positioned FIXED and measured from the anchor rather than absolutely: both
 * the left sidebar and the members panel have `overflow: hidden`, which clips
 * an absolutely-positioned panel and renders it squashed inside the rail.
 */
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue'
import {
  Pencil, ChevronRight, IdCard, Check, UserRoundCog,
  MessageCircle, UserPlus, UserMinus, ExternalLink,
} from 'lucide-vue-next'
import ProfileCard from './ProfileCard.vue'
import AnchoredPanel from '@/components/ui/AnchoredPanel.vue'
import { useAuth } from '@/composables/useAuth'
import { useApi } from '@/composables/useApi'
import { statusColor, chosenStatus } from '@/composables/usePresence'

const props = withDefaults(defineProps<{
  /** Whose profile. When it matches the signed-in user, the self rows show. */
  userId:  string
  anchor:  HTMLElement | null
  /** Seed from the row that was clicked so the card paints immediately
   *  instead of flashing empty while the fetch lands. */
  seed?:   Record<string, any> | null
  placement?: 'above' | 'left'
}>(), { seed: null, placement: 'above' })

const emit = defineEmits<{
  close: []; editProfile: []; setStatus: []; message: [user: Record<string, any>]
  viewFull: [id: string]; toast: [msg: string]; setPresence: [status: string, minutes?: number]
}>()

const { user: authUser } = useAuth()
const { getUserProfile, sendFriendRequest, removeFriend } = useApi()

const isSelf = computed(() => authUser.value?.id === props.userId)

// Start from the seed (or the auth user), then replace with the fetched
// profile. Members lists don't carry banner or custom status, so without the
// fetch the card would be missing exactly the parts this feature added.
const data = ref<Record<string, any> | null>(props.seed)
const relationship = ref<'none' | 'friends' | 'incoming' | 'outgoing' | 'blocked'>('none')
const busy = ref(false)

const view = computed(() => (isSelf.value ? authUser.value : data.value) as Record<string, any> | null)

const load = async () => {
  if (isSelf.value) return
  try {
    const res: any = await getUserProfile(props.userId)
    data.value = res.user
    relationship.value = res.relationship
    await place()               // richer card can be taller
  } catch { /* keep the seed on screen rather than blanking it */ }
}
watch(() => props.userId, () => { data.value = props.seed; void load() })

const panel = ref<HTMLElement | null>(null)
const pos   = ref<{ left: number; top: number } | null>(null)
const GAP = 10, EDGE = 8

const place = async () => {
  await nextTick()
  const a = props.anchor?.getBoundingClientRect()
  const p = panel.value
  if (!a || !p) return
  const w = p.offsetWidth, h = p.offsetHeight
  let left: number, top: number

  if (props.placement === 'left') {
    // Members panel sits on the right edge, so open toward the middle; flip
    // back across the anchor when there isn't room.
    left = a.left - w - GAP
    if (left < EDGE) left = Math.min(a.right + GAP, window.innerWidth - w - EDGE)
    top = a.top
  } else {
    left = a.left
    top  = a.top - h - GAP        // the user panel is pinned to the bottom
    if (top < EDGE) top = Math.min(a.bottom + GAP, window.innerHeight - h - EDGE)
  }
  left = Math.min(Math.max(EDGE, left), window.innerWidth  - w - EDGE)
  top  = Math.min(Math.max(EDGE, top),  window.innerHeight - h - EDGE)
  pos.value = { left, top }
}

/**
 * The four statuses you can CHOOSE.
 *
 * Colours come from usePresence rather than being written out again here.
 * They used to be a second copy, and the copies had drifted — idle was
 * #f0b232 here against #f0a500 there, dnd #f23f43 against #ed4245 — so the
 * dot in this picker did not match the dot on your own avatar two
 * centimetres away.
 *
 * The notes are not decoration. Do Not Disturb suppresses notifications and
 * Invisible makes you read as offline to everyone — both are invisible to
 * the person choosing them, so a label alone asks them to guess.
 */
/*
 * `chevron` is presentational and deliberately leads nowhere.
 *
 * In Discord these three rows open a duration submenu — "for 1 hour",
 * "until tomorrow" — and the status reverts by itself. That needs the expiry
 * stored and reverted server-side, since the browser may well be closed when
 * the hour is up, and it is not built. The user asked for the shape now and
 * the behaviour later, knowing that. Do not 'fix' this by wiring an empty
 * submenu; wire the real thing or take the chevrons out.
 */
const PRESENCE = [
  { id: 'online',    label: 'Online',         note: '',                                    chevron: false },
  { id: 'idle',      label: 'Idle',           note: 'Shown as away',                       chevron: true  },
  { id: 'dnd',       label: 'Do Not Disturb', note: 'You will not receive notifications',  chevron: true  },
  { id: 'invisible', label: 'Invisible',      note: 'You will appear offline',             chevron: true  },
] as const
const showPresence = ref(false)
/**
 * The duration list, one status at a time. Clicking a status row still sets
 * it instantly and forever — the chevron is the ONLY thing that opens this,
 * so the fast path stays one click and the timed path is a deliberate second
 * one. Reset alongside showPresence so a reopened menu never starts with a
 * stale submenu already unfolded.
 */
const openDurations = ref<string | null>(null)
/** The chevron the duration panel is pinned to. */
const durationAnchor = ref<HTMLElement | null>(null)
const toggleDurations = (e: MouseEvent, id: string) => {
  const open = openDurations.value === id
  openDurations.value  = open ? null : id
  durationAnchor.value = open ? null : (e.currentTarget as HTMLElement)
}
const DURATIONS = [
  { label: 'For 15 Minutes', minutes: 15 },
  { label: 'For 1 Hour',     minutes: 60 },
  { label: 'For 8 Hours',    minutes: 480 },
  { label: 'For 24 Hours',   minutes: 1440 },
  { label: 'For 3 Days',     minutes: 4320 },
  { label: 'Forever',        minutes: undefined },
] as const
const pick = (id: string, minutes?: number) => {
  emit('setPresence', id, minutes)
  showPresence.value   = false
  openDurations.value  = null
  durationAnchor.value = null
}
/**
 * Your CHOICE, not your effective status.
 *
 * These are different things and the difference is the whole point of the
 * presence model: choose Online and sit still for five minutes and everyone
 * else correctly sees Idle — but you did not choose Idle, and a tick next to
 * it would say you did. Choose Invisible and others see Offline, which is
 * not even in this list, so the tick would land on nothing at all.
 *
 * `chosenStatus` is kept in sync by the `presence:self` event, which exists
 * precisely so the chooser can see their own raw choice.
 */
const currentPresence = computed(() =>
  PRESENCE.find(p => p.id === chosenStatus.value) ?? PRESENCE[0])
// Expanding the list changes the panel height, so it must be re-placed or it
// grows off the bottom of the screen.
const presenceAnchor = ref<HTMLElement | null>(null)
const togglePresence = async (e?: MouseEvent) => {
  const open = showPresence.value
  showPresence.value   = !open
  presenceAnchor.value = open ? null : ((e?.currentTarget as HTMLElement) ?? null)
  // A reopened menu must not start with a stale duration list unfolded.
  openDurations.value  = null
  durationAnchor.value = null
  await place()
}

const addFriend = async () => {
  if (busy.value) return
  busy.value = true
  try { await sendFriendRequest(props.userId); relationship.value = 'outgoing'; emit('toast', 'Friend request sent') }
  catch (e: any) { emit('toast', e?.message || 'Couldn’t send that request') }
  finally { busy.value = false }
}
const unfriend = async () => {
  if (busy.value) return
  busy.value = true
  try { await removeFriend(props.userId); relationship.value = 'none'; emit('toast', 'Friend removed') }
  catch (e: any) { emit('toast', e?.message || 'Couldn’t remove that friend') }
  finally { busy.value = false }
}
const copyId = () => {
  navigator.clipboard.writeText(props.userId)
    .then(() => emit('toast', 'User ID copied'))
    .catch(() => emit('toast', 'Couldn’t copy the User ID'))
  emit('close')
}

const onDocDown = (e: PointerEvent) => {
  const t = e.target as Node
  if (panel.value?.contains(t)) return
  if (props.anchor?.contains(t)) return   // the anchor's own handler toggles us
  // A panel this popout opened but teleported elsewhere — the duration list —
  // is ours even though the DOM says it is outside us. Without this, the
  // pointerdown that tries to pick a duration closes the popout first, the
  // panel unmounts with it, and the click lands on nothing.
  const el = t instanceof Element ? t : t.parentElement
  if (el?.closest('[data-anchored-panel]')) return
  emit('close')
}
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close') }

onMounted(() => {
  void place(); void load()
  document.addEventListener('pointerdown', onDocDown, true)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown, true)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel" class="pp"
      :style="pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { opacity: 0 }"
      role="dialog" :aria-label="isSelf ? 'Your profile' : 'Profile'"
    >
      <ProfileCard
        v-if="view"
        compact
        :status-button="isSelf"
        avatar-opens
        :username="view.username || ''"
        :display-name="view.displayName || view.name"
        :discriminator="view.discriminator"
        :avatar="view.avatar"
        :banner="view.banner"
        :banner-crop="(view as any).bannerCrop"
        :avatar-crop="(view as any).avatarCrop"
        :banner-color="view.bannerColor"
        :status="view.status"
        :custom-status="view.customStatus"
        @edit-status="emit('setStatus')"
        @open-profile="isSelf ? emit('editProfile') : emit('viewFull', userId)"
      >
        <template #footer>
          <!-- ── your own ── -->
          <div v-if="isSelf" class="pp-rows">
            <button class="pp-row" @click="emit('editProfile')">
              <Pencil :size="16" :stroke-width="2.25" /><span>Edit profile</span>
            </button>

            <button class="pp-row" @click="togglePresence($event)">
              <span class="pp-dot" :style="{ background: statusColor(currentPresence.id) }" />
              <span>{{ currentPresence.label }}</span>
              <ChevronRight :size="13" :stroke-width="2.25" class="pp-chev" :class="{ open: showPresence }" />
            </button>
            <!-- Beside the popout, not inside it. The reference cascades: the
                 popout opens a status panel, and a status opens a duration
                 panel. Unfolded in place, four statuses with their
                 descriptions doubled the popout's height and pushed the rows
                 below them toward the bottom of the screen. -->
            <AnchoredPanel v-if="showPresence" :anchor="presenceAnchor" placement="right"
              :width="248" @close="showPresence = false">
              <template v-for="p in PRESENCE" :key="p.id">
                <div class="pp-splitrow">
                  <!-- The row itself sets instantly, forever — unchanged. -->
                  <button class="pp-row sub" @click="pick(p.id)">
                    <span class="pp-dot" :style="{ background: statusColor(p.id) }" />
                    <span class="pp-presence-text">
                      <span>{{ p.label }}</span>
                      <span v-if="p.note" class="pp-presence-note">{{ p.note }}</span>
                    </span>
                    <Check v-if="p.id === chosenStatus" :size="14" :stroke-width="2.25" class="pp-chev" />
                  </button>
                  <!-- Its own button, not an icon inside the row: a nested
                       button is invalid HTML, and this one now has a job — it
                       opens the duration list instead of setting anything. -->
                  <button v-if="p.chevron" class="pp-chev-btn" :class="{ open: openDurations === p.id }"
                    :aria-label="'Set ' + p.label + ' for a limited time'"
                    @click.stop="toggleDurations($event, p.id)">
                    <ChevronRight :size="14" :stroke-width="2.25" />
                  </button>
                </div>
                <!-- Beside the chevron, not beneath it. Six durations
                     unfolded inline pushed Copy user ID off the bottom of a
                     popout already sitting near the screen edge, so choosing
                     "For 3 Days" meant scrolling a menu. -->
                <AnchoredPanel v-if="openDurations === p.id" :anchor="durationAnchor" placement="right"
                  :width="190" @close="openDurations = null">
                  <button v-for="d in DURATIONS" :key="d.label" class="pp-dur"
                    @click="pick(p.id, d.minutes)">{{ d.label }}</button>
                </AnchoredPanel>
              </template>
            </AnchoredPanel>

            <!-- Deliberately inert. The reference has it, and leaving the row
                 out entirely reads as "this app cannot do that" rather than
                 "not yet" — so it is shown, disabled, and says so on hover. -->
            <button class="pp-row" disabled v-tip="'TBD'">
              <UserRoundCog :size="16" :stroke-width="2.25" /><span>Switch Accounts</span>
              <ChevronRight :size="13" :stroke-width="2.25" class="pp-chev" />
            </button>

            <button class="pp-row" @click="copyId">
              <IdCard :size="16" :stroke-width="2.25" /><span>Copy user ID</span>
            </button>
          </div>

          <!-- ── someone else ── -->
          <div v-else class="pp-rows">
            <button class="pp-row" @click="emit('message', view!)">
              <MessageCircle :size="16" :stroke-width="2.25" /><span>Message</span>
            </button>

            <button v-if="relationship === 'none'" class="pp-row" :disabled="busy" @click="addFriend">
              <UserPlus :size="16" :stroke-width="2.25" /><span>Add friend</span>
            </button>
            <button v-else-if="relationship === 'friends'" class="pp-row danger" :disabled="busy" @click="unfriend">
              <UserMinus :size="16" :stroke-width="2.25" /><span>Remove friend</span>
            </button>
            <div v-else-if="relationship === 'outgoing'" class="pp-note">Friend request sent</div>
            <div v-else-if="relationship === 'incoming'" class="pp-note">Wants to be your friend</div>

            <button class="pp-row" @click="emit('viewFull', userId)">
              <ExternalLink :size="16" :stroke-width="2.25" /><span>View full profile</span>
            </button>
            <button class="pp-row" @click="copyId">
              <IdCard :size="16" :stroke-width="2.25" /><span>Copy user ID</span>
            </button>
          </div>
        </template>
      </ProfileCard>
    </div>
  </Teleport>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.pp {
  position: fixed; z-index: 1200; width: 300px;
  border-radius: 10px; overflow: hidden;
  box-shadow: 0 18px 50px rgba(0,0,0,.7);
  animation: pp-in .13s cubic-bezier(.4,0,.2,1);
}
@keyframes pp-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .pp { animation: none; } }

.pp :deep(.pc) { width: 100%; box-shadow: none; border-radius: 0; }

.pp-rows {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,.07);
  display: flex; flex-direction: column; gap: 2px;
}
.pp-row {
  display: flex; align-items: center; gap: 11px; width: 100%; text-align: left;
  padding: 9px 10px; border-radius: 6px; font-size: 14px; color: var(--text-1);
  transition: background .1s;
}
.pp-row:hover:not(:disabled) { background: var(--hover-strong); }
.pp-row:disabled { opacity: .5; cursor: not-allowed; }
.pp-row svg { color: var(--text-2); flex: none; }
.pp-row.sub { padding-left: 18px; font-size: 13.5px; color: var(--text-2); align-items: flex-start; }
/* A status row with a note is two lines, so it stops being vertically
   centred against a single-line sibling — the text stack owns the alignment
   and the dot pins to the first line. */
.pp-presence-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.pp-presence-note { font-size: 11.5px; line-height: 1.3; color: var(--text-faint); white-space: normal; }
.pp-row.sub .pp-dot { margin-top: 5px; }
.pp-row.danger { color: #f0716f; }
.pp-row.danger svg { color: #f0716f; }
/* A status row and the chevron that bounds it in time. The row keeps its
   full-width hover; the chevron is a sibling so both stay valid buttons. */
.pp-splitrow { display: flex; align-items: stretch; }
.pp-splitrow .pp-row { flex: 1; min-width: 0; }
.pp-chev-btn { flex: none; display: flex; align-items: center; padding: 0 8px; background: none; border: none; cursor: pointer; color: var(--text-2); border-radius: 4px; }
.pp-chev-btn:hover { background: var(--hover-strong); }
.pp-chev-btn svg { transition: transform .15s ease; }
.pp-chev-btn.open svg { transform: rotate(90deg); }
.pp-dur {
  display: block; width: 100%; padding: 7px 10px; border-radius: 4px;
  background: none; border: none; cursor: pointer;
  font-size: 13.5px; color: var(--text-2); text-align: left;
}
.pp-dur:hover { background: var(--hover-strong); color: var(--text-1); }
@media (prefers-reduced-motion: reduce) { .pp-chev-btn svg { transition: none; } }
.pp-row.danger:hover:not(:disabled) { background: rgba(237,66,69,.12); }
.pp-dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
.pp-chev { margin-left: auto; color: var(--text-3); transition: transform .14s; }
.pp-chev.open { transform: rotate(90deg); }
.pp-sub { display: flex; flex-direction: column; gap: 2px; }
.pp-note { font-size: 12.5px; color: var(--text-3); padding: 9px 10px; background: var(--hover); border-radius: 6px; }
</style>
