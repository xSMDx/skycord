import { describe, it, expect } from 'vitest'
import { updateLabel } from '../useUpdates'
import type { UpdateState } from '../desktopBridge'

const base: UpdateState = { phase: 'idle', version: '', percent: 0, bytesPerSecond: 0, lastCheckedAt: 0, error: '' }

describe('updateLabel', () => {
  it('says it is up to date, because silence is what failed before', () => {
    expect(updateLabel({ ...base, phase: 'idle', lastCheckedAt: 1 })).toBe('Skycord is up to date')
  })

  it('says a check is running', () => {
    expect(updateLabel({ ...base, phase: 'checking' })).toBe('Checking for updates…')
  })

  it('names the version it found', () => {
    expect(updateLabel({ ...base, phase: 'available', version: '0.21.0' })).toBe('Skycord 0.21.0 is available')
  })

  it('shows a whole-number percent while downloading', () => {
    expect(updateLabel({ ...base, phase: 'downloading', version: '0.21.0', percent: 41.6 }))
      .toBe('Downloading Skycord 0.21.0 — 42%')
  })

  it('says it is ready and waiting for you', () => {
    expect(updateLabel({ ...base, phase: 'ready', version: '0.21.0' }))
      .toBe('Skycord 0.21.0 is ready to install')
  })

  it('shows the error rather than pretending the check succeeded', () => {
    expect(updateLabel({ ...base, phase: 'error', error: 'net down' }))
      .toBe("Couldn't check for updates — net down")
  })

  it('has never checked: says that, not "up to date"', () => {
    expect(updateLabel({ ...base, phase: 'idle', lastCheckedAt: 0 })).toBe('Not checked yet')
  })
})
