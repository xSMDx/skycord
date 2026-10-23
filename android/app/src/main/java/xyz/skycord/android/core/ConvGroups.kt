package xyz.skycord.android.core

/**
 * How a catch-up is laid out for the shade: each conversation once, with all its lines.
 * Posting a conversation's messages one at a time would mean up to a hundred updates in a
 * moment, which Android sheds, and each would have to read what the last one left.
 */
object ConvGroups {
    /**
     * [items], oldest first, split by conversation ([keyOf]): one group per conversation, its items still
     * oldest first. The groups go by the time ([atOf]) of their newest item, earliest first, so the
     * conversation that spoke last is posted last and ends up on top; conversations that tie keep the
     * order in which they were first met.
     */
    fun <T> byConversation(items: List<T>, keyOf: (T) -> String, atOf: (T) -> Long): List<List<T>> {
        val groups = LinkedHashMap<String, MutableList<T>>()
        for (item in items) groups.getOrPut(keyOf(item)) { ArrayList() }.add(item)
        return groups.values.sortedBy { g -> g.maxOf(atOf) } // a stable sort
    }
}
