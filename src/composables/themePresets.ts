/**
 * The theme presets, as data.
 *
 * Lifted out of SettingsModal because Discover shows the same gallery, and two
 * copies of a palette list drift the moment one gains a theme the other has
 * not. The `Theme` ids here must match the [data-theme] blocks in tokens.css.
 */
import type { Theme } from './useAppearance'

export type ThemeOpt = { id: Theme; label: string; preview: Record<string, string>; accent?: string }

export const THEME_OPTS: ThemeOpt[] = [
  { id: 'default',   label: 'Dark',      preview: { background: '#313338' } },
  { id: 'midnight',  label: 'Midnight',  preview: { background: '#1a1b1f' } },
  { id: 'amoled',    label: 'AMOLED',    preview: { background: '#000000' } },
  { id: 'light',     label: 'Light',     preview: { background: '#ffffff' } },
  { id: 'light-dim', label: 'Light Dim', preview: { background: '#eceef0' } },
  { id: 'custom',    label: 'Custom',    preview: { background: 'conic-gradient(from 180deg, #ff5f6d, #ffc371, #5865f2, #ff5f6d)' } },
]

/**
 * Studio themes — palettes people already recognise.
 *
 * The accent travels with the theme because the accent is most of what makes
 * one of these read as itself: Spotify's surfaces without Spotify's green are
 * just another near-black. It is applied as a normal accent change, so it stays
 * editable afterwards and picking a swatch does not drop you out of the theme.
 *
 * The preview swatch shows the chat surface with the accent as a bar beneath —
 * both halves of what choosing this actually changes.
 */
export const bar = (bg: string, accent: string) => ({ background: bg, boxShadow: `inset 0 -7px 0 ${accent}` })

export const STUDIO_OPTS: ThemeOpt[] = [
  { id: 'spotify', label: 'Spotify', accent: '#1db954', preview: bar('#121212', '#1db954') },
  { id: 'apple',   label: 'Graphite', accent: '#0a84ff', preview: bar('#212123', '#0a84ff') },
  { id: 'linear',  label: 'Linear',  accent: '#5e6ad2', preview: bar('#1a1a20', '#5e6ad2') },
  { id: 'vercel',  label: 'Vercel',  accent: '#0070f3', preview: bar('#000000', '#0070f3') },
  { id: 'stripe',  label: 'Stripe',  accent: '#635bff', preview: bar('#0a2540', '#635bff') },
  { id: 'github',  label: 'GitHub',  accent: '#2f81f7', preview: bar('#0d1117', '#2f81f7') },
  { id: 'notion',  label: 'Notion',  accent: '#2383e2', preview: bar('#191919', '#2383e2') },
  { id: 'stoat',   label: 'Stoat',   accent: '#fd6671', preview: bar('#1a1a1c', '#fd6671') },
]
/** Every built-in preset, in the order a gallery should show them. */
export const ALL_PRESETS: ThemeOpt[] = [...THEME_OPTS, ...STUDIO_OPTS]
