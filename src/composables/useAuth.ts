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
      const data = await res.json()
      if (!res.ok) return { ok: false as const, errors: data.errors, message: data.message }
      accessToken.value = data.accessToken
      user.value = data.user
      scheduleRefresh()
      return { ok: true as const }
    } catch { return { ok: false as const, message: 'Could not reach server' } }
    finally   { loading.value = false }
  }
 
  const login = async (payload: { identifier: string; password: string }) => {
    loading.value = true
    try {
      const res  = await authFetch('/auth/login', { method: 'POST', body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) return { ok: false as const, errors: data.errors, message: data.message }
      accessToken.value = data.accessToken
      user.value = data.user
      scheduleRefresh()
      return { ok: true as const }
    } catch { return { ok: false as const, message: 'Could not reach server' } }
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
    authFetch
  }
}