/**
 * Appearance settings — theme, accent, density, message sizing, fonts, and a
 * custom-color mode. Applied by flipping CSS custom properties / data-attributes
 * on <html>, persisted to localStorage, restored in main.ts before first paint.
 */
import { reactive } from 'vue'
import { buildSchemeTokens, SCHEME_TOKEN_KEYS, type SchemeName } from './materialScheme'

export type Theme   = 'default' | 'midnight' | 'amoled' | 'light' | 'light-dim' | 'custom'
export type Density = 'cozy' | 'compact' | 'roomy'

export interface Appearance {
  theme:          Theme
  accent:         string
  density:        Density
  msgSize:        number          // px
  groupSpacing:   number          // px
  fontUi:         string          // key into UI_FONTS
  fontMono:       string          // key into MONO_FONTS
  showSendButton: boolean
  custom:         Record<string, string>  // token → value (used when theme === 'custom')
  scheme:         SchemeName       // Material-You palette variant ('off' = use theme presets)
  contrast:       number           // -1 (reduced) .. 1 (high)
  emojiPack:      EmojiPack        // emoji rendering style in messages
  underlineLinks: boolean          // always underline message links
  displayNameStyles: boolean       // render custom name colors/effects (off = plain)
  msgLayout:      MsgLayout        // Chat Message Display — 'compact' = single-line
  zoom:           number           // interface zoom, 50–200 (%)
}

export type EmojiPack = 'native' | 'twemoji' | 'noto'
export type MsgLayout = 'cozy' | 'compact'

const KEY = 'sykord_appearance'
const DEFAULTS: Appearance = {
  theme: 'default', accent: '#5865f2', density: 'cozy',
  msgSize: 15, groupSpacing: 17, fontUi: 'gg sans', fontMono: 'Consolas',
  showSendButton: true, custom: {}, scheme: 'off', contrast: 0, emojiPack: 'native',
  underlineLinks: false, displayNameStyles: true, msgLayout: 'cozy', zoom: 100,
}

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: 'Blurple', hex: '#5865f2' }, { name: 'Green', hex: '#23a55a' },
  { name: 'Teal', hex: '#1abc9c' },    { name: 'Blue', hex: '#3498db' },
  { name: 'Pink', hex: '#eb459e' },    { name: 'Red', hex: '#ed4245' },
  { name: 'Orange', hex: '#e67e22' },  { name: 'Yellow', hex: '#f0b232' },
  { name: 'Purple', hex: '#9b59b6' },
]

export const UI_FONTS: Record<string, string> = {
  'gg sans': "'gg sans','Noto Sans',-apple-system,BlinkMacSystemFont,system-ui,sans-serif",
  'Inter':   "'Inter',-apple-system,system-ui,sans-serif",
  'Roboto':  "'Roboto',-apple-system,system-ui,sans-serif",
  'System':  "system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
}
export const MONO_FONTS: Record<string, string> = {
  'Consolas':       "'Consolas','Menlo',monospace",
  'Fira Code':      "'Fira Code','Consolas',monospace",
  'JetBrains Mono': "'JetBrains Mono','Consolas',monospace",
}

// Surfaces/text the custom editor doesn't expose directly but derives from the
// 4 anchors (so a custom theme covers the whole chrome). Cleared each apply.
const DERIVED_KEYS = [
  '--bg-raised', '--bg-deep', '--bg-input', '--bg-chatbar', '--bg-chatbar-focus',
  '--text-2', '--text-3', '--text-faint',
]

// Tokens the custom editor can override.
export const CUSTOM_TOKENS: { key: string; label: string; fallback: string }[] = [
  { key: '--bg-chat',  label: 'Chat background',   fallback: '#313338' },
  { key: '--bg-panel', label: 'Panels / sidebar',  fallback: '#2b2d31' },
  { key: '--bg-floor', label: 'App chrome',         fallback: '#111214' },
  { key: '--text-1',   label: 'Body text',          fallback: '#dcddde' },
]

const parseHex = (hex: string) => {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16) }
}
const shade = (hex: string, p: number) => {
  const { r, g, b } = parseHex(hex)
  const f = (c: number) => Math.round(Math.min(255, Math.max(0, c * (1 + p))))
  return '#' + [f(r), f(g), f(b)].map(x => x.toString(16).padStart(2, '0')).join('')
}
const rgbTriple = (hex: string) => { const { r, g, b } = parseHex(hex); return `${r}, ${g}, ${b}` }

const load = (): Partial<Appearance> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

export const appearance = reactive<Appearance>({ ...DEFAULTS, ...load() })

