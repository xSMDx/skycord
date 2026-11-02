package xyz.skycord.android.core

/** Whether a notification should make a sound and light the screen, or just update itself. */
enum class Alert { LOUD, SILENT }

/**
 * One buzz per burst, not one per message. A conversation's first message
 * alerts; the ones after it update the notice silently, until the next alert is
 * due again:
 *  - [quietMs] (five minutes) have passed with no new message in that
 *    conversation, counted from its latest one;
 *  - the notice was tapped, dismissed or replied to, or the person opened the
 *    conversation in the app — each of those is a [rearm];
 *  - the message mentions the person by name, which alerts wherever it lands.
 * Catch-up is always silent and leaves the burst alone.
 *
 * What it keeps is one timestamp per conversation that has recently had a
 * message, and at most [maxConversations] of them: past that, the conversation
 * quiet for longest is forgotten, which only means its next message is a first
 * one again — a buzz too many, never a missed one.
 *
 * The caller passes the time in ([onLive]'s `now`, any steady millisecond
 * clock) and decides which messages get this far at all: not your own, not a
 * muted conversation (see NotifyRules). Safe to call from any thread.
 */
class BurstGate(val quietMs: Long = 5 * 60_000L, maxConversations: Int = 1000) {
    // convKey -> when its latest message came. Least recently active goes first.
    private val lastMessageAt = LruMap<String, Long>(maxConversations)

    /**
     * A message has just arrived live in [convKey]. Every message counts as the
     * conversation's latest, loud or not. A clock that has gone backwards cannot
     * say how long it has been quiet, so that answers loud: missing a message
     * is worse than one buzz too many.
     */
    @Synchronized
    fun onLive(convKey: String, now: Long, mentionsMe: Boolean): Alert {
        val last = lastMessageAt.put(convKey, now)
        val newBurst = last == null || now < last || now - last >= quietMs
        return if (newBurst || mentionsMe) Alert.LOUD else Alert.SILENT
    }

    /** A message from catch-up: posted, but never with a sound, and not part of any burst. */
    @Suppress("UNUSED_PARAMETER")
    fun onCatchUp(convKey: String): Alert = Alert.SILENT

    /** The person dealt with [convKey]; its next message alerts again. */
    @Synchronized
    fun rearm(convKey: String) {
        lastMessageAt.remove(convKey)
    }
}
