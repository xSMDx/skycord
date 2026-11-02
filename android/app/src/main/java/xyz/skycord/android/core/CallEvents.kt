package xyz.skycord.android.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * The server's call events as the background connection reads them: `call:state`
 * (chatSocket.ts callStatePayload) and `call:declined` (the `call:decline` handler).
 * Strict about types, as the message events are: an id that is not a string is no
 * id, and an event without its essentials is dropped rather than guessed at.
 */
object CallEvents {
    /**
     * Who is in [room] ([userIds], empty when the call is over) and when the call started
     * ([startedAt], epoch ms on the server's clock; null from an older server or an empty room).
     */
    data class State(val room: String, val userIds: List<String>, val startedAt: Long?)

    /** [userId] declined the call in [room] — you, on another of your devices, or someone you called. */
    data class Declined(val room: String, val userId: String)

    fun state(payload: JSONObject): State? {
        val room = id(payload.opt("room")) ?: return null
        val list = payload.opt("userIds") as? JSONArray ?: return null
        val ids = (0 until list.length()).map { id(list.opt(it)) ?: return null }
        val at = (payload.opt("startedAt") as? Number)?.toDouble()?.takeIf { it.isFinite() && it > 0 }?.toLong()
        return State(room, ids, at)
    }

    fun declined(payload: JSONObject): Declined? {
        val room = id(payload.opt("room")) ?: return null
        val who = id(payload.opt("userId")) ?: return null
        return Declined(room, who)
    }

    /** A real, non-empty string. (`JSONObject.NULL` and numbers are not.) */
    private fun id(v: Any?): String? = (v as? String)?.takeIf { it.isNotEmpty() }
}
