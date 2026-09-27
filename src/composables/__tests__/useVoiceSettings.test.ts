import { describe, it, expect, beforeAll } from 'vitest'
import type { NoiseMode, NoiseNodeKind, VoiceSettings } from '../useVoiceSettings'

// useVoiceSettings reads localStorage at import time (the module-level
// `reactive<VoiceSettings>({ ...DEFAULTS, ...load() })`), which the repo's
// node test environment doesn't provide — same reason usePerformance.test.ts
// stubs it before a dynamic import.
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
} as unknown as Storage

let noiseNodeFor: (mode: NoiseMode) => NoiseNodeKind
let micChainNeeded: () => boolean
let micCaptureOptions: () => { noiseSuppression: boolean }
let setVoiceSettings: (patch: Partial<VoiceSettings>) => void

beforeAll(async () => {
  const m = await import('../useVoiceSettings')
  ;({ noiseNodeFor, micChainNeeded, micCaptureOptions, setVoiceSettings } = m)
})

describe('noiseNodeFor', () => {
  it('resolves each mode to the graph node it needs', () => {
    expect(noiseNodeFor('off')).toBe('off')
    // 'standard' leaves the graph alone — the browser does the filtering on
    // the raw capture, outside anything this app builds.
    expect(noiseNodeFor('standard')).toBe('off')
    expect(noiseNodeFor('rnnoise')).toBe('rnnoise')
    expect(noiseNodeFor('deepfilter')).toBe('deepfilter')
  })
})

describe('micChainNeeded', () => {
  it('is needed for deepfilter, same as rnnoise', () => {
    setVoiceSettings({ noiseMode: 'deepfilter', sensitivity: 0, inputVolume: 100 })
    expect(micChainNeeded()).toBe(true)

    setVoiceSettings({ noiseMode: 'rnnoise' })
    expect(micChainNeeded()).toBe(true)
  })

  it('is not needed once every reason for the chain is gone', () => {
    setVoiceSettings({ noiseMode: 'off', sensitivity: 0, inputVolume: 100 })
    expect(micChainNeeded()).toBe(false)
  })
})

describe('micCaptureOptions — browser suppression never doubles up with a model', () => {
  it('is on only in standard mode', () => {
    setVoiceSettings({ noiseMode: 'standard' })
    expect(micCaptureOptions().noiseSuppression).toBe(true)
  })

  it('is off for rnnoise, deepfilter and off — a running model must never stack with it', () => {
    setVoiceSettings({ noiseMode: 'rnnoise' })
    expect(micCaptureOptions().noiseSuppression).toBe(false)

    setVoiceSettings({ noiseMode: 'deepfilter' })
    expect(micCaptureOptions().noiseSuppression).toBe(false)

    setVoiceSettings({ noiseMode: 'off' })
    expect(micCaptureOptions().noiseSuppression).toBe(false)
  })
})
