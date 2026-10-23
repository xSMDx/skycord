package xyz.skycord.android.core

import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * Calls carry startedAt on the server's clock, and the phone rings only for a
 * call that started within 30 s — so a phone clock that is off by more than
 * that would never ring, or ring late. The refresh response's Date header is
 * the server's clock, and the difference to the phone's is all that is kept.
 * The header has one-second resolution, which is plenty for a 30 s window.
 */
object ServerClock {
    /**
     * Server time minus [localNow] (both epoch milliseconds), from an HTTP
     * Date header such as `Tue, 15 Nov 1994 08:12:31 GMT`; null when the
     * header is missing, blank or not a date. Add the result to the phone's
     * clock to get the server's.
     */
    fun offsetFrom(dateHeader: String?, localNow: Long): Long? {
        val text = dateHeader?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        // RFC 1123 is the one format HTTP/1.1 requires of a Date header.
        // The formatter reads English day and month names whatever the phone's language.
        val server = try {
            OffsetDateTime.parse(text, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
        } catch (e: DateTimeParseException) {
            return null
        }
        return server - localNow
    }
}
