/**
 * The instance profile, requested once per page load and shared by every
 * surface that shows it: sign-up, the line under the sign-in card, Settings ›
 * About this instance and Settings › Legal. Public: no sign-in needed.
 *
 * Through authFetch, the helper the auth page already uses for
 * /auth/reset-available: same origin, so the credentials it carries are
 * harmless, and one helper means one place requests are made from.
 */
import { computed, ref } from 'vue'
import { useAuth } from './useAuth'
import type { InstanceProfile } from './legalDocs'

type LoadState = 'idle' | 'loading' | 'ready' | 'failed'

const profile = ref<InstanceProfile | null>(null)
const state = ref<LoadState>('idle')
let inflight: Promise<void> | null = null

const load = (): Promise<void> => {
  if (inflight) return inflight
  const { authFetch } = useAuth()
  state.value = 'loading'
  inflight = (async () => {
    try {
      const res = await authFetch('/instance')
      if (!res.ok) throw new Error(`the instance profile answered ${res.status}`)
      profile.value = await res.json() as InstanceProfile
      state.value = 'ready'
    } catch {
      state.value = 'failed'
      inflight = null // so Retry starts a fresh request
    }
  })()
  return inflight
}

export const useInstance = () => {
  if (state.value === 'idle') void load()
  return {
    profile: computed(() => profile.value),
    state: computed(() => state.value),
    retry: (): void => { if (state.value === 'failed') void load() },
  }
}

/** A published document's Markdown. Throws on anything but a 200. */
export const fetchLegalDocument = async (href: string): Promise<string> => {
  const { authFetch } = useAuth()
  const res = await authFetch(href)
  if (!res.ok) throw new Error(`the document answered ${res.status}`)
  return res.text()
}
