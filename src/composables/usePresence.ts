/**
 * Your own status: what you picked, and whether you've wandered off.
 *
 * The server owns the truth (see server/state/presence.ts) — this is the
 * client half: it sends your choice, reports inactivity so auto-idle can
 * apply, and holds the raw choice locally so the picker can show "Invisible"
 * ticked while everyone else is being told you're offline.
 */
import { ref, computed } from 'vue'
import { getSocket } from './useSocket'

export type ChosenStatus = 'online' | 'idle' | 'dnd' | 'invisible'

/** What you picked. Mirrors User.status on the server. */
export const chosenStatus = ref<ChosenStatus>('online')
/** What your friends are currently being told. */
export const effectiveSelfStatus = ref<'online' | 'idle' | 'dnd' | 'offline'>('offline')

/**
 * How long without input before we call it idle.
 *
 * Ten minutes, matching Discord. Short enough to be honest about whether
 * you're really there, long enough that reading a long message or watching a
 * screen share doesn't flip you to Idle mid-conversation.
 */
const IDLE_AFTER_MS = 10 * 60 * 1000

let idleTimer: ReturnType<typeof setTimeout> | null = null
let away = false
let wired = false

const emitAway = (next: boolean) => {
  if (away === next) return
  away = next
  getSocket()?.emit('presence:away', { away: next })
}

const goIdle = () => emitAway(true)

/** Any sign of life resets the countdown and pulls you back from idle. */
const bumpActivity = () => {
  emitAway(false)
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(goIdle, IDLE_AFTER_MS)
}

/**
 * Start watching for inactivity. Idempotent — safe to call from more than one
 * component without stacking listeners.
 */
export const startIdleWatch = () => {
  if (wired) return
  wired = true

  // `passive` on the scroll/touch listeners: these only reset a timer and must
  // never sit in the way of scrolling.
  const opts = { passive: true } as AddEventListenerOptions
  for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'])
    window.addEventListener(ev, bumpActivity, opts)

  // Switching tabs or locking the phone is a stronger signal than a quiet
  // mouse — go idle immediately rather than waiting out the full timer.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) goIdle(); else bumpActivity()
  })
  window.addEventListener('blur', () => { /* focus loss alone isn't away */ })
  window.addEventListener('focus', bumpActivity)

  bumpActivity()
}

export const stopIdleWatch = () => {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
}

/** Tell the server you picked a status. Resolves once it's saved. */
export const setChosenStatus = (status: ChosenStatus): Promise<boolean> =>
  new Promise((resolve) => {
    const s = getSocket()
    if (!s?.connected) { resolve(false); return }
    // Optimistic: the picker should tick instantly, not after a round-trip.
    chosenStatus.value = status
    s.emit('presence:set', { status }, (r: any) => {
      if (r?.ok) { chosenStatus.value = r.status; effectiveSelfStatus.value = r.effective }
      resolve(!!r?.ok)
    })
  })

/** Called by useSocket when the server echoes our own status back. */
export const applySelfPresence = (p: { status?: string; effective?: string }) => {
  if (p.status)    chosenStatus.value = p.status as ChosenStatus
  if (p.effective) effectiveSelfStatus.value = p.effective as any
}

// ── Display helpers, shared by every surface that renders a status dot ──────
// Previously each site inlined its own map and none of them had a case for
// 'invisible', so it fell through to grey with the literal string "invisible"
// as its label.
const COLORS: Record<string, string> = {
  online: '#23a55a', idle: '#f0a500', dnd: '#ed4245',
  offline: '#80848e', invisible: '#80848e',
}
const LABELS: Record<string, string> = {
  online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb',
  offline: 'Offline', invisible: 'Invisible',
}
export const statusColor = (s: string | null | undefined) => COLORS[s ?? ''] ?? COLORS.offline
export const statusLabel = (s: string | null | undefined) => LABELS[s ?? ''] ?? LABELS.offline

/** Your own dot: shows the choice, so invisible reads as invisible to you. */
export const selfStatusColor = computed(() => statusColor(chosenStatus.value))
export const selfStatusLabel = computed(() => statusLabel(chosenStatus.value))
