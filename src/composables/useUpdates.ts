/**
 * The update, as the page sees it.
 *
 * The main process owns the state; this mirrors it and offers the two verbs.
 * `updateLabel` is separate and pure so the wording is tested — the wording is
 * the feature here. An app that failed to update for a week did so while
 * looking exactly like an app that had nothing to do.
 */
import { onUnmounted, ref } from 'vue'
import { desktopBridge, type UpdateState } from './desktopBridge'

const IDLE: UpdateState = { phase: 'idle', version: '', percent: 0, bytesPerSecond: 0, lastCheckedAt: 0, error: '' }

export const updateLabel = (s: UpdateState): string => {
  switch (s.phase) {
    case 'checking': return 'Checking for updates…'
    case 'available': return `Skycord ${s.version} is available`
    case 'downloading': return `Downloading Skycord ${s.version} — ${Math.round(s.percent)}%`
    case 'ready': return `Skycord ${s.version} is ready to install`
    case 'error': return `Couldn't check for updates — ${s.error}`
    case 'idle': return s.lastCheckedAt ? 'Skycord is up to date' : 'Not checked yet'
  }
}

export const useUpdates = () => {
  const bridge = desktopBridge()
  const supported = !!bridge?.updates
  const state = ref<UpdateState>(IDLE)

  if (bridge?.updates) {
    bridge.updates.state().then(s => { if (s) state.value = s }).catch(() => {})
    const off = bridge.updates.onChange(s => { state.value = s })
    onUnmounted(off)
  }

  return {
    state,
    supported,
    check: () => bridge?.updates?.check(),
    install: () => bridge?.updates?.install(),
  }
}
