package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A message sent as files alone, in one line: the web client's previewText
 * (src/utils/attachments.ts) word for word, so a phone's notification and the
 * browser's say the same thing.
 */
class AttachmentTextTest {
    private fun photo(name: String = "IMG_1.jpg", mime: String = "image/jpeg") = Attachment("image", name, mime)
    private fun video(name: String = "clip.mp4") = Attachment("video", name, "video/mp4")
    private fun file(name: String = "notes.pdf") = Attachment("file", name, "application/pdf")

    private fun text(vararg files: Attachment) = AttachmentText.describe(AttachmentText.summarize(files.toList())!!)

    @Test fun onePhoto_isSentAPhoto() {
        assertEquals("Sent a photo", text(photo()))
        assertEquals("Sent a photo", text(photo("a.webp", "image/webp")))
    }

    @Test fun oneGif_isGif() {
        assertEquals("GIF", text(photo("party.gif", "image/gif")))
    }

    @Test fun oneVideo_isSentAVideo() {
        assertEquals("Sent a video", text(video()))
    }

    @Test fun oneFile_isCalledByItsName() {
        assertEquals("notes.pdf", text(file()))
        assertEquals("report final (2).xlsx", text(file("report final (2).xlsx")))
    }

    @Test fun several_areCounted_byTheirSharedKind() {
        assertEquals("Sent 3 photos", text(photo(), photo(), photo("b.gif", "image/gif")))
        assertEquals("Sent 2 videos", text(video(), video()))
        assertEquals("Sent 4 files", text(file(), file(), file(), file()))
    }

    @Test fun aMix_isFiles() {
        assertEquals("Sent 2 files", text(photo(), video()))
        assertEquals("Sent 3 files", text(photo(), photo(), file()))
    }

    @Test fun theSummary_takesTheFirstFilesNameAndType() {
        assertEquals(
            AttachmentSummary(count = 2, kind = "image", name = "first.png", mime = "image/png"),
            AttachmentText.summarize(listOf(photo("first.png", "image/png"), photo("second.jpg"))),
        )
    }

    @Test fun noFiles_noSummary() {
        assertNull(AttachmentText.summarize(emptyList()))
    }

    @Test fun countsAreAsciiDigits_whateverThePhonesLanguage() {
        val before = java.util.Locale.getDefault()
        try {
            java.util.Locale.setDefault(java.util.Locale.forLanguageTag("ar-EG"))
            assertEquals("Sent 12 files", AttachmentText.describe(AttachmentSummary(12, "file", "a", "")))
        } finally {
            java.util.Locale.setDefault(before)
        }
    }

    @Test fun theStringResourcesSayTheSameThing() {
        // The notification reads its words from strings.xml; this ties them to the pure defaults (the
        // web's words), so the two cannot drift apart. (Unit tests run in the module's directory.)
        val xml = java.io.File("src/main/res/values/strings.xml").readText()
        fun res(name: String) = Regex("""<string name="$name"[^>]*>(.*?)</string>""").find(xml)?.groupValues?.get(1)
        val words = AttachmentText.Words()
        assertEquals(words.photo, res("notice_sent_photo"))
        assertEquals(words.video, res("notice_sent_video"))
        assertEquals(words.gif, res("notice_gif"))
        assertEquals(words.photos, res("notice_sent_photos"))
        assertEquals(words.videos, res("notice_sent_videos"))
        assertEquals(words.files, res("notice_sent_files"))
    }

    @Test fun otherWords_areUsedAsGiven() {
        val words = AttachmentText.Words(photo = "Photo", photos = "%1\$d photos")
        assertEquals("Photo", AttachmentText.describe(AttachmentSummary(1, "image", "a.jpg", "image/jpeg"), words))
        assertEquals("5 photos", AttachmentText.describe(AttachmentSummary(5, "image", "a.jpg", "image/jpeg"), words))
    }
}
