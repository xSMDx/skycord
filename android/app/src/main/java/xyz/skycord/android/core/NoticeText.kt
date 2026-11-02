package xyz.skycord.android.core

import java.net.URLEncoder

/**
 * A conversation as the page and the server name it: [kind] is "dm", "group" or
 * "channel"; [id] is the partner's id for a DM, the group's, or the channel's;
 * [serverId] is the channel's server (a channel is only found through it) and
 * null for the other two.
 */
data class ConvRef(val kind: String, val id: String, val serverId: String? = null) {
    /** What one notification per conversation is keyed by: "dm:…", "group:…", "channel:…". */
    val key: String get() = "$kind:$id"
}

/**
 * What a notification calls things, and where a reply to it goes. Pure, so the
 * words and the routes are tested without a phone. The titles are the web
 * client's own notice titles (notifyRules.ts `decide`), so the phone and the
 * desktop name a conversation the same way.
 */
object NoticeText {
    /** One message's title: who said it, and where. */
    fun title(e: IncomingMessage): String = when (e) {
        is IncomingMessage.Dm -> e.authorName
        is IncomingMessage.Group -> "${e.authorName} · ${e.groupName}"
        is IncomingMessage.Channel -> "${e.authorName} · #${e.channelName} · ${e.serverName}"
    }

    /** The conversation's own title, whoever spoke last. */
    fun conversationTitle(e: IncomingMessage): String = when (e) {
        is IncomingMessage.Dm -> e.authorName
        is IncomingMessage.Group -> e.groupName
        is IncomingMessage.Channel -> "#${e.channelName} · ${e.serverName}"
    }

    /** Who wrote it, by the name the conversation shows. */
    fun authorName(e: IncomingMessage): String = when (e) {
        is IncomingMessage.Dm -> e.authorName
        is IncomingMessage.Group -> e.authorName
        is IncomingMessage.Channel -> e.authorName
    }

    /** One notification per conversation: this is what it is keyed by. */
    fun convKey(e: IncomingMessage): String = ref(e).key

    /** The conversation this message belongs to, as the page and the server name it. */
    fun ref(e: IncomingMessage): ConvRef = when (e) {
        is IncomingMessage.Dm -> ConvRef("dm", e.partnerId)
        is IncomingMessage.Group -> ConvRef("group", e.groupId)
        is IncomingMessage.Channel -> ConvRef("channel", e.channelId, e.serverId)
    }

    /**
     * The REST route a reply is posted to (the spec's three), or null when the
     * conversation does not say enough to name one. Each id is one path segment,
     * whatever characters it holds.
     */
    fun replyPath(ref: ConvRef): String? = when (ref.kind) {
        "dm" -> "/messages/dm/${segment(ref.id)}"
        "group" -> "/conversations/groups/${segment(ref.id)}/messages"
        "channel" -> ref.serverId?.takeIf { it.isNotEmpty() }
            ?.let { "/servers/${segment(it)}/channels/${segment(ref.id)}/messages" }
        else -> null
    }

    /**
     * The message as the notification shows it: plain text, markers turned into
     * words, cut short. A message with nothing left to show (a picture alone, say)
     * gets [fallback], as the web's notices say "New message".
     */
    fun body(content: String, fallback: String): String = plainBody(content).ifEmpty { fallback }

    /**
     * The missed-call notification's title: "Missed call from Sam". [template] is the
     * string resource (`notice_missed_call`, one `%1$s` for the name); it defaults to the same
     * words, which a test ties to the resource. The name is an argument, never part of the
     * template, so a `%` in it is only a `%`.
     */
    fun missedCallText(name: String, template: String = MISSED_CALL): String = template.format(name)

    private const val MISSED_CALL = "Missed call from %1\$s"

    // URLEncoder writes a space as "+", which in a path is a plus, not a space.
    private fun segment(id: String): String = URLEncoder.encode(id, "UTF-8").replace("+", "%20")
}
