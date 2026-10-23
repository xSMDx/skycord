package xyz.skycord.android.core

import org.json.JSONObject

/**
 * The person's mutes and notification levels, keyed by any id — a DM partner,
 * a group, a server, a category, a channel — as GET /users/me/conversations
 * returns them (`{ prefs: { id: { muted, mutedUntil, level, … } } }`). Read the
 * way the web client's useConvPrefs.ts reads them, so the two agree: a mute
 * whose end has passed is no mute, judged when asked, not when fetched; and a
 * level of "default" (or one this build does not know) is no level, so the
 * chain in NotifyRules looks further up.
 */
class ConvPrefs private constructor(private val entries: Map<String, Entry>) {
    /** [mutedUntil] null with [muted] set is muted until turned off. */
    private data class Entry(val muted: Boolean, val mutedUntil: Long?, val level: Level?)

    /** Whether [id] is muted at [nowMs] (epoch ms). */
    fun isMuted(id: String, nowMs: Long): Boolean {
        val e = entries[id] ?: return false
        if (!e.muted) return false
        val until = e.mutedUntil ?: return true
        return until > nowMs
    }

    /** [id]'s own level, or null when it is left on the default. */
    fun levelOf(id: String): Level? = entries[id]?.level

    companion object {
        /** Before the first fetch: nothing muted, every level on its default. */
        val EMPTY = ConvPrefs(emptyMap())

        /** The answer of GET /users/me/conversations, or null when it is not one. */
        fun parse(body: JSONObject): ConvPrefs? {
            val prefs = body.opt("prefs") as? JSONObject ?: return null
            val entries = HashMap<String, Entry>()
            for (id in prefs.keys()) {
                val p = prefs.opt(id) as? JSONObject ?: continue
                entries[id] = Entry(
                    muted = p.opt("muted") == true,
                    // An end that is not a date reads as no end: muted, as the web's NaN comparison leaves it.
                    mutedUntil = MessageEvents.epochMs(p.opt("mutedUntil") as? String),
                    level = when (p.opt("level")) {
                        "all" -> Level.ALL
                        "mentions" -> Level.MENTIONS
                        "nothing" -> Level.NOTHING
                        else -> null
                    },
                )
            }
            return ConvPrefs(entries)
        }

        /**
         * Do Not Disturb, from the person's chosen [status] (GET /auth/me's `user.status`,
         * or a `presence:self` event's `status`) and its end [untilMs], when it has one.
         * The web client turns a timed status back to online when its end comes; so does this.
         */
        fun dnd(status: String?, untilMs: Long?, nowMs: Long): Boolean =
            status == "dnd" && (untilMs == null || nowMs < untilMs)
    }
}
