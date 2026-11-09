package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A chat attachment's download: only the current server's own, saved under the
 * name the server gives. Shapes from server/utils/attachmentStore.ts
 * (attachmentUrl: /messages/attachments/<key>/<encodeURIComponent(name)>) and
 * server/utils/attachmentSniff.ts (contentDisposition).
 */
class AttachmentDownloadTest {
    private val server = "https://chat.example.com"
    private val key = "Qm9vbXNoYWthbGFrYTEyMw" // 22 characters of base64url, as the server makes them
    private val url = "$server/messages/attachments/$key/notes.pdf"

    // ---- whose download it is ------------------------------------------------------------------

    @Test fun theCurrentServersAttachment_isSaved() {
        assertTrue(AttachmentDownload.isAttachment(url, server))
        assertTrue(AttachmentDownload.isAttachment("$server/messages/attachments/$key/caf%C3%A9%20menu.pdf", server))
        assertTrue(AttachmentDownload.isAttachment("$url?x=1#top", server))
        assertTrue(AttachmentDownload.isAttachment("https://Chat.Example.com:443/messages/attachments/$key/notes.pdf", server))
        assertTrue(AttachmentDownload.isAttachment("http://10.0.0.5:3001/messages/attachments/a-b_c/x", "http://10.0.0.5:3001"))
    }

    @Test fun anotherOrigin_isRefused() {
        for (other in listOf(
            "https://evil.example.com/messages/attachments/$key/notes.pdf",
            "http://chat.example.com/messages/attachments/$key/notes.pdf", // http is not https
            "https://chat.example.com:8443/messages/attachments/$key/notes.pdf", // another port
            "https://chat.example.com.evil.com/messages/attachments/$key/notes.pdf",
            "https://appassets.androidplatform.net/messages/attachments/$key/notes.pdf", // the launcher
        )) assertFalse(other, AttachmentDownload.isAttachment(other, server))
    }

    @Test fun onTheLauncher_nothingIsSaved() {
        assertFalse(AttachmentDownload.isAttachment(url, null))
    }

    @Test fun whatIsNoWebAddress_isRefused() {
        for (other in listOf(
            "blob:$server/6f1c2a8e-0000-4000-8000-000000000000",
            "data:application/pdf;base64,JVBERi0=",
            "javascript:alert(1)",
            "file:///sdcard/Download/notes.pdf",
            "content://downloads/my_downloads/1",
            "",
        )) assertFalse(other, AttachmentDownload.isAttachment(other, server))
    }

    @Test fun anotherPathOnTheServer_isRefused() {
        for (path in listOf(
            "/",
            "/messages/dm/abc",
            "/messages/attachments",
            "/messages/attachments/$key",
            "/messages/attachments/$key/",
            "/messages/attachments//notes.pdf",
            "/messages/attachments/$key/notes.pdf/more",
            "/messages/attachments/a.b/notes.pdf", // not a key
            "/messages/attachments/${"k".repeat(65)}/notes.pdf",
            "/messages/attachments/$key/..",
            "/messages/attachments/$key/%2E%2e",
            "/messages/attachments/../users/me",
            "/music/tracks/1/stream",
            "/Messages/attachments/$key/notes.pdf",
        )) assertFalse(path, AttachmentDownload.isAttachment("$server$path", server))
    }

    @Test fun thePathMustStartRightAfterTheHost() {
        // A query or a backslash before the first slash: the path is not where it seems.
        assertFalse(AttachmentDownload.isAttachment("$server?/messages/attachments/$key/notes.pdf", server))
        assertFalse(AttachmentDownload.isAttachment("$server#/messages/attachments/$key/notes.pdf", server))
        assertFalse(AttachmentDownload.isAttachment("$server\\messages\\attachments\\$key\\notes.pdf", server))
        assertFalse(AttachmentDownload.isAttachment("$server/messages\\attachments/$key/notes.pdf", server))
    }

    // ---- the name it is saved under ------------------------------------------------------------

