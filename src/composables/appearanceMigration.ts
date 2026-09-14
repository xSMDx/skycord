/**
 * Saved appearance settings from before a change to the defaults.
 *
 * setAppearance persists the WHOLE appearance object, so a value that was the
 * default when someone saved is indistinguishable from a value they chose. That
 * is harmless until a default changes: blurple (#5865f2) was the default accent,
 * so everyone who ever changed any setting has it stored and would keep Discord's
 * colour for ever after Sky replaced it.
 *
 * The version marker is what makes this safe to run on every load. Blurple is
 * still a preset, so a user who picks it deliberately must keep it — which only
 * works if the migration happens once, and a blob saved after it says so.
 */
export const APPEARANCE_VERSION = 2
export const LEGACY_DEFAULT_ACCENT = '#5865f2'

export const migrateSavedAppearance = (
  saved: Record<string, unknown>,
  uiFonts: readonly string[],
  monoFonts: readonly string[],
): Record<string, unknown> => {
  const out = { ...saved }
  // A font that no longer exists — 'gg sans' was renamed to Archivo — must not
  // survive a reload, or it renders as the browser's default serif.
  if (typeof out.fontUi === 'string' && !uiFonts.includes(out.fontUi)) delete out.fontUi
  if (typeof out.fontMono === 'string' && !monoFonts.includes(out.fontMono)) delete out.fontMono

  const version = typeof out.v === 'number' ? out.v : 1
  if (version < 2 && typeof out.accent === 'string' && out.accent.toLowerCase() === LEGACY_DEFAULT_ACCENT) {
    out.accent = 'auto'
  }
  delete out.v
  return out
}
