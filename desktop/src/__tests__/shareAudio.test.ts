import { describe, it, expect, vi } from 'vitest'
import { resolveRootPid, pidForSource, supportsPerAppAudio } from '../shareAudio'
import type { ProcRow } from '../processWalk'

const addon = (table: ProcRow[], windowPid: number | null = null) => ({
  supported: () => true,
  processTable: () => table,
  pidForWindow: vi.fn(() => windowPid),
  start: vi.fn(() => true),
  stop: vi.fn(),
})

const chrome: ProcRow[] = [
  { pid: 10, parentPid: 1, exe: 'explorer.exe', createdAt: 1 },
  { pid: 20, parentPid: 10, exe: 'chrome.exe', createdAt: 2 },
  { pid: 30, parentPid: 20, exe: 'chrome.exe', createdAt: 3 },
]

describe('resolveRootPid', () => {
  it('walks the window pid up to the application root', () => {
    expect(resolveRootPid(30, addon(chrome))).toBe(20)
  })

  it('gives null when the addon cannot work at all', () => {
    expect(resolveRootPid(30, { ...addon(chrome), supported: () => false })).toBeNull()
  })

  it('gives null when the pid is not in the table', () => {
    expect(resolveRootPid(999, addon(chrome))).toBeNull()
  })
})

describe('pidForSource', () => {
  it('reads the decimal HWND out of a window source id and resolves its app', () => {
    const a = addon(chrome, 30)
    expect(pidForSource('window:328988:0', a)).toBe(20)
    expect(a.pidForWindow).toHaveBeenCalledWith(328988)
  })

  it('gives null for a screen, which has no window handle', () => {
    expect(pidForSource('screen:0:0', addon(chrome, 30))).toBeNull()
  })

  it('gives null when the window has already gone', () => {
    expect(pidForSource('window:328988:0', addon(chrome, null))).toBeNull()
  })

  it('gives null for a malformed id rather than guessing', () => {
    for (const bad of ['window::0', 'window:abc:0', 'window:-5:0', 'nonsense']) {
      expect(pidForSource(bad, addon(chrome, 30))).toBeNull()
    }
  })

  it('never calls into native code when the machine cannot do it', () => {
    const a = { ...addon(chrome, 30), supported: () => false }
    expect(pidForSource('window:328988:0', a)).toBeNull()
    expect(a.pidForWindow).not.toHaveBeenCalled()
  })
})

describe('supportsPerAppAudio', () => {
  it('reports what the addon says', () => {
    expect(supportsPerAppAudio(addon([]))).toBe(true)
    expect(supportsPerAppAudio({ ...addon([]), supported: () => false })).toBe(false)
  })
})
