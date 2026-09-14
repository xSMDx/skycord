/**
 * The member list's search. Client-side because a server's member list is
 * capped at 100 — a request per keystroke would cost more than it saves.
 * Accents are folded so a name typed without them still matches.
 */
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()

export const filterMembers = <T extends { username: string; displayName?: string | null }>(
  groups: { online: T[]; offline: T[] },
  query: string,
): { online: T[]; offline: T[] } => {
  const q = fold(query.trim())
  if (!q) return groups
  const hit = (x: T) => fold(x.displayName ?? '').includes(q) || fold(x.username).includes(q)
  return { online: groups.online.filter(hit), offline: groups.offline.filter(hit) }
}
