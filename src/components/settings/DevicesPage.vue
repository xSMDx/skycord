<script setup lang="ts">
/**
 * Settings → Devices.
 *
 * The one screen whose whole job is answering "is that login mine?", so it is
 * built around making a wrong row obvious rather than around looking tidy: the
 * address, the country and the time it was last used are the answer, and they
 * sit on the row rather than behind a disclosure.
 *
 * This is Operate surface — rows, not cards, and no colour that isn't carrying
 * information. The only two accents on the page are the badge on your own
 * device and the red on the two things that sign someone out.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Monitor, Smartphone, Tablet, HelpCircle, ShieldCheck } from 'lucide-vue-next'
import { useApi, type ApiSession } from '@/composables/useApi'
import CountryFlag from './CountryFlag.vue'

const { listSessions, revokeSession, revokeOtherSessions } = useApi()

const sessions  = ref<ApiSession[]>([])
const loading   = ref(true)
const error     = ref('')
const busyId    = ref<string | null>(null)
const busyAll   = ref(false)
const confirmAll = ref(false)

const emit = defineEmits<{ (e: 'signed-out'): void }>()

const ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet, unknown: HelpCircle }

/** Your own device first, then most recently used. */
const ordered = computed(() =>
  [...sessions.value].sort((a, b) =>
    Number(b.current) - Number(a.current) ||
    +new Date(b.lastSeenAt) - +new Date(a.lastSeenAt)))

const others = computed(() => sessions.value.filter(s => !s.current).length)

const load = async () => {
  try {
    error.value = ''
    sessions.value = (await listSessions()).sessions
  } catch {
    error.value = 'Could not load your devices.'
  } finally {
    loading.value = false
  }
}

// ── Relative time ──────────────────────────────────────────────────────────
// Intl.RelativeTimeFormat rather than a hand-rolled ladder: it gets the plurals
// and the reader's own language right, and this screen is one of the few where
// "2 days ago" versus "2 day ago" is read closely.
const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536e6], ['month', 2592e6], ['week', 6048e5],
  ['day', 864e5], ['hour', 36e5], ['minute', 6e4],
]

/** Re-rendered on a timer so "Active now" doesn't sit there for an hour. */
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null

const ago = (iso: string) => {
  const diff = now.value - +new Date(iso)
  // Anything inside the touch window is, for this screen's purposes, live —
  // the server only writes lastSeenAt every five minutes.
  if (diff < 5 * 6e4) return 'Active now'
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return RTF.format(-Math.round(diff / ms), unit)
  }
  return 'Active now'
}

const firstSeen = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

onMounted(() => { load(); tick = setInterval(() => { now.value = Date.now() }, 30_000) })
onUnmounted(() => { if (tick) clearInterval(tick) })

// ── Signing out ────────────────────────────────────────────────────────────
const signOutOne = async (s: ApiSession) => {
  busyId.value = s.id
  try {
    const res = await revokeSession(s.id)
    sessions.value = sessions.value.filter(x => x.id !== s.id)
    // Revoking your own row is a sign-out. Holding an access token for a dead
    // session and pretending otherwise would leave the app working for up to
    // fifteen minutes and then failing with no explanation.
    if (res.current) emit('signed-out')
  } catch {
    error.value = `Could not sign out ${s.label}.`
  } finally { busyId.value = null }
}

const signOutOthers = async () => {
  busyAll.value = true
  try {
    await revokeOtherSessions()
    sessions.value = sessions.value.filter(s => s.current)
    confirmAll.value = false
  } catch {
    error.value = 'Could not sign out the other devices.'
  } finally { busyAll.value = false }
}
</script>

