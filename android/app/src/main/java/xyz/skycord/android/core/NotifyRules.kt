package xyz.skycord.android.core

import java.time.Instant
import java.time.ZoneId
import java.time.chrono.IsoChronology
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/*
 * What buzzes the phone, by exactly the rules the web client uses — a port of
 * desktop/src/composables/notifyRules.ts (classify, mentionsMe, plainBody),
 * notifyLevels.ts (placeMuted, placeLevel) and stripMarkers from
 * desktop/src/utils/richText.ts. If one changes, the other changes with it, or
 * the phone and the web client start to disagree about what is worth a sound.
 *
 * The rules: a DM, a group message, a channel message at its channel's level
 * (by default only those that mention you) — never your own, never a muted
 * conversation, never a system message, and nothing while you are Do Not
 * Disturb. The web client also asks whether its window is in front; a phone's
 * background service has no window, so that question does not exist here.
 */

/** A server's, category's or channel's notification level. */
enum class Level { ALL, MENTIONS, NOTHING }

/** What a server left alone means. */
val SERVER_DEFAULT: Level = Level.MENTIONS

/** What an event is, once it is for you: any message, or one that mentions you. */
enum class Kind { MESSAGE, MENTION }

data class Me(val id: String, val displayName: String, val username: String)

/**
 * Everything the rules need, handed in, so each is tested without a socket.
 * [isMuted] takes the key mutes are stored under: a DM by the partner's id; a
 * group, server, category or channel by its own id. [levelOf] is a server's,
 * category's or channel's level, or null when it is left on the default.
 */
data class RuleState(
    val me: Me,
    val dnd: Boolean,
    val isMuted: (String) -> Boolean,
    val levelOf: (String) -> Level?,
)

/**
 * A message that has just arrived, as far as the rules care. (Not `Incoming`:
 * that name is already the bridge's page-to-app message in this package.)
 */
sealed interface IncomingMessage {
    val messageId: String
    val authorId: String
    val content: String
    /** A notice the server posts ("Ana joined"), not something a person said. */
    val system: Boolean

    data class Dm(
        override val messageId: String,
        val partnerId: String,
        override val authorId: String,
        val authorName: String,
        override val content: String,
        override val system: Boolean,
    ) : IncomingMessage

    data class Group(
        override val messageId: String,
        val groupId: String,
        val groupName: String,
        override val authorId: String,
        val authorName: String,
        override val content: String,
        override val system: Boolean,
    ) : IncomingMessage

    data class Channel(
        override val messageId: String,
        val channelId: String,
        val channelName: String,
        val categoryId: String?,
        val serverId: String,
        val serverName: String,
        override val authorId: String,
        val authorName: String,
        override val content: String,
        val mentionsEveryone: Boolean,
        override val system: Boolean,
    ) : IncomingMessage
}

// ---- where a channel's mute and level come from (notifyLevels.ts) -----------

// A channel sits in a category (or none) in a server. The web reads
// `categoryId ? … : …`, so an empty id counts as no category there; so it does here.
private fun chain(channelId: String, categoryId: String?, serverId: String): List<String> =
    if (categoryId.isNullOrEmpty()) listOf(channelId, serverId) else listOf(channelId, categoryId, serverId)

/** A mute on the channel, its category or its server mutes the channel. */
fun placeMuted(channelId: String, categoryId: String?, serverId: String, s: RuleState): Boolean =
    chain(channelId, categoryId, serverId).any(s.isMuted)

/** The nearest level that is set — channel, then category, then server — else [SERVER_DEFAULT]. */
fun placeLevel(channelId: String, categoryId: String?, serverId: String, s: RuleState): Level {
    for (id in chain(channelId, categoryId, serverId)) s.levelOf(id)?.let { return it }
    return SERVER_DEFAULT
}

// ---- mentions and the rule itself (notifyRules.ts) ---------------------------

/**
 * Whether a message mentions you. Mentions are written by name today
 * (`<@Name>`), so two people sharing a display name are both matched — the
 * same known limit as on the web, until mentions carry user ids. Display name
 * or username, any case, regex characters taken literally (Regex.escape is
 * the web's `literal`).
 */
fun mentionsMe(content: String, me: Me): Boolean {
    val names = listOf(me.displayName, me.username).map { it.trim(::isJsSpace) }.filter { it.isNotEmpty() }
    if (names.isEmpty()) return false
    val any = names.joinToString("|") { Regex.escape(it) }
    return Regex("<@(?:$any)>", RegexOption.IGNORE_CASE).containsMatchIn(content)
}

