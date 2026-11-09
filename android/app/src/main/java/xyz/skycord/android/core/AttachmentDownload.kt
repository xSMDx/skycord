package xyz.skycord.android.core

import java.io.ByteArrayOutputStream
import java.nio.charset.Charset
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/**
 * A chat attachment the page asks to download (a file card's Download, or the large view's):
 * whether the app saves it, under what name, and as what type. Pure, so the rules are tested
 * without a phone; MainActivity hands the download to Android's DownloadManager.
 *
 * Only the current server's own attachments are saved: `/messages/attachments/<key>/<name>` on
 * the server whose page is showing (the server serves them there, AttachmentList.vue links them).
 * Anything else a page might start downloading — another site, a blob:, a data: — is refused.
 */
object AttachmentDownload {
    /** The server's keys are 128 bits in base64url (22 characters); it refuses any longer than 64. */
    private val KEY = Regex("^[A-Za-z0-9_-]{1,64}$")

    /**
     * Whether [url] is one of [server]'s attachments: the same origin (as [Origins] means it) and a
     * path that is exactly /messages/attachments/<key>/<name>. [server] is the origin of the server
     * whose page is showing, null on the launcher (where nothing is saved).
     */
    fun isAttachment(url: String, server: String?): Boolean {
        if (server == null || Origins.of(url) != server) return false
        val rest = url.substring(url.indexOf("://") + 3)
        // Where the origin ends (Origins cuts at the same characters): it must be the path's first slash.
        val pathStart = rest.indexOfAny(charArrayOf('/', '?', '#', '\\'))
        if (pathStart < 0 || rest[pathStart] != '/') return false
        val path = rest.substring(pathStart).substringBefore('#').substringBefore('?')
        if ('\\' in path) return false
        val parts = path.split('/')
        if (parts.size != 5 || parts[0] != "" || parts[1] != "messages" || parts[2] != "attachments") return false
        val name = parts[4]
        return KEY.matches(parts[3]) && name.isNotEmpty() && !isDotSegment(name)
    }

    /** What a file is saved as when nothing better is known. */
    const val FALLBACK_NAME = "download"

    /** Room under the 255 bytes a file name may take, for the " (1)" Android adds when the name is taken. */
    private const val MAX_NAME_BYTES = 200

    /**
     * The name to save the file under: the server's, from [contentDisposition] (its `filename*`,
     * which holds the real name, else its plain `filename`), else the last part of [url] (the
     * server puts the name there too), made fit for a file system — no slashes or other characters
     * a phone's storage refuses, no control or direction marks, not hidden, not too long.
     * Never empty.
     */
    fun fileName(contentDisposition: String?, url: String): String {
        val params = contentDisposition?.let(::dispositionParams).orEmpty()
        val raw = params["filename*"]?.let(::extValue)
            ?: params["filename"]?.takeIf { it.isNotBlank() }
            ?: urlName(url)
        return safeName(raw.orEmpty())
    }

    /**
     * The name for a Download link the page's shim passed on: the link's own `download` attribute (the web
     * client puts the file's name there), else the last part of [url]; made safe the same way as [fileName].
     */
    fun linkName(download: String?, url: String): String =
        safeName(download?.takeIf { it.isNotBlank() } ?: urlName(url).orEmpty())

    /** The type to hand DownloadManager (it picks the app that opens the file), or null when [raw] is no type. */
    fun mimeType(raw: String?): String? =
        raw?.substringBefore(';')?.trim()?.lowercase()?.takeIf { MIME.matches(it) }

    private val MIME = Regex("^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$")

    // ---- Content-Disposition (RFC 6266) ------------------------------------------------------------

