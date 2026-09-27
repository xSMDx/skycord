/**
 * The three switches Chromium only reads at startup, and what the shell does
 * with them. Read from the store before the app is ready, and never trusted as
 * written: the file is editable by anything running as the user.
 */
export interface ShellPerf {
  skycordTitleBar: boolean
  hardwareAcceleration: boolean
  heapCapMb: number | null
}

const DEFAULTS: ShellPerf = { skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null }

/** A heap ceiling under 64 MB cannot hold a Chromium page, and over 4096 is not a cap. */
const heapOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 64 && v <= 4096 ? Math.round(v) : null

export const readShellPerf = (stored: unknown): ShellPerf => {
  if (!stored || typeof stored !== 'object') return { ...DEFAULTS }
  const s = stored as Record<string, unknown>
  return {
    skycordTitleBar: typeof s.skycordTitleBar === 'boolean' ? s.skycordTitleBar : DEFAULTS.skycordTitleBar,
    hardwareAcceleration: typeof s.hardwareAcceleration === 'boolean' ? s.hardwareAcceleration : DEFAULTS.hardwareAcceleration,
    heapCapMb: heapOf(s.heapCapMb),
  }
}

export const flagsFor = (p: ShellPerf) => ({
  disableHardwareAcceleration: !p.hardwareAcceleration,
  jsFlags: p.heapCapMb === null ? null : `--max-old-space-size=${p.heapCapMb}`,
})

/** How long hidden before the page drops its decoded images; null = never. */
export const readTrimMinutes = (stored: unknown): number | null => {
  const v = (stored as Record<string, unknown> | null)?.imageTrimMinutes
  return typeof v === 'number' && v > 0 && v <= 60 ? v : null
}