/**
 * Whether an event is for you, and as what; null means stay quiet. Not your
 * own messages, not a system message, not a muted conversation, not a channel
 * message below its channel's level, and nothing at all while Do Not Disturb.
 * A DM or a group message is always a message, even if it mentions you; only
 * a channel tells a mention apart.
 */
fun classify(e: IncomingMessage, s: RuleState): Kind? {
    if (s.dnd || e.system || e.authorId == s.me.id) return null
    return when (e) {
        is IncomingMessage.Dm -> if (s.isMuted(e.partnerId)) null else Kind.MESSAGE
        is IncomingMessage.Group -> if (s.isMuted(e.groupId)) null else Kind.MESSAGE
        is IncomingMessage.Channel -> {
            if (placeMuted(e.channelId, e.categoryId, e.serverId, s)) return null
            val forMe = e.mentionsEveryone || mentionsMe(e.content, s.me)
            when (placeLevel(e.channelId, e.categoryId, e.serverId, s)) {
                Level.NOTHING -> null
                Level.MENTIONS -> if (forMe) Kind.MENTION else null
                Level.ALL -> if (forMe) Kind.MENTION else Kind.MESSAGE
            }
        }
    }
}

// ---- what the notice says ----------------------------------------------------

const val BODY_MAX = 200

/**
 * The message as one line of plain text: markers turned into words, every run
 * of whitespace one space, cut short with an ellipsis. Cut by UTF-16 units, as
 * the web's `slice` does.
 */
fun plainBody(content: String, max: Int = BODY_MAX, time: TimeFormat = TimeFormat()): String {
    val flat = JS_SPACES.replace(stripMarkers(content, time), " ").trim(::isJsSpace)
    if (flat.length <= max) return flat
    var cut = (max - 1).coerceAtLeast(0)
    // The web's slice may keep half an emoji before the dots; Android draws that as a box, so drop the half.
    if (cut > 0 && flat[cut - 1].isHighSurrogate()) cut--
    return flat.substring(0, cut).trimEnd(::isJsSpace) + "…"
}

// JavaScript's idea of whitespace (`\s`, `trim()`), not Java's: they differ on
// a few characters (U+0085, U+FEFF, U+001C..U+001F), and a phone and a browser
// must cut the same text in the same place.
private fun isJsSpace(c: Char): Boolean = when (c) {
    '\t', '\n', '\u000B', '\u000C', '\r', ' ', '\u00A0', '\u1680', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF' -> true
    else -> c in '\u2000'..'\u200A'
}

// The same set as the body of a regex character class, built from the function
// above so the two cannot drift apart.
private val JS_SPACE: String = buildString {
    for (code in 0..0xFFFF) if (isJsSpace(code.toChar())) append("\\u%04X".format(code))
}
private val JS_SPACES = Regex("[$JS_SPACE]+")

// The regexes of stripMarkers, in its order. Replacements are written as
// functions so that nothing in a message is ever read as a `$1`.
private val CODE_FENCE = Regex("```([\\s\\S]+?)```")
private val INLINE_CODE = Regex("`([^`]+)`")
private val LINK = Regex("\\[([^\\]\\n]+)\\]\\((https?://[^$JS_SPACE)]+)\\)")
private val MENTION = Regex("<@([^>\\n]+)>")
// ASCII digits and word characters spelled out: on Android the regex engine is
// ICU's, where \d and \w can reach further than JavaScript's do.
private val TIME_TOKEN = Regex("<t:([0-9]+):([tTdDfFR])>")
private val BOLD = Regex("\\*\\*([^\\n]+?)\\*\\*")
private val UNDERLINE = Regex("__([^\\n]+?)__")
private val STRIKE = Regex("~~([^\\n]+?)~~")
private val ITALIC_STAR = Regex("\\*([^*\\n]+?)\\*")
private val ITALIC_UNDERSCORE = Regex("(^|[^A-Za-z0-9_])_([^_\\n]+?)_(?![A-Za-z0-9_])")
// JS `^` with the m flag: the start, or right after a line terminator.
private val QUOTE_ARROW = Regex("(?:^|(?<=[\\n\\r\\u2028\\u2029]))>[$JS_SPACE]?")

