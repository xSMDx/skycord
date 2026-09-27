import { describe, it, expect } from 'vitest'
import { rootOfApp, type ProcRow } from '../processWalk'

const row = (pid: number, parentPid: number, exe: string, createdAt = 100): ProcRow =>
  ({ pid, parentPid, exe, createdAt })

describe('rootOfApp', () => {
  it('walks up while the executable name stays the same', () => {
    // A Chrome tab: renderer → browser → explorer (a different exe, so stop).
    const table = [row(10, 1, 'explorer.exe', 1), row(20, 10, 'chrome.exe', 2), row(30, 20, 'chrome.exe', 3)]
    expect(rootOfApp(30, table)).toBe(20)
  })

  it('stops at a differently named parent: a game under Steam is its own app', () => {
    const table = [row(10, 1, 'steam.exe', 1), row(20, 10, 'game.exe', 2)]
    expect(rootOfApp(20, table)).toBe(20)
  })

  it('compares names without case: Windows does not', () => {
    const table = [row(20, 10, 'Spotify.exe', 2), row(30, 20, 'spotify.exe', 3)]
    expect(rootOfApp(30, table)).toBe(20)
  })

  it('refuses a parent created after its child: the pid was reused', () => {
    const table = [row(20, 10, 'chrome.exe', 500), row(30, 20, 'chrome.exe', 100)]
    expect(rootOfApp(30, table)).toBe(30)
  })

  it('stops after 8 hops rather than looping on a corrupt snapshot', () => {
    // A cycle: every row points at the next, and the last points back.
    const table = Array.from({ length: 12 }, (_, i) =>
      row(i + 1, i === 11 ? 1 : i + 2, 'app.exe', 1))
    expect(rootOfApp(1, table)).toBe(9)
  })

  it('stops when the parent is missing from the table', () => {
    expect(rootOfApp(30, [row(30, 20, 'chrome.exe')])).toBe(30)
  })

  it('returns null for a pid that is not in the table at all', () => {
    expect(rootOfApp(99, [row(30, 20, 'chrome.exe')])).toBeNull()
  })

  it('never walks into pid 0 or a self-parenting row', () => {
    expect(rootOfApp(4, [row(4, 4, 'System.exe'), row(0, 0, 'Idle.exe')])).toBe(4)
  })
})
