/**
 * The member list's search. Client-side because a server's member list is
 * capped at 100 — a request per keystroke would cost more than it saves.
 * Accents are folded so a name typed without them still matches.
 *
 * toLowerCase, never toLocaleLowerCase: the locale version follows the
 * browser, and in Turkish it lowers "I" to a dotless "ı", so "Ivan" stopped
 * matching "ivan". ß folds to ss, which is how a German name is also typed.
 */
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss')

export const filterMembers = <T extends { username: string; displayName?: string | null }>(
  groups: { online: T[]; offline: T[] },
  query: string,
): { online: T[]; offline: T[] } => {
  const q = fold(query.trim())
  if (!q) return groups
  const hit = (x: T) => fold(x.displayName ?? '').includes(q) || fold(x.username).includes(q)
  return { online: groups.online.filter(hit), offline: groups.offline.filter(hit) }
}
