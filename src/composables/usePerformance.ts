/**
 * What the app is allowed to spend, in one place.
 *
 * A level is a named set of switches; an override changes one of them without
 * leaving the level. Everything that costs memory reads the resolved object by
 * name, so a switch is added here and consumed by meaning, never by asking
 * "which level is this?".
 *
 * Three switches only take effect when the shell restarts, because Chromium
 * reads them at startup: see RESTART_KEYS.
 */
import { reactive, computed, watch } from 'vue'
import { appearance } from './useAppearance'

export type PerfLevel = 'full' | 'balanced' | 'light'

export interface PerfSwitches {
  /** Conversations kept in memory at once; the open one is never evicted. */
  keepConversations: number
  /** Messages kept per conversation; older ones are dropped and refetched. */
  messagesPerConversation: number
  animatedMedia: 'play' | 'tap'
  /** Trim the renderer's image cache after this long hidden; null = never. */
  imageTrimMinutes: number | null
  maxCallTiles: number
  incomingVideo: 'auto' | '720p' | '360p'
  pauseVideoWhenHidden: boolean
  motion: 'full' | 'reduced' | 'off'
  /** Desktop only. false = the plain Windows frame, which is one process less. */
  skycordTitleBar: boolean
  /** Desktop only, restart. */
  hardwareAcceleration: boolean
  /** Desktop only, restart. null = the engine's own ceiling. */
  heapCapMb: number | null
}

export const PERF_LEVELS: Record<PerfLevel, PerfSwitches> = {
  full: {
    keepConversations: Infinity, messagesPerConversation: Infinity,
    animatedMedia: 'play', imageTrimMinutes: null,
    maxCallTiles: Infinity, incomingVideo: 'auto', pauseVideoWhenHidden: false,
    motion: 'full', skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null,
  },
  balanced: {
    keepConversations: 3, messagesPerConversation: 200,
    animatedMedia: 'tap', imageTrimMinutes: 5,
    maxCallTiles: 4, incomingVideo: '720p', pauseVideoWhenHidden: true,
    motion: 'reduced', skycordTitleBar: true, hardwareAcceleration: true, heapCapMb: null,
  },
  light: {
    keepConversations: 1, messagesPerConversation: 100,
    animatedMedia: 'tap', imageTrimMinutes: 1,
    maxCallTiles: 2, incomingVideo: '360p', pauseVideoWhenHidden: true,
    motion: 'off', skycordTitleBar: false, hardwareAcceleration: false, heapCapMb: 192,
  },
}

export const RESTART_KEYS = ['skycordTitleBar', 'hardwareAcceleration', 'heapCapMb'] as const
type RestartKey = typeof RESTART_KEYS[number]

export const resolve = (level: PerfLevel, overrides: Partial<PerfSwitches>): PerfSwitches =>
  ({ ...PERF_LEVELS[level], ...overrides })

/** Under six gigabytes the app offers Light once. It never switches by itself. */
export const suggestsLight = (totalMemoryGb: number | undefined): boolean =>
  typeof totalMemoryGb === 'number' && totalMemoryGb < 6

const KEY = 'sykord_perf'

interface PerfState { level: PerfLevel; overrides: Partial<PerfSwitches>; dismissedSuggestion: boolean }
const DEFAULT_STATE: PerfState = { level: 'full', overrides: {}, dismissedSuggestion: false }

const load = (): PerfState => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    const level: PerfLevel = raw.level === 'balanced' || raw.level === 'light' ? raw.level : 'full'
    const overrides = raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {}
    return { level, overrides, dismissedSuggestion: raw.dismissedSuggestion === true }
  } catch { return { ...DEFAULT_STATE } }
}

export const perfState = reactive<PerfState>(load())
export const perf = reactive<PerfSwitches>(resolve(perfState.level, perfState.overrides))

const save = () => localStorage.setItem(KEY, JSON.stringify({
  level: perfState.level, overrides: perfState.overrides, dismissedSuggestion: perfState.dismissedSuggestion,
}))

const apply = () => { Object.assign(perf, resolve(perfState.level, perfState.overrides)); save() }

export const setPerfLevel = (level: PerfLevel) => { perfState.level = level; perfState.overrides = {}; apply() }
export const setPerfOverride = <K extends keyof PerfSwitches>(key: K, value: PerfSwitches[K]) => {
  perfState.overrides = { ...perfState.overrides, [key]: value }; apply()
}
export const clearPerfOverrides = () => { perfState.overrides = {}; apply() }
export const dismissSuggestion = () => { perfState.dismissedSuggestion = true; save() }

/** What the shell started with, so the page can say a restart is needed. */
export const restartNeeded = (applied: Pick<PerfSwitches, RestartKey> | null): boolean =>
  applied !== null && RESTART_KEYS.some(k => applied[k] !== perf[k])

/**
 * Motion has one owner.
 *
 * `useAppearance` used to write `data-motion` itself; it now leaves it to this,
 * because two writers of one attribute means whoever ran last wins. The
 * person's own "reduce motion" always beats the level: asking for less motion
 * is never overridden by a performance level asking for more.
 */
export const effectiveMotion = computed<'full' | 'reduced' | 'off'>(() =>
  appearance.reduceMotion ? 'off' : perf.motion)

watch(effectiveMotion, (m) => {
  const root = document.documentElement
  if (m === 'full') delete root.dataset.motion
  else root.dataset.motion = m
}, { immediate: true })
