import { describe, it, expect } from 'vitest'
import { shouldPrompt } from '../updatePrompt'
import type { UpdateState } from '../desktopBridge'

const ready = (version: string): UpdateState =>
  ({ phase: 'ready', version, percent: 100, bytesPerSecond: 0, lastCheckedAt: 1, error: '' })

describe('shouldPrompt', () => {
  it('prompts once a download is ready', () => {
    expect(shouldPrompt(ready('1.0.0'), '', false)).toBe(true)
  })

  it('never prompts twice for the same version', () => {
    expect(shouldPrompt(ready('1.0.0'), '1.0.0', false)).toBe(false)
  })

  it('prompts again for a newer one', () => {
    expect(shouldPrompt(ready('1.1.0'), '1.0.0', false)).toBe(true)
  })

  it('stays quiet during a call — a modal over a conversation teaches people to dismiss without reading', () => {
    expect(shouldPrompt(ready('1.0.0'), '', true)).toBe(false)
  })

  it('does not prompt for anything that is not ready', () => {
    for (const phase of ['idle', 'checking', 'available', 'downloading', 'error'] as const) {
      expect(shouldPrompt({ ...ready('1.0.0'), phase }, '', false)).toBe(false)
    }
  })
})
