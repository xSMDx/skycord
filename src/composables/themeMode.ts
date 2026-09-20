/**
 * Light, Dark and Automatic — the rules, as pure functions over a small state.
 *
 * `theme` stays what it always was: the id applied to [data-theme]. Every
 * consumer that reads it keeps working. What is new is how it is chosen:
 *
 *   - a family card (Light / Dark) turns Automatic off and shows that family's
 *     last-chosen variant;
 *   - a variant chip is remembered for its family;
 *   - Automatic follows the OS, using the last-chosen variant of each family —
 *     so a member who picked Midnight keeps Midnight after dark (owner,
 *     2026-09-21), rather than being dropped to plain Dark;
 *   - a Studio theme or Custom turns Automatic off: Studio themes are dark only,
 *     and pairing one with Light by day reads as the theme vanishing at sunset.
 */
import type { Theme } from './useAppearance'

export type LightVariant = 'light' | 'light-dim'
export type DarkVariant = 'default' | 'midnight' | 'amoled'
export type Family = 'light' | 'dark'

export const LIGHT_VARIANTS: readonly LightVariant[] = ['light', 'light-dim']
export const DARK_VARIANTS: readonly DarkVariant[] = ['default', 'midnight', 'amoled']

export interface ThemeState {
  theme: Theme
  automatic: boolean
  lastLight: LightVariant
  lastDark: DarkVariant
}

const isLight = (t: unknown): t is LightVariant => (LIGHT_VARIANTS as readonly unknown[]).includes(t)
const isDark = (t: unknown): t is DarkVariant => (DARK_VARIANTS as readonly unknown[]).includes(t)

/** The core family a theme belongs to; null for Studio themes and Custom. */
export const familyOf = (t: Theme): Family | null => (isLight(t) ? 'light' : isDark(t) ? 'dark' : null)

/** What Automatic shows for the OS's current preference. */
export const automaticTheme = (s: ThemeState, osDark: boolean): Theme => (osDark ? s.lastDark : s.lastLight)

export const pickMode = (s: ThemeState, family: Family): ThemeState =>
  ({ ...s, automatic: false, theme: family === 'light' ? s.lastLight : s.lastDark })

export const pickVariant = (s: ThemeState, v: LightVariant | DarkVariant, osDark: boolean): ThemeState => {
  const next = isLight(v) ? { ...s, lastLight: v } : { ...s, lastDark: v as DarkVariant }
  // Under Automatic the OS decides which family is on screen; the choice is
  // still remembered for when that family comes round.
  return { ...next, theme: next.automatic ? automaticTheme(next, osDark) : v }
}

export const pickStudio = (s: ThemeState, id: Theme): ThemeState => ({ ...s, automatic: false, theme: id })

export const setAutomatic = (s: ThemeState, on: boolean, osDark: boolean): ThemeState =>
  on ? { ...s, automatic: true, theme: automaticTheme(s, osDark) } : { ...s, automatic: false }

export const onSystemChange = (s: ThemeState, osDark: boolean): ThemeState =>
  (s.automatic ? { ...s, theme: automaticTheme(s, osDark) } : s)

/**
 * The remembered variants for a saved appearance. A saved core theme seeds its
 * own family, so a member on Midnight before this existed keeps Midnight the
 * first time they turn Automatic on. Anything that is not a variant is ignored.
 */
export const seedVariants = (saved: { theme: Theme; lastLight?: unknown; lastDark?: unknown }):
  Pick<ThemeState, 'lastLight' | 'lastDark'> => ({
  lastLight: isLight(saved.lastLight) ? saved.lastLight : isLight(saved.theme) ? saved.theme : 'light',
  lastDark: isDark(saved.lastDark) ? saved.lastDark : isDark(saved.theme) ? saved.theme : 'default',
})