    @Test fun theServersName_isKept() {
        assertEquals("notes.pdf", AttachmentDownload.fileName("""attachment; filename="notes.pdf"; filename*=UTF-8''notes.pdf""", url))
        // Photos and videos are served inline; the large view's Download still saves them under their name.
        assertEquals("IMG_0042.JPG", AttachmentDownload.fileName("""inline; filename="IMG_0042.JPG"; filename*=UTF-8''IMG_0042.JPG""", url))
    }

    @Test fun filenameStar_carriesTheRealName_overTheAsciiFallback() {
        assertEquals(
            "café résumé.pdf",
            AttachmentDownload.fileName("""attachment; filename="caf_ r_sum_.pdf"; filename*=UTF-8''caf%C3%A9%20r%C3%A9sum%C3%A9.pdf""", url),
        )
        assertEquals("ملف.txt", AttachmentDownload.fileName("attachment; filename=\"___.txt\"; filename*=UTF-8''%D9%85%D9%84%D9%81.txt", url))
        assertEquals("café.txt", AttachmentDownload.fileName("attachment; filename*=ISO-8859-1'en'caf%E9.txt", url))
        // The server escapes ' ( ) * ! too (RFC 5987).
        assertEquals("it's (1)!.txt", AttachmentDownload.fileName("attachment; filename*=UTF-8''it%27s%20%281%29%21.txt", url))
        assertEquals("a+b.txt", AttachmentDownload.fileName("attachment; filename*=UTF-8''a+b.txt", url))
    }

    @Test fun aBrokenFilenameStar_fallsBackToFilename() {
        assertEquals("plain.txt", AttachmentDownload.fileName("""attachment; filename="plain.txt"; filename*=UTF-8''%ZZ.txt""", url))
        assertEquals("plain.txt", AttachmentDownload.fileName("""attachment; filename="plain.txt"; filename*=UTF-8''%C3""", url))
        assertEquals("plain.txt", AttachmentDownload.fileName("""attachment; filename="plain.txt"; filename*=KOI8-R''x.txt""", url))
        assertEquals("plain.txt", AttachmentDownload.fileName("""attachment; filename="plain.txt"; filename*=no-quotes.txt""", url))
    }

