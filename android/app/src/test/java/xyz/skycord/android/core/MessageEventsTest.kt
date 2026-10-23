package xyz.skycord.android.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The server's message events, as the background connection reads them: the
 * live socket's dm:receive, group:receive and channel:receive, and catch-up's
 * GET /users/me/missed. Shapes from server/controllers/messagesController.ts
 * (dmReceivePayload), chatSocket.ts (group:send), channelsController.ts and
 * missedController.ts.
 */
class MessageEventsTest {
    private val me = "aaaaaaaaaaaaaaaaaaaaaaaa"
    private val ana = "bbbbbbbbbbbbbbbbbbbbbbbb"
    private val dmConv = "${me}_$ana" // the two ids, sorted, joined by _

    private val names = object : MessageEvents.Names {
        override fun groupName(groupId: String) = if (groupId == "g1") "Weekend" else null
        override fun channelName(serverId: String, channelId: String) = if (channelId == "c1") "general" else null
        override fun serverName(serverId: String) = if (serverId == "s1") "Home" else null
    }
    private val fallbacks = MessageEvents.Fallbacks(group = "Group", channel = "channel", server = "Server")

    private fun json(s: String) = JSONObject(s)

    // ---- live ----------------------------------------------------------------------------------

    @Test fun aDmReceiveReadsAsADmFromThePartner() {
        val raw = MessageEvents.live(
            "dm",
            json("""{"_id":"m1","conversationId":"$dmConv","authorId":"$ana","authorName":"Ana","content":"hi","createdAt":"2026-10-23T10:00:00.000Z"}"""),
        )!!
        assertEquals("m1", raw.messageId)
        assertEquals(ana, raw.authorId)
        assertFalse(raw.system)
        assertEquals(1792749600000L, raw.createdAt)
        val e = MessageEvents.toIncoming(raw, me, names, fallbacks) as IncomingMessage.Dm
        assertEquals(IncomingMessage.Dm("m1", ana, ana, "Ana", "hi", false), e)
    }

    @Test fun theDmPartnerIsWhicheverIdIsNotMineInEitherOrder() {
        assertEquals(ana, MessageEvents.dmPartner("${me}_$ana", me))
        assertEquals(ana, MessageEvents.dmPartner("${ana}_$me", me))
        assertNull(MessageEvents.dmPartner("${ana}_cccccccccccccccccccccccc", me)) // not my conversation
        assertNull(MessageEvents.dmPartner(me, me))
        assertNull(MessageEvents.dmPartner("${me}_${ana}_x", me))
    }

    @Test fun aSystemLineIsMarkedSystem() {
        val raw = MessageEvents.live(
            "dm",
            json("""{"_id":"m2","conversationId":"$dmConv","kind":"system","systemType":"call","authorId":"$ana","authorName":"Ana","content":"Call ended"}"""),
        )!!
        assertTrue(raw.system)
        assertTrue((MessageEvents.toIncoming(raw, me, names, fallbacks) as IncomingMessage.Dm).system)
    }

    @Test fun aGroupMessageIsNamedFromTheDirectory() {
        val raw = MessageEvents.live("group", json("""{"_id":"m3","conversationId":"g1","authorId":"$ana","authorName":"Ana","content":"yo"}"""))!!
        assertEquals(IncomingMessage.Group("m3", "g1", "Weekend", ana, "Ana", "yo", false), MessageEvents.toIncoming(raw, me, names, fallbacks))
    }

    @Test fun anUnknownGroupGetsTheFallbackName() {
        val raw = MessageEvents.live("group", json("""{"_id":"m4","conversationId":"g9","authorId":"$ana","authorName":"Ana","content":"yo"}"""))!!
        assertEquals("Group", (MessageEvents.toIncoming(raw, me, names, fallbacks) as IncomingMessage.Group).groupName)
    }

    @Test fun aChannelMessageCarriesItsServerCategoryAndEveryone() {
        val raw = MessageEvents.live(
            "channel",
            json("""{"_id":"m5","conversationId":"c1","serverId":"s1","categoryId":"k1","kind":"channel","authorId":"$ana","authorName":"Ana","content":"@everyone up","mentionsEveryone":true}"""),
        )!!
        val e = MessageEvents.toIncoming(raw, me, names, fallbacks) as IncomingMessage.Channel
        assertEquals(IncomingMessage.Channel("m5", "c1", "general", "k1", "s1", "Home", ana, "Ana", "@everyone up", true, false), e)
    }