export const applyAppearance = () => {
  const root = document.documentElement
  const a = appearance

  // Theme attribute (custom + default ride on the :root dark defaults)
  if (a.theme === 'default' || a.theme === 'custom') delete root.dataset.theme
  else root.dataset.theme = a.theme

  // Density
  if (a.density === 'cozy') delete root.dataset.density
  else root.dataset.density = a.density

  // Clear any inline surface/text overrides (custom + scheme), then re-apply
  // whichever mode is active. Inline vars win over the [data-theme] stylesheet.
  CUSTOM_TOKENS.forEach(t => root.style.removeProperty(t.key))
  SCHEME_TOKEN_KEYS.forEach(k => root.style.removeProperty(k))
  DERIVED_KEYS.forEach(k => root.style.removeProperty(k))

  if (a.scheme !== 'off') {
    // Material-You: generate the full surface/text palette from the accent seed.
    const isDark = !(a.theme === 'light' || a.theme === 'light-dim')
    const tokens = buildSchemeTokens(a.accent, a.scheme, isDark, a.contrast)
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v)
  } else if (a.theme === 'custom') {
    for (const [k, v] of Object.entries(a.custom)) if (v) root.style.setProperty(k, v)
    // The editor only exposes 4 anchors; propagate them to the rest of the
    // chrome (sidebars, user panel, composer, secondary text) so the WHOLE app
    // follows a custom theme, not just the chat + main panel.
    const c = a.custom
    const set = (k: string, v: string) => root.style.setProperty(k, v)
    if (c['--bg-panel']) set('--bg-raised', c['--bg-panel'])       // sidebar + settings shell
    if (c['--bg-floor']) set('--bg-deep', c['--bg-floor'])         // user panel
    if (c['--bg-chat']) {
      set('--bg-input',         shade(c['--bg-chat'], -0.45))      // inputs / code
      set('--bg-chatbar',       shade(c['--bg-chat'],  0.12))      // composer box
      set('--bg-chatbar-focus', shade(c['--bg-chat'],  0.20))
    }
    if (c['--text-1']) {
      set('--text-2', c['--text-1'])
      set('--text-3',     shade(c['--text-1'], -0.18))
      set('--text-faint', shade(c['--text-1'], -0.34))
    }
  }

  // Accent (always)
  root.style.setProperty('--accent', a.accent)
  root.style.setProperty('--accent-hover', shade(a.accent, -0.12))
  // Text sitting ON an accent tint in a LIGHT theme. -12% is not enough: on
  // light-dim's mid-tone panel the tinted row composites to #d4d8f0, where
  // accent-hover measures 4.02:1 against 14px body text. -28% clears 4.5 on
  // both light themes with room to spare.
  root.style.setProperty('--accent-deep', shade(a.accent, -0.28))
  root.style.setProperty('--accent-rgb', rgbTriple(a.accent))

  // Sizing + fonts
  root.style.setProperty('--msg-font-size', `${a.msgSize}px`)
  root.style.setProperty('--msg-group-gap', `${a.groupSpacing}px`)
  root.style.setProperty('--font-ui', UI_FONTS[a.fontUi] || UI_FONTS['gg sans'])
  root.style.setProperty('--font-mono', MONO_FONTS[a.fontMono] || MONO_FONTS['Consolas'])

  // Readability + density extras
  if (a.zoom === 100) {
    root.style.removeProperty('zoom')
    root.style.removeProperty('--zoom-factor')
  } else {
    const zf = a.zoom / 100
    root.style.setProperty('zoom', String(zf))
    // Exposed so full-viewport containers (.app) can counter-scale and not clip.
    root.style.setProperty('--zoom-factor', String(zf))
  }
  if (a.msgLayout === 'compact') root.dataset.msgLayout = 'compact'
  else delete root.dataset.msgLayout
  root.classList.toggle('underline-links', a.underlineLinks)
  root.classList.toggle('names-plain', !a.displayNameStyles)
}

// persist=false applies live without writing localStorage — used by theme preview.
export const setAppearance = (patch: Partial<Appearance>, persist = true) => {
  Object.assign(appearance, patch)
  if (persist) localStorage.setItem(KEY, JSON.stringify(appearance))
  applyAppearance()
}
export const setCustomToken = (key: string, value: string) => {
  setAppearance({ theme: 'custom', custom: { ...appearance.custom, [key]: value } })
}

// ── Theme sharing — serialize the themeable subset to a portable code ───────
const THEME_FIELDS: (keyof Appearance)[] = [
  'theme', 'accent', 'density', 'msgSize', 'groupSpacing', 'fontUi', 'fontMono',
  'showSendButton', 'custom', 'scheme', 'contrast', 'emojiPack',
  'underlineLinks', 'displayNameStyles', 'msgLayout', 'zoom',
]
const PREFIX = 'sykord-theme:'

// Keep only known theme fields from an arbitrary object (shared by code + link).
export const sanitizeTheme = (obj: any): Partial<Appearance> => {
  const out: Partial<Appearance> = {}
  if (!obj || typeof obj !== 'object') return out
  for (const k of THEME_FIELDS) if (k in obj) (out as any)[k] = obj[k]
  return out
}

const b64urlEncode = (s: string) =>
  btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlDecode = (s: string) =>
  decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

export const serializeTheme = (): string => {
  const data: any = { v: 1 }
  for (const k of THEME_FIELDS) data[k] = (appearance as any)[k]
  return PREFIX + b64urlEncode(JSON.stringify(data))
}

// Returns the themeable subset, or null if the code is malformed/unsupported.
export const parseTheme = (code: string): Partial<Appearance> | null => {
  try {
    const body = code.trim().replace(PREFIX, '')
    const obj = JSON.parse(b64urlDecode(body))
    if (obj.v !== 1) return null
    return sanitizeTheme(obj)
  } catch { return null }
}

// ── Live preview / revert — apply a theme without persisting, then keep/undo ─
let _stash: Appearance | null = null
export const themePreview = reactive<{ active: boolean }>({ active: false })

export const previewTheme = (partial: Partial<Appearance>) => {
  if (!themePreview.active) _stash = JSON.parse(JSON.stringify(appearance))
  setAppearance(partial, false)   // apply live, do NOT touch localStorage
  themePreview.active = true
}
export const keepPreview = () => {
  setAppearance({}, true)         // persist whatever is currently applied
  themePreview.active = false; _stash = null
}
export const revertPreview = () => {
  // localStorage was never overwritten during preview, so restoring the reactive
  // state (no persist) is enough to return to the prior look.
  if (_stash) setAppearance(_stash, false)
  themePreview.active = false; _stash = null
}

export const useAppearance = () => ({
  appearance, setAppearance, setCustomToken,
  serializeTheme, parseTheme, sanitizeTheme,
  themePreview, previewTheme, keepPreview, revertPreview,
})
