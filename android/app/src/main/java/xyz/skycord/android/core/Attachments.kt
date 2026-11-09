package xyz.skycord.android.core

import java.util.Locale

/**
 * One file a message carries, as far as a one-line description needs it: [kind] is "image",
 * "video" or "file" (the server's own kinds; anything else reads as "file"), [name] the file's
 * name, [mime] its type. The message events carry these in their `attachments` array.
 */
data class Attachment(val kind: String, val name: String, val mime: String) {
    companion object {
        val KINDS = setOf("image", "video", "file")
    }
}

/** A message's files in one: how many, the kind they share ("file" for a mix), and the first one's name and type. */
data class AttachmentSummary(val count: Int, val kind: String, val name: String, val mime: String)

/**
 * What a message sent as files alone is called in its notification: the web client's own words
 * (`previewText` in src/utils/attachments.ts), so the phone and the browser describe the same
 * message the same way. "Sent a photo", "GIF", "Sent a video", the file's name for one file;
 * "Sent 3 photos", "Sent 2 videos", "Sent 4 files" for several.
 */
object AttachmentText {
    /**
     * The words, as strings.xml has them (Notifier reads them there); the defaults are the web's,
     * and a test ties the two together. The plural ones take the count as `%1$d`.
     */
    data class Words(
        val photo: String = "Sent a photo",
        val video: String = "Sent a video",
        val gif: String = "GIF",
        val photos: String = "Sent %1\$d photos",
        val videos: String = "Sent %1\$d videos",
        val files: String = "Sent %1\$d files",
    )

    /** The files as one summary, the way the web's `summarize` does it; null when there are none. */
    fun summarize(files: List<Attachment>): AttachmentSummary? {
        val first = files.firstOrNull() ?: return null
        val kind = if (files.all { it.kind == first.kind }) first.kind else "file"
        return AttachmentSummary(files.size, kind, first.name, first.mime)
    }

    /** The one line for [s]. Digits are plain ASCII, as the web writes them. */
    fun describe(s: AttachmentSummary, words: Words = Words()): String =
        if (s.count == 1) {
            when (s.kind) {
                "image" -> if (s.mime == "image/gif") words.gif else words.photo
                "video" -> words.video
                else -> s.name
            }
        } else {
            val template = when (s.kind) {
                "image" -> words.photos
                "video" -> words.videos
                else -> words.files
            }
            String.format(Locale.ROOT, template, s.count)
        }
}
