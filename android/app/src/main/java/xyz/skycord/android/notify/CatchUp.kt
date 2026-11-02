package xyz.skycord.android.notify

import android.content.Context
import xyz.skycord.android.core.Missed
import xyz.skycord.android.core.MessageEvents

/**
 * What arrived while the connection was down: GET /users/me/missed?since=T
 * (server/controllers/missedController.ts). The answer carries the server's own
 * clock as `now`, which becomes the next `since`, so T is never the phone's
 * clock. An older server without the route answers 404, and then there is no
 * catch-up, only live notifications — nothing to report, nothing to retry.
 */
internal class CatchUp(private val api: ServerApi) {
    sealed interface Outcome {
        data class Caught(val missed: Missed) : Outcome
        /** The server has no catch-up (404): an older version. */
        data object NotSupported : Outcome
        data object SignedOut : Outcome
        /** No usable answer this time; the gap is still open. */
        data object Failed : Outcome
    }

    /** Blocking. */
    fun fetch(since: Long): Outcome = when (val r = api.get("/users/me/missed?since=$since")) {
        is ApiResult.Ok -> MessageEvents.missed(r.body)?.let { Outcome.Caught(it) } ?: Outcome.Failed
        is ApiResult.Status -> if (r.code == 404) Outcome.NotSupported else Outcome.Failed
        ApiResult.Unreachable -> Outcome.Failed
        ApiResult.SignedOut -> Outcome.SignedOut
    }
}

/**
 * Where the next catch-up starts: a time on the server's clock, for one server
 * and one person, kept across restarts of the process so that a killed app
 * catches up when it comes back. Kept for one pair only: another server or
 * another person starts fresh, as the first run does.
 */
internal class CatchUpCursor(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(NotifyService.PREFS, Context.MODE_PRIVATE)

    /** The `since` for [origin] and [userId], or null when there is none (start fresh). */
    fun get(origin: String, userId: String): Long? = synchronized(LOCK) {
        if (prefs.getString(KEY_ORIGIN, null) != origin || prefs.getString(KEY_USER, null) != userId) return null
        if (!prefs.contains(KEY_SINCE)) null else prefs.getLong(KEY_SINCE, 0L)
    }

    fun set(origin: String, userId: String, since: Long) = synchronized(LOCK) {
        prefs.edit().putString(KEY_ORIGIN, origin).putString(KEY_USER, userId).putLong(KEY_SINCE, since).apply()
    }

    /**
     * Moves the `since` for [origin] and [userId] forward to [since], never back, and only
     * if there is one: a cursor cleared meanwhile (sign-out, background notifications
     * turned off) stays cleared.
     */
    fun advance(origin: String, userId: String, since: Long) = synchronized(LOCK) {
        val current = get(origin, userId) ?: return@synchronized
        if (since > current) set(origin, userId, since)
    }

    /** The next start is a fresh one, with no catch-up. */
    fun clear() = synchronized(LOCK) {
        prefs.edit().remove(KEY_ORIGIN).remove(KEY_USER).remove(KEY_SINCE).apply()
    }

    private companion object {
        val LOCK = Any()
        const val KEY_ORIGIN = "catchup_origin"
        const val KEY_USER = "catchup_user"
        const val KEY_SINCE = "catchup_since"
    }
}
