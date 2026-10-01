import { describe, it, expect } from 'vitest'
import { initialUpdateState, reduceUpdate, type UpdateState } from '../updateState'

const at = 1_700_000_000_000

describe('reduceUpdate', () => {
  it('starts idle, with nothing claimed', () => {
    expect(initialUpdateState).toEqual({
      phase: 'idle', version: '', percent: 0, bytesPerSecond: 0, lastCheckedAt: 0, error: '',
    })
  })

  it('a check in flight is a phase, not a guess', () => {
    expect(reduceUpdate(initialUpdateState, { type: 'check' }).phase).toBe('checking')
  })

  it('an available update names its version and resets progress', () => {
    const s = reduceUpdate(initialUpdateState, { type: 'available', version: '1.2.3' })
    expect(s).toMatchObject({ phase: 'available', version: '1.2.3', percent: 0 })
  })

  it('progress moves percent without losing the version', () => {
    let s = reduceUpdate(initialUpdateState, { type: 'available', version: '1.2.3' })
    s = reduceUpdate(s, { type: 'progress', percent: 41.6, bytesPerSecond: 900 })
    expect(s).toMatchObject({ phase: 'downloading', version: '1.2.3', percent: 41.6, bytesPerSecond: 900 })
  })

  it('clamps a percent the updater exaggerates', () => {
    const s = reduceUpdate(initialUpdateState, { type: 'progress', percent: 140, bytesPerSecond: 0 })
    expect(s.percent).toBe(100)
    expect(reduceUpdate(initialUpdateState, { type: 'progress', percent: -5, bytesPerSecond: 0 }).percent).toBe(0)
  })

  it('a finished download is ready at 100, not downloading at 99', () => {
    const s = reduceUpdate(initialUpdateState, { type: 'downloaded', version: '1.2.3' })
    expect(s).toMatchObject({ phase: 'ready', version: '1.2.3', percent: 100 })
  })

  it('no update means idle, and records that a check happened', () => {
    const s = reduceUpdate({ ...initialUpdateState, phase: 'checking' }, { type: 'none', at })
    expect(s).toMatchObject({ phase: 'idle', lastCheckedAt: at, version: '' })
  })

  it('an error is kept with the time it happened', () => {
    const s = reduceUpdate(initialUpdateState, { type: 'error', message: 'net down', at })
    expect(s).toMatchObject({ phase: 'error', error: 'net down', lastCheckedAt: at })
  })

  it('the next success clears the last error — a stale error reads as a live one', () => {
    const bad = reduceUpdate(initialUpdateState, { type: 'error', message: 'net down', at })
    expect(reduceUpdate(bad, { type: 'none', at: at + 1 }).error).toBe('')
    expect(reduceUpdate(bad, { type: 'available', version: '2.0.0' }).error).toBe('')
  })

  it('a ready update survives a later failed check: it is still installable', () => {
    const ready: UpdateState = reduceUpdate(initialUpdateState, { type: 'downloaded', version: '1.2.3' })
    const after = reduceUpdate(ready, { type: 'error', message: 'net down', at })
    expect(after).toMatchObject({ phase: 'ready', version: '1.2.3', error: 'net down' })
  })
})