    /** The header's parameters, names lower-cased, quoted values unquoted. The first of a name wins. */
    private fun dispositionParams(header: String): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (part in splitOutsideQuotes(header).drop(1)) { // the first part is the type: attachment, inline
            val eq = part.indexOf('=')
            if (eq <= 0) continue
            val key = part.substring(0, eq).trim().lowercase()
            val value = part.substring(eq + 1).trim()
            if (key !in out) out[key] = if (value.startsWith('"')) unquote(value) else value
        }
        return out
    }

    private fun splitOutsideQuotes(s: String): List<String> {
        val parts = mutableListOf<String>()
        val current = StringBuilder()
        var quoted = false
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                quoted && c == '\\' && i + 1 < s.length -> { current.append(c).append(s[i + 1]); i++ }
                c == '"' -> { quoted = !quoted; current.append(c) }
                c == ';' && !quoted -> { parts += current.toString(); current.clear() }
                else -> current.append(c)
            }
            i++
        }
        parts += current.toString()
        return parts
    }

    /** A quoted-string's text: the quotes off, each backslash escape the character it escapes. */
    private fun unquote(value: String): String {
        val out = StringBuilder()
        var i = 1
        while (i < value.length) {
            val c = value[i]
            if (c == '"') break
            if (c == '\\' && i + 1 < value.length) { out.append(value[i + 1]); i += 2; continue }
            out.append(c)
            i++
        }
        return out.toString()
    }

    /** RFC 5987's charset'language'percent-encoded value; null when it cannot be read. */
    private fun extValue(value: String): String? {
        val parts = value.split('\'', limit = 3)
        if (parts.size != 3) return null
        val charset = when (parts[0].trim().lowercase()) {
            "utf-8" -> StandardCharsets.UTF_8
            "iso-8859-1" -> StandardCharsets.ISO_8859_1
            else -> return null
        }
        return percentDecode(parts[2], charset)?.takeIf { it.isNotBlank() }
    }

    /** The URL path's last segment, decoded; null when it is empty. */
    private fun urlName(url: String): String? {
        val last = url.substringBefore('#').substringBefore('?').substringAfterLast('/')
        if (last.isEmpty()) return null
        return percentDecode(last, StandardCharsets.UTF_8) ?: last
    }

    /**
     * %XX escapes turned back into the bytes they stand for, read in [charset]. A plus stays a plus
     * (a path, unlike a form, writes a space as %20). Null for a broken escape or bytes that are not
     * text in that charset.
     */
    private fun percentDecode(s: String, charset: Charset): String? {
        val bytes = ByteArrayOutputStream()
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '%') {
                if (i + 2 >= s.length) return null
                val hi = Character.digit(s[i + 1], 16)
                val lo = Character.digit(s[i + 2], 16)
                if (hi < 0 || lo < 0) return null
                bytes.write(hi * 16 + lo)
                i += 3
            } else {
                bytes.write(c.toString().toByteArray(charset))
                i++
            }
        }
        return try {
            charset.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(java.nio.ByteBuffer.wrap(bytes.toByteArray()))
                .toString()
        } catch (e: CharacterCodingException) {
            null
        }
    }

    // ---- a name a phone can store ------------------------------------------------------------------

    /** C0 and C1 controls, DEL, and the direction and zero-width marks that can make "gnp.exe" read as "exe.png" (the server's list). */
    private val UNSAFE = Regex("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]")

    /** What FAT storage refuses in a name, slashes included, so a name can never reach another folder. */
    private val RESERVED = Regex("[\"*/:<>?\\\\|]")

    private fun safeName(raw: String): String {
        val name = RESERVED.replace(UNSAFE.replace(raw, ""), "_")
            .trim()
            .trimStart('.') // a leading dot hides a file
            .trimEnd('.', ' ')
        if (name.isEmpty()) return FALLBACK_NAME
        return cut(name)
    }

    /** At most [MAX_NAME_BYTES] bytes of UTF-8, the extension kept, never half a character. */
    private fun cut(name: String): String {
        if (utf8(name) <= MAX_NAME_BYTES) return name
        val dot = name.lastIndexOf('.')
        val ext = if (dot > 0 && name.length - dot <= 16) name.substring(dot) else ""
        val stem = name.substring(0, name.length - ext.length)
        val budget = MAX_NAME_BYTES - utf8(ext)
        val out = StringBuilder()
        var used = 0
        var i = 0
        while (i < stem.length) {
            val cp = stem.codePointAt(i)
            val size = utf8(String(Character.toChars(cp)))
            if (used + size > budget) break
            out.appendCodePoint(cp)
            used += size
            i += Character.charCount(cp)
        }
        val kept = out.toString().trimEnd('.', ' ')
        return (kept.ifEmpty { FALLBACK_NAME }) + ext
    }

    private fun utf8(s: String): Int = s.toByteArray(StandardCharsets.UTF_8).size

    /** "." or "..", written plainly or escaped (%2e), which a browser treats as a step up the path. */
    private fun isDotSegment(segment: String): Boolean =
        segment.replace("%2e", ".", ignoreCase = true).let { it == "." || it == ".." }
}
