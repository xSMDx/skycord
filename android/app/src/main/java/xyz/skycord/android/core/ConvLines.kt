package xyz.skycord.android.core

/**
 * What each conversation's notification holds: its lines, oldest first, and whether a mention
 * is among them. The notifier keeps them here, in memory, rather than reading them back from
 * Android's list of what is showing: `notify()` is asynchronous, and Android sheds updates a
 * package posts too fast, so two posts in a burst could each start from the same stale list and
 * one line would be lost.
 *
 *  - **Bounded.** The last [capacity] lines (a MessagingStyle shows no more than 25 anyway).
 *  - **Cleared** when the notification goes: opened, dismissed, signed out, another server. A
 *    cleared conversation stays [tracked] with nothing held, so that Android's list, which may
 *    take a moment to catch up with the cancel, can never put the old lines back ([seed]).
 *  - **Seeded once.** A conversation not touched since the process began may have a notification
 *    from before it (Android kept it when the process was killed): [seed] lets the notifier take
 *    those lines over, once. After [clearAll] nothing is seeded any more, for every notification
 *    still showing then was cancelled.
 *  - **Stale.** A notification can go without telling us (a tap with auto-cancel sends nothing).
 *    Once the last post is older than [trustMs] the notifier checks Android before trusting what
 *    is held ([stale]); inside that time it never has to ask.
 *
 * Generic so it is tested on plain strings; the notifier's lines are its own type. Safe to call
 * from any thread.
 */
class ConvLines<L>(private val capacity: Int = 25, private val trustMs: Long = 5_000) {
    /** A conversation's lines, oldest first, and whether any of them mentioned the person. */
    class Held<L>(val lines: List<L>, val mentioned: Boolean)

    private class Pile<L>(val lines: List<L>, val mentioned: Boolean, val at: Long)

    private val piles = HashMap<String, Pile<L>>()
    private var sealed = false

    init {
        require(capacity > 0) { "capacity must be positive, was $capacity" }
    }

    /** What [key]'s notification holds, or null when nothing (never posted, or cleared since). */
    @Synchronized
    fun held(key: String): Held<L>? = piles[key]?.takeIf { it.lines.isNotEmpty() }?.let { Held(it.lines, it.mentioned) }

    /** Whether [key] has been posted to or cleared since the process began (or the last [clearAll]). */
    @Synchronized
    fun tracked(key: String): Boolean = piles.containsKey(key)

    /**
     * Adds [added] (oldest first) to [key]'s lines, keeping the last [capacity], and marks the
     * conversation as mentioned if [mentioned] (or if it already was). [nowMs] stamps the post for [stale].
     */
    @Synchronized
    fun append(key: String, added: List<L>, mentioned: Boolean, nowMs: Long): Held<L> {
        val before = piles[key]
        val lines = ((before?.lines ?: emptyList()) + added).takeLast(capacity)
        val marked = mentioned || before?.mentioned == true
        piles[key] = Pile(lines, marked, nowMs)
        return Held(lines, marked)
    }

    /**
     * Takes over [lines] already showing for [key], once: only if [key] is not [tracked] and nothing
     * has been cleared wholesale since. True when it did.
     */
    @Synchronized
    fun seed(key: String, lines: List<L>, mentioned: Boolean, nowMs: Long): Boolean {
        if (sealed || piles.containsKey(key)) return false
        piles[key] = Pile(lines.takeLast(capacity), mentioned, nowMs)
        return true
    }

    /** Whether [key] holds lines whose last post is older than the trust time: ask Android if it is still showing. */
    @Synchronized
    fun stale(key: String, nowMs: Long): Boolean {
        val p = piles[key] ?: return false
        return p.lines.isNotEmpty() && nowMs - p.at > trustMs
    }

    /** [key]'s notification is gone. It stays tracked, empty. */
    @Synchronized
    fun clear(key: String) {
        piles[key] = Pile(emptyList(), false, 0L)
    }

    /** Every notification is gone, and none of Android's older ones is to be taken over after this. */
    @Synchronized
    fun clearAll() {
        sealed = true
        for (key in piles.keys.toList()) piles[key] = Pile(emptyList(), false, 0L)
    }
}

/**
 * The lines of [added] that a notification holding [held] does not already have: the ones with no id
 * (the person's own replies) always, the others only when no line held, or earlier in [added], has
 * the same [idOf]. Order kept. A process Android killed leaves its notification showing; the next
 * process takes its lines over, and the catch-up after it lists messages that are already in them.
 */
fun <L> freshLines(held: List<L>, added: List<L>, idOf: (L) -> String?): List<L> {
    val known = HashSet<String>()
    for (l in held) idOf(l)?.let(known::add)
    return added.filter { l -> idOf(l)?.let(known::add) ?: true }
}
