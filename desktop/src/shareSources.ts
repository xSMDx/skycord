/**
 * What the share picker lists, decided without Electron: which capture
 * sources become tiles, and what each tile says.
 */

export interface RawSource { id: string; name: string; displayId: string }
export interface DisplayInfo { id: string; width: number; height: number; primary: boolean }
export interface TileInfo { id: string; kind: 'screen' | 'window'; name: string; detail: string | null }

/**
 * `own` holds the app's own windows: sharing Skycord into a Skycord call only
 * shows the call back to itself. A lone screen is "Entire screen"; several
 * keep Windows' "Screen 1", "Screen 2", with a size to tell them apart.
 */
export const toTiles = (sources: readonly RawSource[], own: ReadonlySet<string>, displays: readonly DisplayInfo[]): TileInfo[] => {
  const screens = sources.filter(s => s.id.startsWith('screen:')).length
  const tiles: TileInfo[] = []
  for (const s of sources) {
    if (own.has(s.id)) continue
    if (s.id.startsWith('screen:')) {
      const d = displays.find(x => x.id === s.displayId)
      tiles.push({
        id: s.id,
        kind: 'screen',
        name: screens === 1 ? 'Entire screen' : s.name,
        detail: d ? `${d.width} × ${d.height}${d.primary ? ' · Primary' : ''}` : null,
      })
    } else if (s.id.startsWith('window:')) {
      const name = s.name.trim()
      if (name) tiles.push({ id: s.id, kind: 'window', name, detail: null })
    }
  }
  return tiles
}
