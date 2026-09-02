/**
 * Themes the user has saved, under names they chose.
 *
 * Deliberately local. A saved theme is the same themeable subset a share code
 * carries (THEME_FIELDS), so nothing here needs a server — and until there is
 * one, "saved" honestly means "saved on this device". Sharing one with someone
 * else already works: that is what the share code is for.
 *
 * Stored as a list rather than a map because order is the user's — newest
 * first is what a gallery wants, and a map would lose it.
 */
import { ref } from 'vue'
import { appearance, setAppearance, sanitizeTheme, THEME_FIELDS, type Appearance } from './useAppearance'

export interface SavedTheme {
  id: string
  name: string
  /** Epoch ms. Absolute, so a list sorts without knowing when it was written. */
  at: number
  theme: Partial<Appearance>
}

const KEY = 'skycord:savedThemes'
export const MAX_NAME = 40
/** A cap, not a quota. localStorage is ~5MB and a theme is well under 1KB;
 *  this exists so a stuck loop cannot fill the origin's storage. */
const MAX_THEMES = 60

export const savedThemes = ref<SavedTheme[]>([])

const read = (): SavedTheme[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(raw)) return []
    // Every field is re-validated on the way in: this is user-editable storage,
    // and a hand-edited entry must not be able to write junk into appearance.
    return raw
      .filter(t => t && typeof t.id === 'string' && typeof t.name === 'string')
      .map(t => ({
        id: t.id,
        name: String(t.name).slice(0, MAX_NAME),
        at: Number.isFinite(t.at) ? t.at : 0,
        theme: sanitizeTheme(t.theme),
      }))
  } catch { return [] }          // fail to "no saved themes", never to a throw
}

const write = () => {
  try { localStorage.setItem(KEY, JSON.stringify(savedThemes.value)) } catch { /* full or blocked */ }
}

export const loadSavedThemes = () => { savedThemes.value = read() }

/** Snapshot the current look under `name`. Returns the entry, or null if the
 *  name was blank — an unnamed theme is unfindable in a list of them. */
export const saveCurrentTheme = (name: string): SavedTheme | null => {
  const clean = name.trim().slice(0, MAX_NAME)
  if (!clean) return null
  const theme: Partial<Appearance> = {}
  for (const k of THEME_FIELDS) (theme as any)[k] = (appearance as any)[k]
  const entry: SavedTheme = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: clean,
    at: Date.now(),
    // Structured-clone so later edits to `appearance.custom` cannot reach back
    // into a theme that was already saved.
    theme: JSON.parse(JSON.stringify(theme)),
  }
  savedThemes.value = [entry, ...savedThemes.value].slice(0, MAX_THEMES)
  write()
  return entry
}

export const applySavedTheme = (t: SavedTheme) => setAppearance(sanitizeTheme(t.theme))

export const renameSavedTheme = (id: string, name: string) => {
  const clean = name.trim().slice(0, MAX_NAME)
  if (!clean) return
  const hit = savedThemes.value.find(t => t.id === id)
  if (!hit) return
  hit.name = clean
  write()
}

export const deleteSavedTheme = (id: string) => {
  savedThemes.value = savedThemes.value.filter(t => t.id !== id)
  write()
}

loadSavedThemes()
