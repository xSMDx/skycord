import { describe, expect, it, vi } from 'vitest'
import { HOSTED, httpWarning, displayName, iconUrl, originOfInstanceUrl, fetchThroughApp, ensureAbortSignalTimeout } from '../view'

const profile = { software: 'skycord' as const, name: 'Crew', nameIsAddress: false, icon: '/icon.png', operator: 'Sam', version: '0.20.9' }

describe('the launcher', () => {
  it('offers the hosted instance', () => {
    expect(HOSTED).toBe('https://app.skycord.xyz')
  })

  it('warns that voice needs https, and only for http', () => {
    expect(httpWarning('http://10.0.0.5:3001')).toMatch(/calls won.t work/i)
    expect(httpWarning('https://chat.example.com')).toBeNull()
    // localhost is a secure page to Android, so calls work there.
    expect(httpWarning('http://localhost:5500')).toBeNull()
    expect(httpWarning('http://127.0.0.1:5500')).toBeNull()
  })

  it("names a server by its own name, or its address when it has none", () => {
    expect(displayName(profile, 'https://chat.example.com')).toBe('Crew')
    expect(displayName({ ...profile, nameIsAddress: true }, 'https://chat.example.com')).toBe('chat.example.com')
  })

  it('resolves the icon against the server, and refuses anything but http(s)', () => {
    expect(iconUrl(profile, 'https://chat.example.com')).toBe('https://chat.example.com/icon.png')
    expect(iconUrl({ ...profile, icon: null }, 'https://chat.example.com')).toBeNull()
    expect(iconUrl({ ...profile, icon: 'javascript:alert(1)' }, 'https://chat.example.com')).toBeNull()
  })

  it('takes back the origin from the URL lookupInstance asks for', () => {
    expect(originOfInstanceUrl('https://chat.example.com/instance')).toBe('https://chat.example.com')
    expect(originOfInstanceUrl('http://10.0.0.5:3001/instance')).toBe('http://10.0.0.5:3001')
    expect(originOfInstanceUrl('https://chat.example.com/elsewhere')).toBeNull()
  })
})

describe('lookups through the app', () => {
  const url = 'https://chat.example.com/instance'

  it("turns the app's answer into a Response", async () => {
    const r = await fetchThroughApp(async () => ({ status: 200, body: '{"software":"skycord"}' }))(url)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ software: 'skycord' })
  })

  it('gives a status that cannot carry a body no body, instead of throwing', async () => {
    const r = await fetchThroughApp(async () => ({ status: 204, body: 'x' }))(url)
    expect(r.status).toBe(204)
  })

  it('fails when the app could not reach the server', async () => {
    await expect(fetchThroughApp(async () => ({ unreachable: true as const }))(url)).rejects.toThrow('unreachable')
  })

  it('asks the app for nothing but an instance profile', async () => {
    const lookup = vi.fn()
    await expect(fetchThroughApp(lookup)('https://chat.example.com/elsewhere')).rejects.toThrow()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('gives up when the timeout fires, even if the app never answers', async () => {
    const c = new AbortController()
    const pending = fetchThroughApp(() => new Promise(() => {}))(url, { signal: c.signal })
    c.abort()
    await expect(pending).rejects.toThrow('timed out')
  })
})

describe('AbortSignal.timeout on WebView before 103', () => {
  it('is filled in when missing', () => {
    vi.useFakeTimers()
    try {
      const S: { timeout?: (ms: number) => AbortSignal } = {}
      ensureAbortSignalTimeout(S)
      const signal = S.timeout!(5000)
      expect(signal.aborted).toBe(false)
      vi.advanceTimersByTime(5000)
      expect(signal.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves a real one alone', () => {
    const own = () => new AbortController().signal
    const S = { timeout: own }
    ensureAbortSignalTimeout(S)
    expect(S.timeout).toBe(own)
  })
})
