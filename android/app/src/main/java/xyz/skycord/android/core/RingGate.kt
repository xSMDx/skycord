package xyz.skycord.android.core

/**
 * What the ringer should do about a room: start ringing, stop because the
 * person joined, show a missed call, or nothing. [Stop] and [Missed] only ever
 * come out for a room that is ringing, so each ring ends exactly once.
 */
sealed interface RingAction {
    data class Ring(val room: String) : RingAction
    data class Stop(val room: String) : RingAction
    data class Missed(val room: String) : RingAction
    data object None : RingAction
}

/**
 * When the phone rings, from the `call:state` events its background service
 * hears. A call rings only if all of these hold:
 *  - the room is a `dm:` or `group:` one (a `voice:` channel is somewhere to
 *    drop in, never a call to you);
 *  - you belong to it ([onCallState]'s `isMember`) and are not in the call;
 *  - it started within [freshMs] (30 s) by the server's `startedAt`;
 *  - that room and `startedAt` have not rung before, or been declined.
 * A ring ends when you join ([RingAction.Stop]), or when it is unanswered:
 * [onTimeout], or the room emptying while it rings, both [RingAction.Missed].
 * Declining ends it quietly ([onDeclined]).
 *
 * An older server sends no `startedAt`. Then nothing says how old a call is, so
 * it rings only for an empty-to-occupied change this gate has watched happen
 * since connecting: a room that is already occupied the first time it is heard
 * of (the replay of a call that was going on) never rings.
 *
 * There is no extra guard against a server restart restamping `startedAt`: an
 * old call can then ring once more, a rare slip that was accepted.
 *
 * The times are passed in and must be on the server's clock, as `startedAt`
 * is; the caller who knows the phone's clock is off corrects for it. This
 * class has no timers: whoever rings the phone calls [onTimeout] when the ring
 * has run its 30 s.
 *
 * What it keeps is bounded. The rooms ringing leave when their ring ends. The
 * calls that have rung, and the rooms whose occupancy has been seen, are each
 * the last [maxRooms] only; forgetting one errs towards quiet for an older
 * server's room and towards one repeat ring for a call, and only after
 * [maxRooms] other rooms have had calls in between. Safe to call from any thread.
 */
class RingGate(val freshMs: Long = 30_000L, maxRooms: Int = 500) {
    private val ringing = HashSet<String>()

    // "room|startedAt" of every call that has rung or been answered elsewhere.
    private val handled = LruMap<String, Unit>(maxRooms)

    // room -> whether it was occupied at the latest call:state since connecting.
    // Absent means "not heard of yet", which is not the same as empty.
    private val occupied = LruMap<String, Boolean>(maxRooms)

    /**
     * The service has (re)connected. Every room is new to it again, so an
     * older server's replay of a call already going on cannot look like a call
     * starting. A ring in progress carries on (its timeout ends it), and calls
     * that rang stay rung: a reconnect never rings a call twice. [now] is part
     * of the contract so every reconnect is stamped on the caller's clock; no
     * rule here is a matter of time since connecting.
     */
    @Suppress("UNUSED_PARAMETER")
    @Synchronized
    fun onConnected(now: Long) {
        occupied.clear()
    }

    /**
     * A `call:state` for [room]: who is in it ([userIds]), when it started
     * ([startedAt], epoch ms on the server's clock, null from an older server or
     * for an empty room), whether you belong to it, and the time [now].
     */
    @Synchronized
    fun onCallState(
        room: String,
        userIds: List<String>,
        startedAt: Long?,
        me: String,
        isMember: Boolean,
        now: Long,
    ): RingAction {
        if (!room.startsWith("dm:") && !room.startsWith("group:")) return RingAction.None

        val before = occupied.put(room, userIds.isNotEmpty()) // null: the first word on this room since connecting
        val inCall = me in userIds

        if (room in ringing) {
            return when {
                userIds.isEmpty() -> { ringing.remove(room); RingAction.Missed(room) }
                inCall -> { ringing.remove(room); RingAction.Stop(room) }
                else -> RingAction.None // others come and go; it is still ringing
            }
        }
        if (userIds.isEmpty()) return RingAction.None

        if (startedAt != null) {
            val call = "$room|$startedAt"
            // You joined: that call is answered for good, so leaving it again while it is
            // still young does not make it ring.
            if (inCall) {
                handled[call] = Unit
                return RingAction.None
            }
            if (!isMember || now - startedAt > freshMs || handled[call] != null) return RingAction.None
            handled[call] = Unit
        } else if (inCall || !isMember || before != false) {
            return RingAction.None
        }
        ringing.add(room)
        return RingAction.Ring(room)
    }

    /**
     * The ring for [room] was declined, here or on another of your devices.
     * It ends without a missed call, and that call (same room and `startedAt`)
     * has already rung, so it cannot ring again.
     */
    @Synchronized
    fun onDeclined(room: String) {
        ringing.remove(room)
    }

    /** The ring for [room] has run its time: [RingAction.Missed] if it was still ringing. */
    @Synchronized
    fun onTimeout(room: String): RingAction =
        if (ringing.remove(room)) RingAction.Missed(room) else RingAction.None
}
