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
/** What a status resolves to once reachability and idle are folded in — the
 *  server's effectiveStatus() produces exactly these four. `invisible` is a
 *  CHOICE, never an effective value; it reaches the UI as 'offline'. */
export type EffectiveStatus = 'online' | 'idle' | 'dnd' | 'offline'

export const effectiveSelfStatus = ref<EffectiveStatus>('offline')

/**
 * How long without input before we call it idle.
 *
 * Five minutes by default: short enough to be honest about whether you are
 * really there, long enough that reading a long message or watching a screen
 * share does not flip you to Idle mid-conversation. Adjustable because the
 * right answer depends on how you use it — someone who leaves Skycord open on
 * a second monitor wants longer than someone who checks in between tasks.
 *
 * Stored in minutes because that is the unit the setting is written in;
 * converting once here keeps the timer in milliseconds where it belongs.
 */
const IDLE_KEY = 'skycord.idleMinutes'
export const IDLE_MIN = 1, IDLE_MAX = 60
export const DEFAULT_IDLE_MINUTES = 5

const readIdleMinutes = (): number => {
  const n = Number(localStorage.getItem(IDLE_KEY))
  return Number.isFinite(n) && n >= IDLE_MIN && n <= IDLE_MAX ? n : DEFAULT_IDLE_MINUTES
}

export const idleMinutes = ref(readIdleMinutes())

/** Changing it restarts the countdown, so a shorter value takes effect now
 *  rather than after the old one finally expires. */
export const setIdleMinutes = (n: number): void => {
  const v = Math.min(IDLE_MAX, Math.max(IDLE_MIN, Math.round(n)))
  idleMinutes.value = v
  localStorage.setItem(IDLE_KEY, String(v))
  if (wired) bumpActivity()
}

let idleTimer: ReturnType<typeof setTimeout> | null = null
let away = false
let wired = false

const emitAway = (next: boolean) => {
  if (away === next) return
  away = next
  getSocket()?.emit('presence:away', { away: next })
}

/**
 * Held open while something proves you are here even though this tab is not
 * being touched — a voice call, today. Set by useVoice rather than read from
 * it, because usePresence must not import the voice stack: useVoice already
 * imports useSocket, which imports this file.
 */
let presenceHeld = false
export const holdPresence = (held: boolean): void => {
  presenceHeld = held
  // Coming back from a hold should not inherit a countdown that expired
  // while it was in force, and going into one should clear any idle already
  // set — you are demonstrably here.
  bumpActivity()
}

/**
 * Go idle — unless something is actively vouching for you.
 *
 * Being in a voice call is stronger evidence of presence than a mouse move:
 * you are audibly in the room. Alt-tabbing to a game mid-sentence used to
 * mark you idle instantly, which told everyone you had wandered off while
 * they were listening to you talk.
 */
const goIdle = () => { if (!presenceHeld) emitAway(true) }

/** Any sign of life resets the countdown and pulls you back from idle. */
const bumpActivity = () => {
  emitAway(false)
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(goIdle, idleMinutes.value * 60 * 1000)
}

/**
 * Start watching for inactivity. Idempotent — safe to call from more than one
 * component without stacking listeners.
 */
export const startIdleWatch = () => {
  // Already listening: restart the countdown rather than returning. This
  // used to be a bare `return`, and stopIdleWatch only clears the timer —
  // it never unsets `wired`. So logging out and back in left the flag true,
  // the early return fired, no timer was ever scheduled again, and idle
  // detection was silently dead for the rest of the session. The listeners
  // themselves are fine to keep: they only reset a timer, and rebinding them
  // would stack a duplicate set on every login.
  if (wired) { bumpActivity(); return }
  wired = true

  // `passive` on the scroll/touch listeners: these only reset a timer and must
  // never sit in the way of scrolling.
  const opts = { passive: true } as AddEventListenerOptions
  for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'])
    window.addEventListener(ev, bumpActivity, opts)

  // Switching tabs or locking the phone is a stronger signal than a quiet
  // mouse — go idle immediately rather than waiting out the full timer.
  document.addEventListener('visibilitychange', () => {
    // Hiding the tab used to go idle IMMEDIATELY, ignoring the delay you
    // configured entirely — alt-tab for ten seconds and you were away. It is
    // a reason to stop resetting the countdown, not a reason to skip it: a
    // hidden tab and an idle person are different claims. Coming back is
    // still real activity and clears it at once.
    if (!document.hidden) bumpActivity()
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
/**
 * Everyone else's live status, in one place.
 *
 * The `presence` socket event used to be applied by hand to each surface
 * that displayed a status: find the user in the friends array and write to
 * their copy, find them in the DM array and write to that copy. Group
 * members were never in that list, so a group member's dot was frozen at
 * whatever it was when the group loaded — someone could go offline and stay
 * green for as long as you had the group open.
 *
 * The missing line was not the real problem. Every surface holding its own
 * copy means the handler has to remember each one, and the next surface (the
 * server member list) would have been missed exactly the same way. So the
 * event writes here once, and surfaces ASK rather than being told.
 */
export const presenceById = ref<Record<string, EffectiveStatus>>({})

const EFFECTIVE: readonly string[] = ['online', 'idle', 'dnd', 'offline']
const isEffective = (s: unknown): s is EffectiveStatus =>
  typeof s === 'string' && EFFECTIVE.includes(s)

/** Record what the wire just said about someone. */
export const applyPresence = (userId: string, status: string | null | undefined): void => {
  // An unrecognised status is dropped rather than stored. The server
  // serialises through effectiveStatus so this should be unreachable, but a
  // value that slips through renders as a grey dot labelled with the literal
  // word — which is how `invisible` once leaked into the UI as a visible
  // state instead of reading as offline.
  if (!userId || !isEffective(status)) return
  presenceById.value = { ...presenceById.value, [userId]: status }
}

/**
 * What to render for a user right now.
 *
 * `fallback` is the status that came with whatever list this surface
 * fetched — correct at fetch time, and the best thing known until an event
 * says otherwise. A live value always wins; that precedence IS the fix.
 */
export const livePresence = (userId: string, fallback?: string | null): EffectiveStatus =>
  presenceById.value[userId] ?? (isEffective(fallback) ? fallback : 'offline')

/** Logout seam — a second account must not inherit the first one's dots. */
export const resetPresenceMap = (): void => { presenceById.value = {} }
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
