/**
 * What the call's music panel does, apart from how it looks.
 *
 * The desktop flyout and the phone sheet list the same channels and take the
 * same actions: a line saying who is listening, a form that starts a channel,
 * one that queues a link on it, and a tap that tunes in or out. Only the
 * layout differs, so the rest lives here, once. useMusic owns the state and
 * the socket; this is the small amount of form state and wording between that
 * and either panel.
 *
 * Two things here are for the phone sheet and are ignored by the flyout:
 * where a refusal belongs, and closing a channel in two taps.
 */
import { ref, computed, watch, getCurrentScope, onScopeDispose } from 'vue'
import {
  music, createMusicChannel, queueMusic, skipMusic, closeMusicChannel,
  listenToMusic, clearMusicError, togglePauseMusic, canPause,
} from './useMusic'

/** Who is in the call: all `listenersText` needs of a participant. */
export interface CallPerson { id: string; name: string }

/** How long a first tap on Close stays armed. */
export const CLOSE_ARM_MS = 3000

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

  // ── Where a refusal belongs ───────────────────────────────────────────────
  // The server answers a refused action with one `music:error` and nothing that
  // says which action it was. A panel that shows it in one place, far from the
  // control that was tapped, leaves it off-screen on a long list, so this keeps
  // the one thing that can be known: where the last action that was sent came
  // from. 'new' is a create; anything else is the channel's id.
  const origin = ref<string | null>(null)

  /**
   * Where the refusal on screen belongs, or null when there is none or it
   * cannot be placed (it arrived before any action here was sent).
   *
   * Taken as the refusal arrives rather than read off `origin` later: a tap
   * that does not clear the refusal (tuning in) moves `origin` on, and the
   * refusal must stay with the card it answered.
   */
  const refusedAt = ref<string | null>(null)
  watch(() => music.error, e => { refusedAt.value = e ? origin.value : null }, { flush: 'sync' })

  // ── Close, in two taps ────────────────────────────────────────────────────
  // Closing a channel ends it for everyone listening and drops its queue, so
  // the phone sheet will not do it on one tap, which a thumb can land by
  // mistake. The first tap arms; a second on the same channel within
  // CLOSE_ARM_MS closes. The arm also drops on any other action.
  const closing = ref<string | null>(null)
  let closingTimer: ReturnType<typeof setTimeout> | null = null

  const disarm = () => {
    if (closingTimer !== null) { clearTimeout(closingTimer); closingTimer = null }
    closing.value = null
  }
  // A sheet that goes away with the arm still ticking must not fire into nothing.
  if (getCurrentScope()) onScopeDispose(disarm)

  // ── Actions ───────────────────────────────────────────────────────────────
  const openNew = () => { disarm(); adding.value = true }

  const cancelNew = () => { disarm(); adding.value = false; clearMusicError() }

  const submitNew = () => {
    if (!canAdd.value) return
    disarm()
    clearMusicError()
    origin.value = 'new'
    createMusicChannel(name.value.trim(), { url: url.value.trim() })
    // Cleared on submit, not on success: the server answers a create with a
    // music:state rather than an ack, so a form waiting for one would sit
    // there looking stuck. A refusal appears below instead.
    name.value = ''; url.value = ''; adding.value = false
  }

  /**
   * Open the add-a-link form for a channel, or shut it on a second tap.
   *
   * A form opens empty. `queueUrl` is one box shared by whichever channel's form
   * is open, so a link typed for channel A would otherwise still be there when
   * Add is tapped on channel B, and be sent to B. (Opening from shut counts too:
   * the phone sheet shuts the form by clearing `queueFor` directly, leaving its
   * text behind.) Shutting a form leaves what was typed where it is, unseen.
   */
  const toggleQueue = (id: string) => {
    disarm()
    if (queueFor.value === id) { queueFor.value = null; return }
    queueUrl.value = ''
    queueFor.value = id
  }

  const submitQueue = (id: string) => {
    const u = queueUrl.value.trim()
    if (!u) return
    disarm()
    clearMusicError()
    origin.value = id
    queueMusic(id, { url: u })
    queueUrl.value = ''; queueFor.value = null
  }

  /**
   * Tune into a channel, or out of it when it is the one you are on.
   *
   * Leaves an earlier refusal where it is, as the flyout always has: the
   * refusal keeps its own card (see refusedAt), so nothing is misplaced.
   */
  const toggleListen = (id: string) => {
    disarm()
    origin.value = id
    listenToMusic(music.listeningTo === id ? null : id)
  }

  /** Skip the track in a channel, dismissing the last refusal so a new one is plain to see. */
  const skipTrack = (id: string) => {
    disarm()
    clearMusicError()
    origin.value = id
    skipMusic(id)
  }

  /**
   * Pause the song in a channel for everyone, or resume it — whichever it is
   * now, read from the channel as the tap lands rather than from a copy the
   * panel drew. Like skip, it dismisses the last refusal first, so a new one
   * (the service could not pause) is plain to see and lands on this card.
   * Nothing is sent for a channel that cannot pause: an older server, or no
   * song.
   */
  const togglePause = (id: string) => {
    disarm()
    const c = music.channels.find(x => x.id === id)
    if (!c || !canPause(c)) return
    clearMusicError()
    origin.value = id
    togglePauseMusic(c)
  }

  /**
   * Close a channel for everyone, on the second tap. The first arms it (see
   * `closing`) and sends nothing; tapping another channel arms that one
   * instead.
   */
  const closeChannel = (id: string) => {
    if (closing.value !== id) {
      disarm()
      closing.value = id
      closingTimer = setTimeout(disarm, CLOSE_ARM_MS)
      return
    }
    disarm()
    clearMusicError()
    origin.value = id
    closeMusicChannel(id)
  }

  return {
    adding, name, url, queueFor, queueUrl,
    listeners, canAdd,
    origin, refusedAt, closing,
    openNew, cancelNew, submitNew, toggleQueue, submitQueue, toggleListen,
    skipTrack, togglePause, closeChannel, disarm,
  }
}
