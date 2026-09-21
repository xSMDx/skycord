/**
 * What the title bar shows, as plain data. The web client reports it; nothing
 * it sends reaches the title bar or the window frame without passing through
 * here. No Electron, so it is tested alone.
 */

export type TitleKind = 'friends' | 'dms' | 'server' | 'discover' | 'picker' | 'app'
const KINDS: readonly TitleKind[] = ['friends', 'dms', 'server', 'discover', 'picker', 'app']

export interface TitleState {
  title: string
  kind: TitleKind
  icon: string | null
  canBack: boolean
  canForward: boolean
}

export interface TitleColors { bar: string; text: string; muted: string }

/** The app's own dark rail: what the bar is before a client says otherwise. */
export const DEFAULT_COLORS: TitleColors = { bar: '#111214', text: '#dcddde', muted: '#abb1b8' }

const iconFrom = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 100_000) return null
  // SVG included: inside an <img> it cannot run script.
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(v)) return v
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

export const parseTitleState = (value: unknown): TitleState | null => {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const title = typeof v.title === 'string' ? v.title.replace(/\s+/g, ' ').trim().slice(0, 100) : ''
  return {
    title,
    kind: KINDS.includes(v.kind as TitleKind) ? v.kind as TitleKind : 'app',
    icon: iconFrom(v.icon),
    canBack: v.canBack === true,
    canForward: v.canForward === true,
  }
}

const HEX = /^#[0-9a-f]{6}$/i

/** Plain #rrggbb only: these reach the window frame's own buttons. */
export const parseColors = (value: unknown): TitleColors | null => {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const all = [v.bar, v.text, v.muted]
  if (!all.every(c => typeof c === 'string' && HEX.test(c))) return null
  return { bar: (v.bar as string).toLowerCase(), text: (v.text as string).toLowerCase(), muted: (v.muted as string).toLowerCase() }
}
