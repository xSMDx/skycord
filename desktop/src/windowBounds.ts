import { screen, type BrowserWindow } from 'electron'

/** A child window's bounds: centred over its parent, kept inside the screen that parent is on. */
export const centredOver = (parent: BrowserWindow, size: { width: number; height: number }) => {
  const p = parent.getBounds()
  const area = screen.getDisplayMatching(p).workArea
  const width = Math.min(size.width, area.width)
  const height = Math.min(size.height, area.height)
  const clamp = (v: number, lo: number, span: number) => Math.round(Math.min(Math.max(v, lo), lo + span))
  return {
    width, height,
    x: clamp(p.x + (p.width - width) / 2, area.x, area.width - width),
    y: clamp(p.y + (p.height - height) / 2, area.y, area.height - height),
  }
}
