import { describe, it, expect, beforeEach } from 'vitest'

class FakeStorage {
  private s: Record<string, string> = {}
  getItem(k: string) { return k in this.s ? this.s[k] : null }
  setItem(k: string, v: string) { this.s[k] = v }
  removeItem(k: string) { delete this.s[k] }
  clear() { this.s = {} }
}
;(globalThis as any).localStorage = new FakeStorage()

const { useSearchHistory } = await import('../useSearchHistory')

const server = { kind: 'server' as const, id: 's1' }
const other  = { kind: 'server' as const, id: 's2' }
const text = (t: string) => ({ chips: [], text: t })

describe('search history', () => {
  const h = useSearchHistory()
  beforeEach(() => (globalThis as any).localStorage.clear())

  it('keeps the last five searches in a scope, newest first, without repeats', () => {
    for (const t of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) h.remember(server, text(t))
    expect(h.entries(server).map(e => e.label)).toEqual(['b', 'f', 'e', 'd', 'c'])
  })
  it('keeps scopes apart', () => {
    h.remember(server, text('here'))
    expect(h.entries(other)).toEqual([])
  })
  it('clears one scope', () => {
    h.remember(server, text('x')); h.remember(other, text('y'))
    h.clear(server)
    expect(h.entries(server)).toEqual([])
    expect(h.entries(other).map(e => e.label)).toEqual(['y'])
  })
  it('ignores an empty search', () => {
    h.remember(server, text('  '))
    expect(h.entries(server)).toEqual([])
  })
})