    @Test fun aQuotedFilename_isUnquoted() {
        assertEquals("say _hi_; ok.txt", AttachmentDownload.fileName("""attachment; filename="say \"hi\"; ok.txt"""", url))
        assertEquals("token.txt", AttachmentDownload.fileName("attachment; filename=token.txt", url))
        assertEquals("upper.txt", AttachmentDownload.fileName("""ATTACHMENT; FILENAME="upper.txt"""", url))
    }

    @Test fun withNoHeader_theNameComesFromTheUrl() {
        assertEquals("notes.pdf", AttachmentDownload.fileName(null, url))
        assertEquals("notes.pdf", AttachmentDownload.fileName("", url))
        assertEquals("notes.pdf", AttachmentDownload.fileName("attachment", url))
        assertEquals("my file+1.txt", AttachmentDownload.fileName(null, "$server/messages/attachments/$key/my%20file+1.txt?x=1#y"))
        assertEquals("café.pdf", AttachmentDownload.fileName(null, "$server/messages/attachments/$key/caf%C3%A9.pdf"))
    }

    @Test fun aNameCanNeverLeaveTheDownloadsFolder() {
        assertEquals("_.._etc_passwd", AttachmentDownload.fileName("attachment; filename*=UTF-8''..%2F..%2Fetc%2Fpasswd", url))
        assertEquals("a_b_c.txt", AttachmentDownload.fileName("""attachment; filename="a/b\\c.txt"""", url))
        assertEquals(AttachmentDownload.FALLBACK_NAME, AttachmentDownload.fileName("""attachment; filename="..."""", url))
        assertEquals(AttachmentDownload.FALLBACK_NAME, AttachmentDownload.fileName("attachment; filename*=UTF-8''..", url))
    }

    @Test fun charactersStorageRefuses_areReplaced_andControlsDropped() {
        assertEquals("what_ why_.txt", AttachmentDownload.fileName("attachment; filename*=UTF-8''what%3F%20why%2A.txt", url))
        assertEquals("a_b_c_d_e.txt", AttachmentDownload.fileName("attachment; filename*=UTF-8''a%3Ab%3Cc%3Ed%7Ce.txt", url))
        assertEquals("ab.txt", AttachmentDownload.fileName("attachment; filename*=UTF-8''a%0D%0Ab%00.txt", url))
        // A right-to-left mark that would make "gnp.exe" read as "exe.png".
        assertEquals("photognp.exe", AttachmentDownload.fileName("attachment; filename*=UTF-8''photo%E2%80%AEgnp.exe", url))
    }

    @Test fun aNameIsNeverHidden_orEndsInADot() {
        assertEquals("bashrc", AttachmentDownload.fileName("""attachment; filename=".bashrc"""", url))
        assertEquals("notes", AttachmentDownload.fileName("""attachment; filename="notes. . """", url))
    }

    @Test fun nothingUsable_isTheFallbackName() {
        assertEquals(AttachmentDownload.FALLBACK_NAME, AttachmentDownload.fileName("""attachment; filename="   """", "$server/"))
        assertEquals(AttachmentDownload.FALLBACK_NAME, AttachmentDownload.fileName(null, "$server/"))
    }

    @Test fun aLongName_isCutByBytes_keepingItsExtension_andWholeCharacters() {
        val long = "é".repeat(150) + ".pdf" // 300 bytes of stem
        val name = AttachmentDownload.fileName("attachment; filename*=UTF-8''" + "%C3%A9".repeat(150) + ".pdf", url)
        assertTrue(name.endsWith(".pdf"))
        assertTrue(name.toByteArray(Charsets.UTF_8).size <= 200)
        assertEquals("é".repeat(98) + ".pdf", name) // 196 bytes of é, then the 4-byte extension
        assertTrue(long.startsWith(name.removeSuffix(".pdf")))
        // An emoji is never cut in half.
        val emoji = AttachmentDownload.fileName("attachment; filename*=UTF-8''" + "%F0%9F%98%80".repeat(60) + ".txt", url)
        assertEquals("😀".repeat(49) + ".txt", emoji)
    }

    @Test fun aShortName_isLeftAlone() {
        val name = "a".repeat(196) + ".txt"
        assertEquals(name, AttachmentDownload.fileName("""attachment; filename="$name"""", url))
    }

    // ---- a Download link the shim passed on ----------------------------------------------------

    @Test fun aLinksOwnName_isUsed() {
        assertEquals("café menu.pdf", AttachmentDownload.linkName("café menu.pdf", "$server/messages/attachments/$key/caf%C3%A9%20menu.pdf"))
    }

    @Test fun withNoLinkName_theNameComesFromTheUrl() {
        assertEquals("caf é.pdf", AttachmentDownload.linkName(null, "$server/messages/attachments/$key/caf%20%C3%A9.pdf"))
        assertEquals("notes.pdf", AttachmentDownload.linkName("", url))
        assertEquals("notes.pdf", AttachmentDownload.linkName("   ", url))
    }

    @Test fun aLinksName_isMadeSafeLikeAnyOther() {
        assertEquals("_.._etc_passwd", AttachmentDownload.linkName("../../etc/passwd", url))
        assertEquals("photognp.exe", AttachmentDownload.linkName("photo‮gnp.exe", url))
        assertEquals(AttachmentDownload.FALLBACK_NAME, AttachmentDownload.linkName("..", url))
    }

    // ---- the type ------------------------------------------------------------------------------

    @Test fun theType_isPassedOnWithoutParameters() {
        assertEquals("application/pdf", AttachmentDownload.mimeType("application/pdf"))
        assertEquals("text/plain", AttachmentDownload.mimeType("Text/Plain; charset=utf-8"))
        assertEquals("application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            AttachmentDownload.mimeType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
    }

    @Test fun whatIsNoType_isDropped() {
        for (bad in listOf(null, "", "  ", "pdf", "application/", "/pdf", "a/b/c", "text/plain\nX-Evil: 1")) {
            assertNull(bad, AttachmentDownload.mimeType(bad))
        }
    }
}
