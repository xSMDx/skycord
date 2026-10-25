import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, effectScope, type EffectScope } from 'vue'
import type { AudioRouteState } from '../desktopBridge'
import {
  phoneCall, openPhoneCall, minimizePhoneCall,
  useAutoHide, usePointersHeld, useCallKeepAwake,
  speaker, initSpeaker, setSpeaker, callAudioActive,
} from '../phoneCall'

// The bridge is whatever the test says it is; null is a browser.
const h = vi.hoisted(() => ({ bridge: null as unknown }))
vi.mock('@/composables/desktopBridge', () => ({ appBridge: () => h.bridge }))

const bridgeOf = (extra: Record<string, unknown> = {}) => ({ platform: 'android', changeInstance: async () => {}, ...extra })
const flush = () => new Promise<void>(r => setTimeout(r, 0))

let scope: EffectScope
beforeEach(() => {
  h.bridge = null
  phoneCall.open = false
  Object.assign(speaker, { supported: false, on: false, headset: false })
  scope = effectScope()
})
afterEach(() => {
  scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('phoneCall', () => {
  it('open/minimize toggle phoneCall.open', () => {
    expect(phoneCall.open).toBe(false)
    openPhoneCall()
    expect(phoneCall.open).toBe(true)
    minimizePhoneCall()
    expect(phoneCall.open).toBe(false)
  })
})

describe('useAutoHide', () => {
  beforeEach(() => { vi.useFakeTimers() })

  const mount = (on = true, delayMs?: number) => {
    const enabled = ref(on)
    const hide = scope.run(() => useAutoHide({ enabled: () => enabled.value, delayMs }))!
    return { enabled, ...hide }
  }

  it('auto-hide hides after 4000 ms with no poke and not before', () => {
    const { hidden } = mount()
    expect(hidden.value).toBe(false)
    vi.advanceTimersByTime(3999)
    expect(hidden.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(hidden.value).toBe(true)
  })

  it('poke restarts the 4000 ms', () => {
    const { hidden, poke } = mount()
    vi.advanceTimersByTime(3000)
    poke()
    vi.advanceTimersByTime(3999)
    expect(hidden.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(hidden.value).toBe(true)
    // The touch that reveals starts the count again.
    poke()
    expect(hidden.value).toBe(false)
    vi.advanceTimersByTime(3999)
    expect(hidden.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(hidden.value).toBe(true)
  })

  it('disabling shows the controls at once and never hides while disabled', () => {
    const { enabled, hidden, poke } = mount()
    vi.advanceTimersByTime(4000)
    expect(hidden.value).toBe(true)

    enabled.value = false
    expect(hidden.value).toBe(false)
    vi.advanceTimersByTime(60_000)
    expect(hidden.value).toBe(false)
    poke()
    vi.advanceTimersByTime(60_000)
    expect(hidden.value).toBe(false)

    // Enabled again, it counts a full delay from that moment, not from before.
    enabled.value = true
    vi.advanceTimersByTime(3999)
    expect(hidden.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(hidden.value).toBe(true)
  })

  it('does not hide if it was disabled when the delay ran out', () => {
    const { enabled, hidden } = mount()
    vi.advanceTimersByTime(3999)
    enabled.value = false
    vi.advanceTimersByTime(1)
    expect(hidden.value).toBe(false)
  })

  it('takes the delay it is given', () => {
    const { hidden } = mount(true, 1000)
    vi.advanceTimersByTime(999)
    expect(hidden.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(hidden.value).toBe(true)
  })

  it('stop() cancels a pending hide and shows the controls', () => {
    const { hidden, stop } = mount()
    vi.advanceTimersByTime(4000)
    expect(hidden.value).toBe(true)
    stop()
    expect(hidden.value).toBe(false)
    vi.advanceTimersByTime(60_000)
    expect(hidden.value).toBe(false)
  })

  it('stops with its scope', () => {
    const { enabled, hidden } = mount()
    scope.stop()
    enabled.value = false
    enabled.value = true
    vi.advanceTimersByTime(60_000)
    expect(hidden.value).toBe(false)
  })
})

describe('usePointersHeld', () => {
  it('is held from the press to the release, and the release says it was the last', () => {
    const p = usePointersHeld()
    expect(p.held.value).toBe(false)
    p.down(1, true)
    expect(p.held.value).toBe(true)
    expect(p.up(1)).toBe(true)
    expect(p.held.value).toBe(false)
  })

  it('stays held until the last of several fingers is lifted', () => {
    const p = usePointersHeld()
    p.down(1, true)
    p.down(2, false)
    expect(p.up(1)).toBe(false)
    expect(p.held.value).toBe(true)
    expect(p.up(2)).toBe(true)
    expect(p.held.value).toBe(false)
  })

  it('ignores the end of a press it never saw begin (lostpointercapture after pointerup)', () => {
    const p = usePointersHeld()
    p.down(1, true)
    expect(p.up(1)).toBe(true)
    expect(p.up(1)).toBe(false)
    expect(p.held.value).toBe(false)
  })

  it('lets a new first finger drop a press whose release it missed', () => {
    const p = usePointersHeld()
    p.down(1, true)   // lifted where the screen could not hear it
    p.down(2, true)   // primary: no other finger is down
    expect(p.up(2)).toBe(true)
    expect(p.held.value).toBe(false)
  })

  it('keeps auto-hide from fading the controls under a press, and counts from the release', () => {
    vi.useFakeTimers()
    const p = usePointersHeld()
    const { hidden, poke } = scope.run(() => useAutoHide({ enabled: () => !p.held.value }))!
    p.down(7, true)
    poke()
    vi.advanceTimersByTime(30_000)
    expect(hidden.value).toBe(false)

    if (p.up(7)) poke()
    vi.advanceTimersByTime(3999)
    expect(hidden.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(hidden.value).toBe(true)
  })
})

describe('useCallKeepAwake', () => {
  it('keep-awake uses the bridge when present and releases on inactive', () => {
    const keepScreenOn = vi.fn()
    const request = vi.fn()
    vi.stubGlobal('navigator', { wakeLock: { request } })
    h.bridge = bridgeOf({ keepScreenOn })
    const active = ref(false)
    scope.run(() => useCallKeepAwake(() => active.value))
    expect(keepScreenOn).not.toHaveBeenCalled()

    active.value = true
    expect(keepScreenOn).toHaveBeenCalledTimes(1)
    expect(keepScreenOn).toHaveBeenLastCalledWith(true)

    active.value = false
    expect(keepScreenOn).toHaveBeenCalledTimes(2)
    expect(keepScreenOn).toHaveBeenLastCalledWith(false)
    // The bridge is the one that works inside the app, so the browser's is left alone.
    expect(request).not.toHaveBeenCalled()
  })

  it('keep-awake releases when its scope stops mid-call', () => {
    const keepScreenOn = vi.fn()
    h.bridge = bridgeOf({ keepScreenOn })
    scope.run(() => useCallKeepAwake(() => true))
    expect(keepScreenOn).toHaveBeenLastCalledWith(true)
    scope.stop()
    expect(keepScreenOn).toHaveBeenLastCalledWith(false)
  })

  describe('in a browser', () => {
    const sentinels: { release: ReturnType<typeof vi.fn>; released: boolean }[] = []
    let request: ReturnType<typeof vi.fn>
    let visibility: 'visible' | 'hidden'
    let onVisibility: (() => void) | null
    let remove: ReturnType<typeof vi.fn<() => void>>

    beforeEach(() => {
      sentinels.length = 0
      visibility = 'visible'
      onVisibility = null
      remove = vi.fn<() => void>()
      request = vi.fn(async () => {
        const s = { release: vi.fn(async () => { s.released = true }), released: false }
        sentinels.push(s)
        return s
      })
      vi.stubGlobal('navigator', { wakeLock: { request } })
      vi.stubGlobal('document', {
        get visibilityState() { return visibility },
        addEventListener: (type: string, f: () => void) => { if (type === 'visibilitychange') onVisibility = f },
        removeEventListener: (type: string, f: () => void) => { if (type === 'visibilitychange' && f === onVisibility) { onVisibility = null; remove() } },
      })
    })

    it('keep-awake falls back to navigator.wakeLock and re-requests on visibility', async () => {
      const active = ref(false)
      scope.run(() => useCallKeepAwake(() => active.value))
      expect(request).not.toHaveBeenCalled()

      active.value = true
      await flush()
      expect(request).toHaveBeenCalledTimes(1)
      expect(request).toHaveBeenCalledWith('screen')

      // The browser drops the lock when the page is hidden; coming back must take it again.
      sentinels[0].released = true
      visibility = 'hidden'
      onVisibility!()
      await flush()
      expect(request).toHaveBeenCalledTimes(1)

      visibility = 'visible'
      onVisibility!()
      await flush()
      expect(request).toHaveBeenCalledTimes(2)

      active.value = false
      await flush()
      expect(sentinels[1].release).toHaveBeenCalledTimes(1)
      expect(remove).toHaveBeenCalledTimes(1)
    })

    it('does not ask again while the lock is still held', async () => {
      scope.run(() => useCallKeepAwake(() => true))
      await flush()
      onVisibility!()
      await flush()
      expect(request).toHaveBeenCalledTimes(1)
    })

    it('lets go of a lock granted after the call has already ended', async () => {
      const active = ref(true)
      scope.run(() => useCallKeepAwake(() => active.value))
      active.value = false
      await flush()
      expect(sentinels).toHaveLength(1)
      expect(sentinels[0].release).toHaveBeenCalledTimes(1)
    })

    it('carries on when the browser refuses the lock', async () => {
      request.mockRejectedValueOnce(new Error('NotAllowedError'))
      const active = ref(true)
      scope.run(() => useCallKeepAwake(() => active.value))
      await flush()
      // A refusal is not held against the next visit.
      onVisibility!()
      await flush()
      expect(request).toHaveBeenCalledTimes(2)
    })

    it('does nothing where there is no wake lock and no bridge', () => {
      vi.stubGlobal('navigator', {})
      const active = ref(true)
      expect(() => scope.run(() => useCallKeepAwake(() => active.value))).not.toThrow()
      active.value = false
      expect(onVisibility).toBeNull()
    })
  })
})

describe('speaker', () => {
  const audioBridge = (initial: AudioRouteState = { speaker: false, headset: false }) => {
    const calls: string[] = []
    let route: ((s: AudioRouteState) => void) | null = null
    const off = vi.fn(() => { route = null })
    const audio = {
      state: vi.fn(async () => initial),
      setCall: vi.fn((active: boolean) => { calls.push(`setCall:${active}`) }),
      setSpeaker: vi.fn((on: boolean) => { calls.push(`setSpeaker:${on}`) }),
    }
    const bridge = bridgeOf({ audio, onAudioRoute: (cb: (s: AudioRouteState) => void) => { route = cb; return off } })
    return { bridge, audio, calls, off, emit: (s: AudioRouteState) => route?.(s) }
  }

  it('speaker unsupported without bridge.audio', () => {
    // A browser, and an app build from before the member: no speaker circle either way.
    for (const b of [null, bridgeOf()]) {
      h.bridge = b
      const off = initSpeaker()
      expect(speaker.supported).toBe(false)
      expect(() => { setSpeaker(true); callAudioActive(true); callAudioActive(false); off() }).not.toThrow()
      expect(speaker.on).toBe(false)
    }
  })

  it('is supported when the bridge has audio, and reads its starting state', async () => {
    const a = audioBridge({ speaker: true, headset: false })
    h.bridge = a.bridge
    const off = initSpeaker()
    expect(speaker.supported).toBe(true)
    await flush()
    expect(speaker.on).toBe(true)
    expect(speaker.headset).toBe(false)
    off()
  })

  it('callAudioActive(true) sets the call then the speaker on', () => {
    const a = audioBridge()
    h.bridge = a.bridge
    callAudioActive(true)
    expect(a.calls).toEqual(['setCall:true', 'setSpeaker:true'])
    expect(speaker.on).toBe(true)
  })

  it('callAudioActive(false) hands the route back', () => {
    const a = audioBridge()
    h.bridge = a.bridge
    callAudioActive(false)
    expect(a.calls).toEqual(['setCall:false'])
  })

  it('setSpeaker tells the app and shows the choice', () => {
    const a = audioBridge()
    h.bridge = a.bridge
    setSpeaker(true)
    expect(a.audio.setSpeaker).toHaveBeenLastCalledWith(true)
    expect(speaker.on).toBe(true)
    setSpeaker(false)
    expect(a.audio.setSpeaker).toHaveBeenLastCalledWith(false)
    expect(speaker.on).toBe(false)
  })

  it('an audioRoute event updates speaker.on and speaker.headset', async () => {
    const a = audioBridge()
    h.bridge = a.bridge
    const off = initSpeaker()
    await flush()
    a.emit({ speaker: true, headset: true })
    expect(speaker.on).toBe(true)
    expect(speaker.headset).toBe(true)
    a.emit({ speaker: false, headset: false })
    expect(speaker.on).toBe(false)
    expect(speaker.headset).toBe(false)
    off()
  })

  it('a route event that lands before the first state() answer is not overwritten by it', async () => {
    const a = audioBridge({ speaker: false, headset: false })
    h.bridge = a.bridge
    const off = initSpeaker()
    a.emit({ speaker: true, headset: true })
    await flush()
    expect(speaker.on).toBe(true)
    expect(speaker.headset).toBe(true)
    off()
  })

  it('unsubscribing stops the updates and withdraws the speaker', async () => {
    const a = audioBridge()
    h.bridge = a.bridge
    const off = initSpeaker()
    await flush()
    off()
    expect(a.off).toHaveBeenCalledTimes(1)
    expect(speaker.supported).toBe(false)
    a.emit({ speaker: true, headset: true })
    expect(speaker.on).toBe(false)
  })

  it('initSpeaker twice never leaves two subscriptions', () => {
    const a = audioBridge()
    h.bridge = a.bridge
    const first = initSpeaker()
    const second = initSpeaker()
    expect(a.off).toHaveBeenCalledTimes(1)
    // The first caller's late unsubscribe must not tear down the live one.
    first()
    expect(a.off).toHaveBeenCalledTimes(1)
    expect(speaker.supported).toBe(true)
    second()
    expect(a.off).toHaveBeenCalledTimes(2)
  })
})
