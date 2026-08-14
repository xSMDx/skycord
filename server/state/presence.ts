/**
 * Who is currently connected, and what everyone else is allowed to see.
 *
 * Lives in its own module because BOTH the socket layer (which owns the
 * registry) and the User model (which serialises status for the wire) need it.
 * Importing it from `sockets/chatSocket` instead would create a cycle —
 * chatSocket already imports User.
 *
 * ── The three-way split, and why it matters ────────────────────────────────
 * `User.status` in the database is ONLY ever the user's own choice. It is
 * never written by a connect or a disconnect. Two other facts combine with it
 * at the moment of serialisation:
 *
 *   chosen     persisted   online | idle | dnd | invisible
 *   away       ephemeral   the client reported no input for a while
 *   connected  in-memory   this process has a live socket for them
 *
 * They used to be one field, and connection always won: signing in overwrote
 * your choice with 'online' and signing out overwrote it with 'offline', so
 * "Do Not Disturb" survived exactly until you closed the tab.
 *
 * ── Invisibility is computed, never stored on the wire ─────────────────────
 * `effectiveStatus` is the only thing that reaches another user, and it maps
 * invisible → offline. There is deliberately no field anywhere in a public
 * payload that says "invisible", because a client that receives one can
 * display it, and the entire point of invisible is that it is indistinguishable
 * from being offline.
 */

export type ChosenStatus    = 'online' | 'idle' | 'dnd' | 'invisible'
export type EffectiveStatus = 'online' | 'idle' | 'dnd' | 'offline'

export const CHOSEN_STATUSES: ChosenStatus[] = ['online', 'idle', 'dnd', 'invisible']
export const isChosenStatus = (v: unknown): v is ChosenStatus =>
  typeof v === 'string' && (CHOSEN_STATUSES as string[]).includes(v)

/** userId → set of live socket ids. A user with several tabs has several. */
const sockets = new Map<string, Set<string>>()

/** userIds whose client has reported itself idle. Cleared on disconnect. */
const away = new Set<string>()

export const addSocket = (userId: string, socketId: string): boolean => {
  let set = sockets.get(userId)
  const wasOffline = !set || set.size === 0
  if (!set) { set = new Set(); sockets.set(userId, set) }
  set.add(socketId)
  return wasOffline
}

/** Returns true when this was the user's LAST socket. */
export const removeSocket = (userId: string, socketId: string): boolean => {
  const set = sockets.get(userId)
  if (!set) return false
  set.delete(socketId)
  if (set.size > 0) return false
  sockets.delete(userId)
  away.delete(userId)      // idleness is per-session, not remembered
  return true
}

export const isOnline = (userId: string): boolean => (sockets.get(userId)?.size ?? 0) > 0
export const socketCount = (userId: string): number => sockets.get(userId)?.size ?? 0
export const onlineUserIds = (): string[] => [...sockets.keys()]

export const setAway = (userId: string, isAway: boolean): void => {
  if (isAway) away.add(userId); else away.delete(userId)
}
export const isAway = (userId: string): boolean => away.has(userId)

/**
 * What everyone else sees. The ONLY status that should ever be broadcast or
 * serialised for a third party.
 *
 * Auto-idle applies to 'online' alone. Someone who picked Do Not Disturb and
 * walked away still means Do Not Disturb — silently demoting that to Idle
 * would tell their friends it's fine to ping them.
 */
export const effectiveStatus = (chosen: string | null | undefined, userId: string): EffectiveStatus => {
  if (!isOnline(userId)) return 'offline'
  const c: ChosenStatus = isChosenStatus(chosen) ? chosen : 'online'
  if (c === 'invisible') return 'offline'
  if (c === 'online' && isAway(userId)) return 'idle'
  return c
}

/** Test/reset seam — a fresh process must not inherit a previous run's map. */
export const resetPresence = (): void => { sockets.clear(); away.clear() }