<template>
  <h2 class="acc-section-title">Logged-in Devices</h2>
  <p class="dv-hint">
    Everywhere your account is currently signed in. If you don't recognise a
    device, sign it out and then change your password.
  </p>

  <p v-if="error" class="dv-error" role="alert">{{ error }}</p>

  <!-- Skeleton rather than a spinner: the list has a known shape, so the page
       can hold its final height and not jump when the data lands. -->
  <div v-if="loading" class="acc-card" aria-busy="true">
    <div v-for="n in 2" :key="n" class="dv-row">
      <div class="dv-icon dv-skel" />
      <div class="dv-main">
        <div class="dv-skel dv-skel-line" style="width: 140px" />
        <div class="dv-skel dv-skel-line" style="width: 210px; height: 12px; margin-top: 8px" />
      </div>
    </div>
  </div>

  <!-- `&& !error` because an empty list after a FAILED load is not an empty
       list. Without it the page said "Could not load your devices" and "no
       devices are signed in" one under the other — the second of which is a
       claim the page has no basis for. -->
  <div v-else-if="!sessions.length && !error" class="acc-card dv-empty">
    <ShieldCheck :size="20" :stroke-width="1.5" />
    <!-- Not "no OTHER devices": an empty list means this one is missing too,
         which happens on a cookie issued before sessions existed and not yet
         refreshed. Claiming otherwise would be wrong in the only case that
         reaches here. -->
    <span>No signed-in devices to show. Sign in again and this one will appear here.</span>
  </div>

  <div v-else class="acc-card">
    <div
      v-for="(s, i) in ordered" :key="s.id"
      class="dv-row" :class="{ current: s.current }"
    >
      <div v-if="i" class="dv-divider" />

      <div class="dv-icon"><component :is="ICONS[s.kind]" :size="18" :stroke-width="1.5" /></div>

      <div class="dv-main">
        <div class="dv-title">
          <span class="dv-label">{{ s.label }}</span>
          <span v-if="s.current" class="dv-badge">This device</span>
        </div>

        <div class="dv-meta">
          <!-- Flag immediately left of the address it belongs to. -->
          <CountryFlag v-if="s.country" :code="s.country" />
          <span class="dv-ip">{{ s.ip || 'Unknown address' }}</span>
          <span class="dv-dot">·</span>
          <span class="dv-time" v-tip="`First seen ${firstSeen(s.createdAt)}`">{{ ago(s.lastSeenAt) }}</span>
        </div>
      </div>

      <!-- No button on your own row. Signing yourself out belongs on the Log
           Out control in the nav, where people already look for it — offering
           it here too invites the misread that this row is someone else. -->
      <button
        v-if="!s.current"
        class="dv-signout" :disabled="busyId === s.id"
        @click="signOutOne(s)"
      >{{ busyId === s.id ? 'Signing out…' : 'Sign out' }}</button>
    </div>
  </div>

  <div v-if="others > 0" class="dv-footer">
    <template v-if="!confirmAll">
      <button class="dv-all" @click="confirmAll = true">
        Sign out all other devices
      </button>
    </template>
    <template v-else>
      <!-- Inline confirm rather than a modal: nothing here needs protected
           focus, and the count is the part worth reading before committing. -->
      <span class="dv-confirm-q">Sign out {{ others }} other {{ others === 1 ? 'device' : 'devices' }}?</span>
      <button class="dv-confirm-no" :disabled="busyAll" @click="confirmAll = false">Cancel</button>
      <button class="dv-confirm-yes" :disabled="busyAll" @click="signOutOthers">
        {{ busyAll ? 'Signing out…' : 'Sign out' }}
      </button>
    </template>
  </div>

  <p class="dv-credit">
    Locations are estimated from the IP address using an offline database
    (<a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">DB-IP</a>,
    CC&nbsp;BY&nbsp;4.0) — nothing about you is sent anywhere to produce them.
    VPNs and mobile networks are often placed in the wrong country.
  </p>
</template>

<style scoped>
/*
 * `.acc-section-title` and `.acc-card` are the settings shell's own classes,
 * repeated here rather than inherited. SettingsModal's <style> is scoped, so
 * its rules carry that component's data-v hash and never match elements this
 * component renders — the markup looked right and painted nothing: no panel,
 * no radius, and the heading falling back to a bare 24px h2.
 *
 * Same names on purpose. A parallel `dv-card` vocabulary would hide that this
 * is the same pattern; these values must track SettingsModal's if either moves.
 */
.acc-section-title {
  font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px;
  color: var(--text-3); margin: 0 0 10px;
}
.acc-card {
  background: var(--bg-panel); border-radius: 10px; overflow: hidden;
  /* Queried below. The settings modal's width does not track the viewport —
     it has its own nav column and its own breakpoints — so a viewport media
     query would fire at the wrong moment in both directions. */
  container-type: inline-size;
}

.dv-hint { font-size: 13px; line-height: 1.5; color: var(--text-3); margin: 0 0 14px; max-width: 62ch; }

/*
 * The reds here are lighter than the app's `#ed4245`, and measured rather than
 * eyeballed. That value is 3.59:1 on the settings panel and 4.25:1 on the
 * shell — under AA for text at these sizes. `#f56c6f` clears it on both
 * (4.77 / 5.64) and still reads as the same colour; the hover pair goes lighter
 * again because the tint underneath raises the floor. The filled button uses
 * the darker `#c93b3e` so its white label clears (5.03, against 3.84 on
 * `#ed4245`).
 *
 * The rest of the app still uses the darker red for danger text — a token-level
 * fix, not one to make quietly from inside this page.
 */
