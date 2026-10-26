/**
 * What the call's music panel does, apart from how it looks.
 *
 * The desktop flyout and the phone sheet list the same channels and take the
 * same actions: a line saying who is listening, a form that starts a channel,
 * one that queues a link on it, and a tap that tunes in or out. Only the
 * layout differs, so the rest lives here, once. useMusic owns the state and
 * the socket; this is the small amount of form state and wording between that
 * and either panel.
 */
import { ref, computed } from 'vue'
import {
  music, createMusicChannel, queueMusic, listenToMusic, clearMusicError,
} from './useMusic'

/** Who is in the call: all `listenersText` needs of a participant. */
export interface CallPerson { id: string; name: string }

/**
 * Who is listening, by name.
 *
 * A count is the easy answer and the less useful one: this is a crew of
 * people who know each other, so "Ana, Ben" says something "2 listening"
 * does not. Every listener is by definition in the call, so the names are
 * already in the call's participant list and nothing extra is fetched.
 */
export const listenersText = (ids: string[], people: readonly CallPerson[]): string => {
  if (!ids.length) return 'Nobody yet'
  const names = ids.map(id => people.find(p => p.id === id)?.name ?? 'Someone')
  if (names.length <= 2) return names.join(' and ')
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

/**
 * The form state and handlers behind a music panel. Each call makes its own
 * state, so two panels never share a half-typed link.
 *
 * `people` is read when a line is drawn, not when this is made: the call's
 * list changes as people come and go, and a copy taken now would go stale.
 */
export const useCallMusic = (people: () => readonly CallPerson[]) => {
  const adding = ref(false)
  const name = ref('')
  const url = ref('')
  const queueFor = ref<string | null>(null)
  const queueUrl = ref('')

  const listeners = (ids: string[]): string => listenersText(ids, people())

  const canAdd = computed(() => name.value.trim() !== '' && url.value.trim() !== '')

  const openNew = () => { adding.value = true }

  const cancelNew = () => { adding.value = false; clearMusicError() }

  const submitNew = () => {
    if (!canAdd.value) return
    clearMusicError()
    createMusicChannel(name.value.trim(), { url: url.value.trim() })
    // Cleared on submit, not on success: the server answers a create with a
    // music:state rather than an ack, so a form waiting for one would sit
    // there looking stuck. A refusal appears below instead.
    name.value = ''; url.value = ''; adding.value = false
  }

  /** Open the add-a-link form for a channel, or shut it on a second tap. */
  const toggleQueue = (id: string) => { queueFor.value = queueFor.value === id ? null : id }

  const submitQueue = (id: string) => {
    const u = queueUrl.value.trim()
    if (!u) return
    clearMusicError()
    queueMusic(id, { url: u })
    queueUrl.value = ''; queueFor.value = null
  }

  /** Tune into a channel, or out of it when it is the one you are on. */
  const toggleListen = (id: string) => listenToMusic(music.listeningTo === id ? null : id)

  return {
    adding, name, url, queueFor, queueUrl,
    listeners, canAdd,
    openNew, cancelNew, submitNew, toggleQueue, submitQueue, toggleListen,
  }
}
