package xyz.skycord.android.core

/**
 * A call's room, as the server names it (chatSocket.ts): `dm:<a>_<b>` for the two
 * people of a DM, `group:<id>` for a group, `voice:<channelId>` for a voice channel.
 * Only the first two are calls to a person; a voice channel is somewhere to drop in.
 */
object CallRooms {
    /**
     * The conversation a room is, as the page names it: [kind] "dm" with the *other*
     * person's id, or "group" with the group's. What Answer hands to the page, and
     * what a missed call opens.
     */
    data class Target(val kind: String, val convId: String) {
        /** The conversation's notification key ("dm:…", "group:…"), as the page's `seen` names it. */
        val key: String get() = "$kind:$convId"
    }

    /** The conversation [room] is for [me], or null when it is not a DM or group room of theirs. */
    fun target(room: String, me: String): Target? = when {
        room.startsWith("dm:") -> {
            val partner = MessageEvents.dmPartner(room.removePrefix("dm:"), me)
            // A DM with yourself has no one to ring.
            partner?.takeIf { it != me }?.let { Target("dm", it) }
        }
        room.startsWith("group:") -> room.removePrefix("group:").takeIf { it.isNotEmpty() }?.let { Target("group", it) }
        else -> null
    }

    /**
     * What a ring (and the missed call after it) calls the caller. A DM: the partner's
     * name. A group: the group's name, led by the caller's when it is known, as a group
     * message's title is ("Ana · Crew"). [someone] and [unknownGroup] stand in for names
     * that could not be found.
     */
    fun callerLabel(kind: String, callerName: String?, groupName: String?, someone: String, unknownGroup: String): String =
        if (kind == "group") {
            val group = groupName ?: unknownGroup
            if (callerName != null) "$callerName · $group" else group
        } else {
            callerName ?: someone
        }
}
