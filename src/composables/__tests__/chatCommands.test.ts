import { describe, it, expect, afterEach, vi } from 'vitest'
vi.mock('../useSocket', () => ({ getSocket: () => ({ emit: vi.fn() }) }))
import { matchCommands, resolveSlash } from '../useChatCommands'
import { musicAvailable } from '../useMusic'

afterEach(() => { musicAvailable.value = false })

describe('the slash list', () => {
  it('has no music commands where the server runs no music', () => {
    musicAvailable.value = false
    expect(matchCommands('').some(c => c.group === 'Music')).toBe(false)
    expect(resolveSlash('play')).toBeUndefined()
    // The old commands are untouched either way.
    expect(resolveSlash('shrug')?.run).toBeTypeOf('function')
  })

  it('lists them, grouped, where it does', () => {
    musicAvailable.value = true
    const names = matchCommands('').filter(c => c.group === 'Music').map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['play', 'skip', 'next', 'prev', 'stop', 'queue', 'np']))
    expect(matchCommands('pl').map(c => c.name)).toEqual(['play'])
  })

  it('runs an alias, but does not list it', () => {
    musicAvailable.value = true
    expect(resolveSlash('back')?.name).toBe('prev')
    expect(resolveSlash('P')?.name).toBe('play')
    expect(matchCommands('back')).toEqual([])
  })
})
