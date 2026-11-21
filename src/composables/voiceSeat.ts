/**
 * Keep this page's seat in the voice list while it is in a call.
 *
 * The page is the one party that knows for certain it is in its call: it holds
 * the media connection. The server's list is only as good as the messages that
 * reached it, and on a shaky network some do not — a rejoin lost with the
 * connection it went out on, a seat dropped behind the page's back. The other
 * members then saw the person missing from the voice channel while they were
 * still talking in it, and nothing ever corrected it.
 *
 * So the page compares the server's list for its own call with what it knows:
 * whenever that list changes, and every SEAT_CHECK_MS in case it never does.
 * When the list leaves it out, it sends the same rejoin a reconnect sends
 * (reannounceCall), which seats nobody new and announces nothing — at most
 * once per SEAT_RETRY_MS, so a server that keeps refusing (the person was taken
 * out of the channel) is asked again only now and then, not flooded.
 *
 * The same tick looks after the connection itself. Socket.IO gives up after
 * about a minute of failed tries and waits for "Try again"; somebody in a call
 * is still in it — LiveKit is a separate connection — but with no connection to
 * the server they can be neither listed nor told who comes and goes. While a
 * call is live, a connection that gave up is asked to try again.
 *
 * Installed by ChatApp for as long as the signed-in app is up, rather than
 * from useVoice itself: it reads the call list from useSocket, and keeping that
 * read out of useVoice keeps every test that stubs the socket module for
 * useVoice working unchanged.
 */
import { watch } from 'vue'
import { activeCalls, connected, connState, retryConnection } from './useSocket'
import { voice, voiceRoomName, reannounceCall } from './useVoice'
import { useAuth } from './useAuth'

/** The least time between two asks, so the answer to one can arrive first. */
export const SEAT_RETRY_MS = 5_000
/** How often the page checks on its own, for a list that never changes. */
export const SEAT_CHECK_MS = 15_000

/** The room of the call this page is live in, as the server names it, and who we are. */
const liveSeat = (): { room: string; me: string } | null => {
  const me = useAuth().user.value?.id
  if (!me || !voice.connected || !voice.activeConvId || !voice.activeKind) return null
  return { room: voiceRoomName(voice.activeKind, voice.activeConvId, me), me }
}

export const installVoiceSeatWatch = (): (() => void) => {
  let lastAsk = -Infinity
  /** The room of the live call last seen, to tell a new call from a changed list. */
  let seatRoom: string | null = null

  const check = () => {
    const seat = liveSeat()
    // Down: the reconnect re-announces on its own when it lands.
    if (!seat || !connected.value) return
    if (activeCalls.value[seat.room]?.includes(seat.me)) return
    const now = Date.now()
    if (now - lastAsk < SEAT_RETRY_MS) return
    if (reannounceCall()) lastAsk = now
  }

  const tick = () => {
    if (liveSeat() && !connected.value && connState.value === 'offline') retryConnection()
    check()
  }

  // The server's list for our own call, whenever a call:state or a snapshot
  // replaces it — and when we join, leave or switch calls. A call that has just
  // gone live has its own call:join on the way, so the list leaving us out is
  // expected for a moment: that join counts as the first ask.
  const stopWatch = watch(() => {
    const seat = liveSeat()
    return seat ? activeCalls.value[seat.room] ?? null : undefined
  }, () => {
    const room = liveSeat()?.room ?? null
    if (room !== seatRoom) {
      seatRoom = room
      if (room) { lastAsk = Date.now(); return }
    }
    check()
  })
  const timer = setInterval(tick, SEAT_CHECK_MS)

  return () => {
    stopWatch()
    clearInterval(timer)
  }
}