.dv-error {
  font-size: 13px; color: #f56c6f;
  background: rgba(245, 108, 111, .1);
  border-radius: var(--edge-md, 6px);
  padding: 9px 12px; margin-bottom: 12px;
}

/* Rows, not cards — the divider is drawn by the row so the first one has none
   and the card keeps its rounded corners with no extra wrapper. */
.dv-row {
  position: relative;
  display: flex; align-items: center; gap: 14px;
  padding: 16px 20px;
}
.dv-divider {
  position: absolute; top: 0; left: 20px; right: 20px;
  height: 1px; background: var(--divider);
}

.dv-icon {
  width: 38px; height: 38px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: var(--bg-input); color: var(--text-2);
}
.dv-row.current .dv-icon {
  background: rgba(var(--accent-rgb), .18);
  color: var(--accent-text);
}

.dv-main { flex: 1; min-width: 0; }

.dv-title { display: flex; align-items: center; gap: 8px; }
.dv-label {
  font-size: 15px; font-weight: 600; color: var(--text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dv-badge {
  flex-shrink: 0;
  font-size: 10px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--accent-text);
  background: rgba(var(--accent-rgb), .18);
  padding: 3px 7px; border-radius: 4px;
}

.dv-meta {
  display: flex; align-items: center; gap: 7px;
  margin-top: 5px;
  font-size: 13px; color: var(--text-3);
  min-width: 0;
}
.dv-ip {
  /* Tabular figures so a column of addresses lines up and a changed digit is
     visible at a glance — the whole reason someone reads this field. */
  font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dv-dot { opacity: .6; }

/*
 * Narrow: the time moves under the address.
 *
 * At 375px the meta line wants 162px and gets 155, so `88.240.12.7` — eleven
 * characters — was ellipsised to fit a relative timestamp beside it. The
 * address is the field this whole screen exists to show; it is the last thing
 * that may be truncated, not the first.
 */
@container (max-width: 420px) {
  .dv-meta { flex-wrap: wrap; row-gap: 3px; }
  .dv-time { flex-basis: 100%; }
  /* A separator with nothing after it on the line. */
  .dv-dot { display: none; }
}

.dv-signout {
  flex-shrink: 0;
  padding: 7px 14px; border-radius: var(--edge-md, 6px);
  font-size: 13px; font-weight: 600;
  color: #f56c6f; background: transparent;
  /* .75 alpha, not .38 — a control boundary needs 3:1 to be a boundary. */
  border: 1px solid rgba(245, 108, 111, .75);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out),
              color var(--dur-1) var(--ease-out);
}
.dv-signout:hover:not(:disabled) { background: rgba(245, 108, 111, .14); border-color: #f56c6f; color: #ff9093; }
.dv-signout:disabled { opacity: .55; cursor: default; }

/* ── Empty and loading ── */
.dv-empty {
  display: flex; align-items: center; gap: 10px;
  padding: 22px 20px;
  font-size: 14px; color: var(--text-3);
}

.dv-skel {
  background: var(--hover);
  border-radius: 4px;
  animation: dv-pulse 1.4s var(--ease-inout) infinite;
}
.dv-icon.dv-skel { border-radius: 50%; }
.dv-skel-line { height: 14px; }
@keyframes dv-pulse { 0%, 100% { opacity: .5 } 50% { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .dv-skel { animation: none } }

/* ── Footer actions ── */
.dv-footer { display: flex; align-items: center; gap: 10px; margin-top: 16px; }

.dv-all, .dv-confirm-no, .dv-confirm-yes {
  padding: 9px 16px; border-radius: var(--edge-md, 6px);
  font-size: 14px; font-weight: 600; cursor: pointer;
  border: none; background: transparent;
  transition: background var(--dur-1) var(--ease-out);
}
.dv-all { color: #f56c6f; border: 1px solid rgba(245, 108, 111, .75); }
.dv-all:hover { background: rgba(245, 108, 111, .14); border-color: #f56c6f; color: #ff9093; }

.dv-confirm-q { font-size: 14px; color: var(--text-1); margin-right: 2px; }
.dv-confirm-no { color: var(--text-2); }
.dv-confirm-no:hover:not(:disabled) { background: var(--hover); }
.dv-confirm-yes { background: #c93b3e; color: #fff; }
.dv-confirm-yes:hover:not(:disabled) { background: #a83133; }
.dv-confirm-yes:disabled, .dv-confirm-no:disabled { opacity: .55; cursor: default; }

.dv-credit {
  margin-top: 18px;
  font-size: 12px; line-height: 1.55; color: var(--text-faint);
  max-width: 62ch;
}
.dv-credit a { color: var(--text-3); text-decoration: underline; text-underline-offset: 2px; }
.dv-credit a:hover { color: var(--text-1); }
</style>
