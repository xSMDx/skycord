package xyz.skycord.android.core

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

/**
 * A message event as the server sends it, before the names it lacks are looked
 * up. [kind] is "dm", "group" or "channel"; [conversationId] is the DM's two
 * user ids joined by `_`, the group's id or the channel's id. [createdAt] is
 * epoch ms on the server's clock, null when the event did not say.
 */
data class RawMessage(
    val kind: String,
    val messageId: String,
    val conversationId: String,
    val authorId: String,
    val authorName: String,
    val content: String,
    val system: Boolean,
    val serverId: String? = null,
    val categoryId: String? = null,
    val mentionsEveryone: Boolean = false,
    val createdAt: Long? = null,
)

/** Catch-up's answer: the server's clock when it was asked ([now], the next `since`), and the events, newest first. */
data class Missed(val now: Long, val events: List<RawMessage>)

/**
 * Reads the server's message events: the live socket's `dm:receive`,
 * `group:receive` and `channel:receive` (messagesController.ts dmReceivePayload,
 * chatSocket.ts group:send, channelsController.ts), and catch-up's
 * GET /users/me/missed (missedController.ts). Strict about types, as the
 * bridge is: an id that is not a string is no id, and an event without the
 * essentials is dropped rather than guessed at.
 *
 * Neither the live channel event nor catch-up names the group, the channel or
 * the server, so [toIncoming] asks [Names] (the service's Directory) and falls
 * back to plain words when it does not know.
 */
object MessageEvents {
    /** What the payloads leave out, looked up. Null when not known. */
    interface Names {
        fun groupName(groupId: String): String?
        fun channelName(serverId: String, channelId: String): String?
        fun serverName(serverId: String): String?
    }

    /** The words used when a name is not known. */
    data class Fallbacks(val group: String, val channel: String, val server: String)

    private val KINDS = setOf("dm", "group", "channel")

    /** A live event of [kind] ("dm", "group", "channel"), or null when it lacks what every message has. */
    fun live(kind: String, payload: JSONObject): RawMessage? =
        read(kind, payload, system = payload.opt("kind") == "system")

    /**
     * Catch-up's `{ now, events }`, or null when there is no usable `now`. An
     * event that cannot be read is skipped; the rest are kept, in order.
     * Catch-up never returns system lines (the server filters them by kind).
     */
    fun missed(body: JSONObject): Missed? {
        val now = (body.opt("now") as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 }?.toLong() ?: return null
        val list = body.opt("events") as? JSONArray ?: return Missed(now, emptyList())
        val events = (0 until list.length()).mapNotNull { i ->
            val o = list.opt(i) as? JSONObject ?: return@mapNotNull null
            val type = o.opt("type") as? String ?: return@mapNotNull null
            read(type, o, system = false)
        }
        return Missed(now, events)
    }

    /** The other person in a DM's conversation id, or null when the conversation is not one of [me]'s. */
    fun dmPartner(conversationId: String, me: String): String? {
        val ids = conversationId.split('_')
        if (ids.size != 2 || ids.any { it.isEmpty() }) return null
        return when (me) {
            ids[0] -> ids[1].takeIf { it != me }
            ids[1] -> ids[0]
            else -> null
        }
    }

    /** The rules' view of [raw], or null when it cannot be placed (a DM that is not [me]'s). */
    fun toIncoming(raw: RawMessage, me: String, names: Names, fallbacks: Fallbacks): IncomingMessage? = when (raw.kind) {
        "dm" -> dmPartner(raw.conversationId, me)?.let { partner ->
            IncomingMessage.Dm(raw.messageId, partner, raw.authorId, raw.authorName, raw.content, raw.system)
        }
        "group" -> IncomingMessage.Group(
            raw.messageId, raw.conversationId, names.groupName(raw.conversationId) ?: fallbacks.group,
            raw.authorId, raw.authorName, raw.content, raw.system,
        )
        "channel" -> raw.serverId?.let { serverId ->
            IncomingMessage.Channel(
                messageId = raw.messageId,
                channelId = raw.conversationId,
                channelName = names.channelName(serverId, raw.conversationId) ?: fallbacks.channel,
                categoryId = raw.categoryId,
                serverId = serverId,
                serverName = names.serverName(serverId) ?: fallbacks.server,
                authorId = raw.authorId,
                authorName = raw.authorName,
                content = raw.content,
                mentionsEveryone = raw.mentionsEveryone,
                system = raw.system,
            )
        }
        else -> null
    }

    /** An ISO-8601 time as epoch ms, or null. The server writes `toISOString()`; an offset is read too. */
    fun epochMs(iso: String?): Long? {
        val text = iso?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return try {
            Instant.parse(text).toEpochMilli()
        } catch (e: DateTimeParseException) {
            try {
                OffsetDateTime.parse(text).toInstant().toEpochMilli()
            } catch (e2: DateTimeParseException) {
                null
            }
        }
    }

    private fun read(kind: String, o: JSONObject, system: Boolean): RawMessage? {
        if (kind !in KINDS) return null
        val id = o.string("_id") ?: return null
        val conversation = o.string("conversationId") ?: return null
        val author = o.string("authorId") ?: return null
        // A channel is only found through its server, and its mute and level chain run through it.
        val serverId = o.string("serverId")
        if (kind == "channel" && serverId == null) return null
        return RawMessage(
            kind = kind,
            messageId = id,
            conversationId = conversation,
            authorId = author,
            authorName = o.opt("authorName") as? String ?: "",
            content = o.opt("content") as? String ?: "",
            system = system,
            serverId = if (kind == "channel") serverId else null,
            categoryId = if (kind == "channel") o.string("categoryId") else null,
            mentionsEveryone = kind == "channel" && o.opt("mentionsEveryone") == true,
            createdAt = epochMs(o.opt("createdAt") as? String),
        )
    }

    /** A real, non-empty JSON string; Android's optString would turn null into "null". */
    private fun JSONObject.string(key: String): String? = (opt(key) as? String)?.takeIf { it.isNotEmpty() }
}
