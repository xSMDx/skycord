package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What a notification calls things, and where a reply to it goes. The titles are
 * the web client's own notice titles (notifyRules.ts `decide`), word for word,
 * so the phone and the desktop name a conversation the same way.
 */
class NoticeTextTest {
    private fun dm(content: String = "hi there") = IncomingMessage.Dm(
        messageId = "m1", partnerId = "u-ana", authorId = "u-ana", authorName = "Ana",
        content = content, system = false,
    )

    private fun group() = IncomingMessage.Group(
        messageId = "m2", groupId = "g-crew", groupName = "Crew", authorId = "u-ana", authorName = "Ana",
        content = "yo", system = false,
    )

    private fun channel(serverId: String = "s-home") = IncomingMessage.Channel(
        messageId = "m3", channelId = "c-general", channelName = "general", categoryId = null,
        serverId = serverId, serverName = "Home", authorId = "u-ana", authorName = "Ana",
        content = "hello", mentionsEveryone = false, system = false,
    )

    // ---- the title of one message ------------------------------------------------

    @Test fun aDmIsTitledByItsAuthor() = assertEquals("Ana", NoticeText.title(dm()))

    @Test fun aGroupMessageIsTitledByAuthorAndGroup() = assertEquals("Ana · Crew", NoticeText.title(group()))

    @Test fun aChannelMessageIsTitledByAuthorChannelAndServer() =
        assertEquals("Ana · #general · Home", NoticeText.title(channel()))

    // ---- the title of the conversation ---------------------------------------------

    @Test fun aDmConversationIsTitledByTheOtherPerson() = assertEquals("Ana", NoticeText.conversationTitle(dm()))

    @Test fun aGroupConversationIsTitledByTheGroup() = assertEquals("Crew", NoticeText.conversationTitle(group()))

    @Test fun aChannelConversationIsTitledByChannelAndServer() =
        assertEquals("#general · Home", NoticeText.conversationTitle(channel()))

    // ---- the key: one notification per conversation -----------------------------------

    @Test fun aDmIsKeyedByThePartner() = assertEquals("dm:u-ana", NoticeText.convKey(dm()))

    @Test fun aGroupIsKeyedByItsId() = assertEquals("group:g-crew", NoticeText.convKey(group()))

    @Test fun aChannelIsKeyedByItsId() = assertEquals("channel:c-general", NoticeText.convKey(channel()))

    @Test fun twoMessagesInOneConversationShareAKey() {
        val a = dm("one")
        val b = dm("two").copy(messageId = "m9")
        assertEquals(NoticeText.convKey(a), NoticeText.convKey(b))
    }

    // ---- the conversation as the page and the server name it ------------------------------

    @Test fun aDmIsNamedByKindAndPartner() = assertEquals(ConvRef("dm", "u-ana"), NoticeText.ref(dm()))

    @Test fun aGroupIsNamedByKindAndId() = assertEquals(ConvRef("group", "g-crew"), NoticeText.ref(group()))

    @Test fun aChannelCarriesItsServerToo() =
        assertEquals(ConvRef("channel", "c-general", "s-home"), NoticeText.ref(channel()))

    @Test fun theRefsKeyIsTheConvKey() {
        for (e in listOf(dm(), group(), channel())) assertEquals(NoticeText.convKey(e), NoticeText.ref(e).key)
    }

    // ---- where a reply goes (the spec's three routes) ----------------------------------------

    @Test fun aDmReplyGoesToTheDmRoute() = assertEquals("/messages/dm/u-ana", NoticeText.replyPath(NoticeText.ref(dm())))

    @Test fun aGroupReplyGoesToTheGroupRoute() =
        assertEquals("/conversations/groups/g-crew/messages", NoticeText.replyPath(NoticeText.ref(group())))

    @Test fun aChannelReplyGoesToTheChannelRoute() =
        assertEquals("/servers/s-home/channels/c-general/messages", NoticeText.replyPath(NoticeText.ref(channel())))

    @Test fun aChannelWithoutItsServerHasNowhereToGo() {
        assertNull(NoticeText.replyPath(ConvRef("channel", "c-general", null)))
        assertNull(NoticeText.replyPath(ConvRef("channel", "c-general", "")))
    }

    @Test fun anUnknownKindHasNowhereToGo() = assertNull(NoticeText.replyPath(ConvRef("voice", "x")))

    @Test fun anIdIsOneSegmentOfThePath_neverMore() {
        assertEquals("/messages/dm/a%2Fb%3Fc", NoticeText.replyPath(ConvRef("dm", "a/b?c")))
        assertEquals("/messages/dm/..%2Fx", NoticeText.replyPath(ConvRef("dm", "../x")))
        assertEquals("/messages/dm/a%20b", NoticeText.replyPath(ConvRef("dm", "a b")))
    }

    // ---- the text of a message ----------------------------------------------------------------

    @Test fun theBodyIsThePlainText() = assertEquals("hello @Sam", NoticeText.body("**hello** <@Sam>", "New message"))

    @Test fun aMessageWithNoTextSaysSoInsteadOfShowingNothing() {
        assertEquals("New message", NoticeText.body("", "New message"))
        assertEquals("New message", NoticeText.body("  \n ", "New message"))
        assertEquals("New message", NoticeText.body("``` ```", "New message"))
    }

    // ---- who said it ----------------------------------------------------------------------------

    @Test fun theAuthorIsTheSameWhereverTheMessageCameFrom() {
        for (e in listOf(dm(), group(), channel())) assertEquals("Ana", NoticeText.authorName(e))
    }
}
