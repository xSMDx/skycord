import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
  }
})

import { soundMessage, soundMute, soundRingStart, soundRingStop, soundRingOnce } from '../useSounds'
import { setNotificationPref } from '../notificationPrefs'

/** An AudioContext that counts the voices started on it. */
let voices = 0
const node = () => ({
  connect: () => {}, start: () => { voices++ }, stop: () => {},
  gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
  frequency: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
  Q: { value: 0 }, type: '',
})
const fakeCtx = {
  state: 'running', currentTime: 0, destination: {},
  createGain: node, createOscillator: node, createBiquadFilter: node,
  resume: async () => {},
}

beforeEach(() => {
  voices = 0
  ;(globalThis as any).window = globalThis
  ;(globalThis as any).__skCtx = fakeCtx
  setNotificationPref('allSoundsOff', false)
  setNotificationPref('ringSound', true)
})
afterEach(() => soundRingStop())

describe('Disable all notification sounds', () => {
  it('silences every cue, not only notifications', () => {
    soundMessage(); soundMute()
    expect(voices).toBeGreaterThan(0)
    voices = 0
    setNotificationPref('allSoundsOff', true)
    soundMessage(); soundMute(); soundRingOnce()
    expect(voices).toBe(0)
  })
})

describe('Incoming call sound', () => {
  it('off: the ring does not start', () => {
    setNotificationPref('ringSound', false)
    soundRingStart()
    expect(voices).toBe(0)
  })
  it('on: it rings', () => {
    soundRingStart()
    expect(voices).toBeGreaterThan(0)
  })
  it('Preview plays one ring whatever the switch says', () => {
    setNotificationPref('ringSound', false)
    soundRingOnce()
    expect(voices).toBeGreaterThan(0)
  })
})
