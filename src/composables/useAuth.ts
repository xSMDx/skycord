import { ref, computed } from 'vue'
 
export interface PublicUser {
  id:            string
  username:      string
  email:         string
  displayName:   string
  discriminator: string
  avatar:        string | null
  bio:           string
  role:          'owner' | 'admin' | 'mod' | 'vip' | 'member'
  status:        string
  isVerified:    boolean
  createdAt:     string
}
 
// ── Singleton state ────────────────────────────────────────────────────
const user        = ref<PublicUser | null>(null)
const accessToken = ref<string | null>(null)
const loading     = ref(false)
const initialized = ref(false)

// ── Server reachability ────────────────────────────────────────────────
// The dev proxy answers with a bodyless 500 when the API process is down —
// indistinguishable from a real error unless we probe. `serverDown` drives a
// persistent banner on the auth page and self-clears by re-probing /health.
const serverDown = ref(false)
let probeTimer: ReturnType<typeof setTimeout> | null = null
const OFFLINE_MSG = 'Skycord server is offline — start the API server (start-dev.cmd), it will reconnect automatically.'

const probeServer = async (): Promise<void> => {
  try {
    const r = await fetch('/health', { cache: 'no-store' })
    serverDown.value = !r.ok
  } catch { serverDown.value = true }
  if (probeTimer) { clearTimeout(probeTimer); probeTimer = null }
  if (serverDown.value) probeTimer = setTimeout(() => { void probeServer() }, 5000)
}

// A response whose body isn't JSON is the proxy talking, not the API.
const readJson = async (res: Response): Promise<any | null> => {
  try { return await res.json() } catch { return null }
}

const flagServerDown = (path: string, detail: unknown) => {
  console.error(`[auth] ${path} unreachable — API server down behind the dev proxy?`, detail)
  serverDown.value = true
  void probeServer()
}
 
const authFetch = async (path: string, opts: RequestInit = {}): Promise<Response> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> ?? {}),
  }
  if (accessToken.value) headers['Authorization'] = `Bearer ${accessToken.value}`
  return fetch(path, { ...opts, headers, credentials: 'include' })
}
 
let _timer: ReturnType<typeof setTimeout> | null = null
 
const scheduleRefresh = () => {
  if (_timer) clearTimeout(_timer)
  _timer = setTimeout(() => silentRefresh(), 14 * 60 * 1000)
}
 
const silentRefresh = async (): Promise<boolean> => {
  try {
    const res = await authFetch('/auth/refresh', { method: 'POST' })
    if (!res.ok) { user.value = null; accessToken.value = null; return false }
    const data = await res.json()
    accessToken.value = data.accessToken
    scheduleRefresh()
    return true
  } catch { return false }
}
 
export const useAuth = () => {
  const isAuthed = computed(() => !!user.value && !!accessToken.value)
 
  const register = async (payload: {
    username: string; email: string; password: string; displayName?: string
  }) => {
    loading.value = true
    try {
      const res  = await authFetch('/auth/register', { method: 'POST', body: JSON.stringify(payload) })
      const data = await readJson(res)
      if (!res.ok) {
        if (!data) { flagServerDown('/auth/register', `HTTP ${res.status}, non-JSON body`); return { ok: false as const, message: OFFLINE_MSG } }
        return { ok: false as const, errors: data.errors, message: data.message }
      }
      serverDown.value = false
      accessToken.value = data.accessToken
      user.value = data.user
      scheduleRefresh()
      return { ok: true as const }
    } catch (e) { flagServerDown('/auth/register', e); return { ok: false as const, message: OFFLINE_MSG } }
    finally   { loading.value = false }
  }
 
  const login = async (payload: { identifier: string; password: string }) => {
    loading.value = true
    try {
      const res  = await authFetch('/auth/login', { method: 'POST', body: JSON.stringify(payload) })
      const data = await readJson(res)
      if (!res.ok) {
        if (!data) { flagServerDown('/auth/login', `HTTP ${res.status}, non-JSON body`); return { ok: false as const, message: OFFLINE_MSG } }
        return { ok: false as const, errors: data.errors, message: data.message }
      }
      serverDown.value = false
      accessToken.value = data.accessToken
      user.value = data.user
      scheduleRefresh()
      return { ok: true as const }
    } catch (e) { flagServerDown('/auth/login', e); return { ok: false as const, message: OFFLINE_MSG } }
    finally   { loading.value = false }
  }
 
  const logout = async () => {
    try { await authFetch('/auth/logout', { method: 'POST' }) } finally {
      user.value = null
      accessToken.value = null
      if (_timer) clearTimeout(_timer)
    }
  }
 
  const updateUser = (updates: Partial<PublicUser>) => {
    if (user.value) user.value = { ...user.value, ...updates }
  }
 
  const initialize = async () => {
    if (initialized.value) return
    const ok = await silentRefresh()
    if (ok) {
      try {
        const res = await authFetch('/auth/me')
        if (res.ok) { const d = await res.json(); user.value = d.user }
      } catch { /* ignore */ }
    }
    initialized.value = true
  }
 
  return {
    user, accessToken, loading, initialized, isAuthed,
    register, login, logout, initialize, updateUser,
    authFetch, serverDown, probeServer
  }
}