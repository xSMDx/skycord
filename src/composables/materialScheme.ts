/**
 * Material-You palette generation for the Appearance "Scheme" + "Contrast"
 * controls. A single seed (the accent) drives a full tonal palette via
 * @material/material-color-utilities; we map Material roles → our surface/text
 * tokens. Accent itself stays the user's exact pick (handled in useAppearance).
 */
import {
  argbFromHex, hexFromArgb, Hct, MaterialDynamicColors,
  SchemeTonalSpot, SchemeMonochrome, SchemeNeutral, SchemeFruitSalad,
} from '@material/material-color-utilities'

export type SchemeName = 'off' | 'tonalSpot' | 'monochrome' | 'neutral' | 'fruitSalad'

const CTORS: Record<Exclude<SchemeName, 'off'>, any> = {
  tonalSpot:  SchemeTonalSpot,
  monochrome: SchemeMonochrome,
  neutral:    SchemeNeutral,
  fruitSalad: SchemeFruitSalad,
}

// Surface/text/border tokens the generated scheme controls (accent excluded).
export const SCHEME_TOKEN_KEYS = [
  '--bg-floor', '--bg-deep', '--bg-panel', '--bg-chat', '--bg-input', '--bg-raised',
  '--bg-chatbar', '--bg-chatbar-focus',
  '--text-strong', '--text-1', '--text-2', '--text-3', '--text-faint',
  '--border', '--divider', '--text-on-accent',
]

export const buildSchemeTokens = (
  accentHex: string, scheme: Exclude<SchemeName, 'off'>, isDark: boolean, contrast: number,
): Record<string, string> => {
  const Ctor = CTORS[scheme] || SchemeTonalSpot
  const s = new Ctor(Hct.fromInt(argbFromHex(accentHex)), isDark, contrast)
  const M = MaterialDynamicColors
  const hex = (role: any) => hexFromArgb(role.getArgb(s))
  return {
    '--bg-floor':     hex(M.surfaceContainerLowest),
    '--bg-deep':      hex(M.surfaceContainerLow),
    '--bg-panel':     hex(M.surfaceContainer),
    '--bg-chat':      hex(M.surface),
    '--bg-input':     hex(M.surfaceContainerHigh),
    '--bg-raised':    hex(M.surfaceContainerLow),
    '--bg-chatbar':       hex(M.surfaceContainerHigh),
    '--bg-chatbar-focus': hex(M.surfaceContainerHighest),
    '--text-strong':  hex(M.onSurface),
    '--text-1':       hex(M.onSurface),
    '--text-2':       hex(M.onSurfaceVariant),
    '--text-3':       hex(M.onSurfaceVariant),
    '--text-faint':   hex(M.outline),
    '--border':       hex(M.outlineVariant),
    '--divider':      hex(M.outlineVariant),
    '--text-on-accent': hex(M.onPrimary),
  }
}