/** A message's text with its markers turned into words — `stripMarkers` in richText.ts. */
fun stripMarkers(raw: String, time: TimeFormat = TimeFormat()): String {
    var s = raw
    s = CODE_FENCE.replace(s) { it.groupValues[1] }
    s = INLINE_CODE.replace(s) { it.groupValues[1] }
    s = LINK.replace(s) { it.groupValues[1] }
    s = MENTION.replace(s) { "@" + it.groupValues[1] }
    s = TIME_TOKEN.replace(s) { timeToken(it.groupValues[1], it.groupValues[2][0], time) }
    s = BOLD.replace(s) { it.groupValues[1] }
    s = UNDERLINE.replace(s) { it.groupValues[1] }
    s = STRIKE.replace(s) { it.groupValues[1] }
    s = ITALIC_STAR.replace(s) { it.groupValues[1] }
    s = ITALIC_UNDERSCORE.replace(s) { it.groupValues[1] + it.groupValues[2] }
    s = QUOTE_ARROW.replace(s, "")
    return s.trim(::isJsSpace)
}

// ---- time tokens: <t:unixSeconds:style> ---------------------------------------

/**
 * How a time token is written: in the phone's own language and zone, as the
 * web writes it in the browser's. All three can be chosen so a test does not
 * depend on where it runs.
 */
class TimeFormat(
    val locale: Locale = Locale.getDefault(),
    val zone: ZoneId = ZoneId.systemDefault(),
    val nowMs: () -> Long = System::currentTimeMillis,
)

// The latest instant a JavaScript Date can hold; beyond it the web writes nothing.
private const val MAX_DATE_SECONDS = 8_640_000_000_000L

// formatTimeToken in richText.ts, on java.time's localised styles: t and T the
// time, d the short date with a four-digit year, D the long date, f and F the
// long and the full date with the time. R is relative and has no localised
// form on the JVM, so it is English. Digits can pad differently from a browser's
// ("2:30 PM" for "02:30 PM"); the words and the order are the language's.
private fun timeToken(unix: String, style: Char, t: TimeFormat): String {
    val seconds = unix.toLongOrNull()?.takeIf { it <= MAX_DATE_SECONDS } ?: return ""
    if (style == 'R') return relative(seconds * 1000, t.nowMs())
    val at = Instant.ofEpochSecond(seconds).atZone(t.zone)
    val format = when (style) {
        't' -> DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
        'T' -> DateTimeFormatter.ofLocalizedTime(FormatStyle.MEDIUM)
        'd' -> {
            val pattern = DateTimeFormatterBuilder
                .getLocalizedDateTimePattern(FormatStyle.SHORT, null, IsoChronology.INSTANCE, t.locale)
                .replace(Regex("(?<!y)yy(?!y)"), "yyyy")
            DateTimeFormatter.ofPattern(pattern)
        }
        'D' -> DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG)
        'f' -> DateTimeFormatter.ofLocalizedDateTime(FormatStyle.LONG, FormatStyle.SHORT)
        else -> DateTimeFormatter.ofLocalizedDateTime(FormatStyle.FULL, FormatStyle.SHORT)
    }
    return format.withLocale(t.locale).format(at)
}

// [below this many ms, divide by this many, to count in this unit]
private val RELATIVE_STEPS = listOf(
    Triple(60_000L, 1_000L, "second"),
    Triple(3_600_000L, 60_000L, "minute"),
    Triple(86_400_000L, 3_600_000L, "hour"),
    Triple(604_800_000L, 86_400_000L, "day"),
    Triple(2_629_800_000L, 604_800_000L, "week"),
    Triple(31_557_600_000L, 2_629_800_000L, "month"),
)
private const val YEAR_MS = 31_557_600_000L

// The web's `relative`, with Intl.RelativeTimeFormat's English for numeric: 'auto'.
private fun relative(atMs: Long, nowMs: Long): String {
    val diff = atMs - nowMs
    for ((limit, div, unit) in RELATIVE_STEPS) if (abs(diff) < limit) return said(jsRound(diff.toDouble() / div), unit)
    return said(jsRound(diff.toDouble() / YEAR_MS), "year")
}

// JavaScript's Math.round: halves go up, so -1.5 is -1.
private fun jsRound(x: Double): Long = floor(x + 0.5).toLong()

private fun said(n: Long, unit: String): String {
    if (n == 0L) return "now" // only seconds can round to nothing
    if (abs(n) == 1L) when (unit) {
        "day" -> return if (n > 0) "tomorrow" else "yesterday"
        "week", "month", "year" -> return (if (n > 0) "next " else "last ") + unit
    }
    val count = "%,d %s%s".format(Locale.US, abs(n), unit, if (abs(n) == 1L) "" else "s")
    return if (n > 0) "in $count" else "$count ago"
}
