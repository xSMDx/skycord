package xyz.skycord.android.core

/**
 * A map that forgets what it has used least recently once it holds more than
 * [capacity] entries. Reading an entry counts as using it. Not thread-safe on
 * its own: the gates that hold one guard it themselves.
 */
internal class LruMap<K, V>(private val capacity: Int) : LinkedHashMap<K, V>(16, 0.75f, true) {
    init {
        require(capacity > 0) { "capacity must be positive, was $capacity" }
    }

    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>?): Boolean = size > capacity
}

/**
 * Which messages the phone has already notified about, so that the same one is
 * never posted twice: the live event and the catch-up that lists it again after
 * a dropped connection, or catch-up and a live event that arrives late.
 *
 * It keeps the last [capacity] ids it has met, forgetting the one it has met
 * least recently. An id long forgotten would only be a duplicate again if the
 * server resent a message more than [capacity] others ago, which catch-up's
 * own caps (100 messages, 24 hours) rule out.
 */
class SeenMessages(val capacity: Int = 2000) {
    private val seen = LruMap<String, Unit>(capacity)

    /**
     * True the first time [messageId] is met; false for every later time while
     * it is still remembered. A blank id is always "first": with nothing to
     * tell two messages apart, calling the second a duplicate would lose it.
     */
    @Synchronized
    fun firstTime(messageId: String): Boolean {
        if (messageId.isBlank()) return true
        if (seen[messageId] != null) return false // the read also marks it as recently used
        seen[messageId] = Unit
        return true
    }
}