    @Test fun aChannelWithNoCategoryAndUnknownNamesStillReads() {
        val raw = MessageEvents.live(
            "channel",
            json("""{"_id":"m6","conversationId":"c9","serverId":"s9","categoryId":null,"authorId":"$ana","authorName":"Ana","content":"x"}"""),
        )!!
        val e = MessageEvents.toIncoming(raw, me, names, fallbacks) as IncomingMessage.Channel
        assertNull(e.categoryId)
        assertEquals("channel", e.channelName)
        assertEquals("Server", e.serverName)
        assertFalse(e.mentionsEveryone)
    }

    @Test fun aChannelMessageWithoutItsServerIsDropped() {
        assertNull(MessageEvents.live("channel", json("""{"_id":"m7","conversationId":"c1","authorId":"$ana","content":"x"}""")))
    }

    @Test fun aPayloadMissingItsEssentialsIsDropped() {
        assertNull(MessageEvents.live("dm", json("""{"conversationId":"$dmConv","authorId":"$ana","content":"x"}"""))) // no id
        assertNull(MessageEvents.live("dm", json("""{"_id":"m","authorId":"$ana","content":"x"}"""))) // no conversation
        assertNull(MessageEvents.live("dm", json("""{"_id":"m","conversationId":"$dmConv","content":"x"}"""))) // no author
        assertNull(MessageEvents.live("dm", json("""{"_id":7,"conversationId":"$dmConv","authorId":"$ana"}"""))) // id not a string
        assertNull(MessageEvents.live("voice", json("""{"_id":"m","conversationId":"x","authorId":"$ana"}"""))) // not a message kind
    }

    @Test fun missingTextAndNameReadAsEmptyNotAsTheWordNull() {
        val raw = MessageEvents.live("dm", json("""{"_id":"m8","conversationId":"$dmConv","authorId":"$ana","authorName":null,"content":null}"""))!!
        assertEquals("", raw.content)
        assertEquals("", raw.authorName)
        assertNull(raw.createdAt)
    }

    @Test fun aDmThatIsNotMineIsDropped() {
        val raw = MessageEvents.live("dm", json("""{"_id":"m9","conversationId":"${ana}_cccccccccccccccccccccccc","authorId":"$ana","content":"x"}"""))!!
        assertNull(MessageEvents.toIncoming(raw, me, names, fallbacks))
    }

    // ---- catch-up ------------------------------------------------------------------------------

    @Test fun catchUpReadsTheServersNowAndEachEvent() {
        val missed = MessageEvents.missed(
            json(
                """{"now":1792749700000,"events":[
                  {"type":"channel","_id":"m1","conversationId":"c1","authorId":"$ana","authorName":"Ana","content":"<@Me>","createdAt":"2026-10-23T10:00:30.000Z","serverId":"s1","categoryId":null,"mentionsEveryone":false},
                  {"type":"group","_id":"m2","conversationId":"g1","authorId":"$ana","authorName":"Ana","content":"b","createdAt":"2026-10-23T10:00:20.000Z"},
                  {"type":"dm","_id":"m3","conversationId":"$dmConv","authorId":"$ana","authorName":"Ana","content":"a","createdAt":"2026-10-23T10:00:10.000Z"}
                ]}""",
            ),
        )!!
        assertEquals(1792749700000L, missed.now)
        assertEquals(listOf("m1", "m2", "m3"), missed.events.map { it.messageId })
        assertEquals(listOf("channel", "group", "dm"), missed.events.map { it.kind })
        assertEquals(1792749610000L, missed.events[2].createdAt)
        val dm = MessageEvents.toIncoming(missed.events[2], me, names, fallbacks) as IncomingMessage.Dm
        assertEquals(ana, dm.partnerId)
        val channel = MessageEvents.toIncoming(missed.events[0], me, names, fallbacks) as IncomingMessage.Channel
        assertEquals("general", channel.channelName)
    }

    @Test fun catchUpSkipsAnEventItCannotReadAndKeepsTheRest() {
        val missed = MessageEvents.missed(
            json("""{"now":5,"events":[{"type":"dm","_id":"m1"},{"type":"group","_id":"m2","conversationId":"g1","authorId":"$ana","content":"b"},"junk"]}"""),
        )!!
        assertEquals(listOf("m2"), missed.events.map { it.messageId })
    }

    @Test fun catchUpWithoutANowIsNotAnAnswer() {
        assertNull(MessageEvents.missed(json("""{"events":[]}""")))
        assertNull(MessageEvents.missed(json("""{"now":"soon","events":[]}""")))
        assertNull(MessageEvents.missed(json("""{"now":-1,"events":[]}""")))
    }

    @Test fun catchUpWithNoEventsListIsAnEmptyAnswer() {
        val missed = MessageEvents.missed(json("""{"now":42}"""))!!
        assertEquals(42L, missed.now)
        assertTrue(missed.events.isEmpty())
    }
}
