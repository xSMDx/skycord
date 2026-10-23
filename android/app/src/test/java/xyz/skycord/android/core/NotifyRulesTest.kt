package xyz.skycord.android.core

import java.time.ZoneOffset
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The same cases as src/composables/__tests__/notifyRules.test.ts and
 * notifyLevels.test.ts — the ones that concern classify, mentionsMe,
 * plainBody and the place rules — with the same inputs and the same answers.
 * The web test builds a whole Notice with decide(); the phone only decides
 * "does this buzz, and as what", so those cases are asserted on classify, and
 * the text of a notice on plainBody.
 */
class NotifyRulesTest {
    private val me = Me(id = "me", displayName = "Sam Doe", username = "samd")

    private fun state(
        dnd: Boolean = false,
        isMuted: (String) -> Boolean = { false },
        levelOf: (String) -> Level? = { null },
    ) = RuleState(me = me, dnd = dnd, isMuted = isMuted, levelOf = levelOf)

    private fun dm(authorId: String = "ana", content: String = "hi there", system: Boolean = false) =
        IncomingMessage.Dm(
            messageId = "m1", partnerId = "ana", authorId = authorId, authorName = "Ana",
            content = content, system = system,
        )

    private fun group(authorId: String = "ana", content: String = "yo", system: Boolean = false) =
        IncomingMessage.Group(
            messageId = "m2", groupId = "g1", groupName = "Crew", authorId = authorId, authorName = "Ana",
            content = content, system = system,
        )

    private fun channel(
        authorId: String = "ana",
        content: String = "hello",
        categoryId: String? = "k1",
        mentionsEveryone: Boolean = false,
        system: Boolean = false,
    ) = IncomingMessage.Channel(
        messageId = "m3", channelId = "c1", channelName = "general", categoryId = categoryId,
        serverId = "s1", serverName = "Home", authorId = authorId, authorName = "Ana",
        content = content, mentionsEveryone = mentionsEveryone, system = system,
    )

    /** A level for each id given; everything else is left on the default (null). */
    private fun levels(vararg set: Pair<String, Level>): (String) -> Level? = mapOf(*set)::get

    private val mention = "hey <@samd>"

    // ---- what notifies ---------------------------------------------------

    @Test fun aDmIsAMessage_evenWhenItMentionsYou() {
        assertEquals(Kind.MESSAGE, classify(dm(), state()))
        assertEquals(Kind.MESSAGE, classify(dm(content = "<@samd> hi"), state()))
    }

    @Test fun aGroupMessageIsAMessage() {
        assertEquals(Kind.MESSAGE, classify(group(), state()))
    }

    @Test fun aChannelMessageNotifiesOnlyWhenItMentionsYou() {
        assertNull(classify(channel(), state()))
        assertEquals(Kind.MENTION, classify(channel(content = "ping <@Sam Doe> look"), state()))
    }

    @Test fun aMentionReadsAsTheNameInTheNoticeBody() {
        assertEquals("ping @Sam Doe look", plainBody("ping <@Sam Doe> look"))
    }

    @Test fun everyoneCountsWhenTheServerSaysItDoes() {
        assertEquals(Kind.MENTION, classify(channel(content = "@everyone", mentionsEveryone = true), state()))
        assertNull(classify(channel(content = "@everyone", mentionsEveryone = false), state()))
    }

    // ---- what never notifies ---------------------------------------------

    @Test fun yourOwnMessageNeverNotifies() {
        assertNull(classify(dm(authorId = "me"), state()))
        assertNull(classify(group(authorId = "me"), state()))
        assertNull(classify(channel(authorId = "me", content = "<@samd>"), state()))
    }

    @Test fun aMutedConversationNeverNotifies_keyedTheWayMutesAreKeyed() {
        val muted = { key: String -> key == "ana" || key == "g1" || key == "c1" }
        assertNull(classify(dm(), state(isMuted = muted)))
        assertNull(classify(group(), state(isMuted = muted)))
        assertNull(classify(channel(content = "<@samd>"), state(isMuted = muted)))
    }

    @Test fun aDmIsMutedUnderThePartnersId_notTheAuthorsOrAnythingElse() {
        // Nothing but "ana" (the partner) is muted, and "m1" / "me" / "g1" do not matter for a DM.
        assertNull(classify(dm(), state(isMuted = { it == "ana" })))
        assertEquals(Kind.MESSAGE, classify(dm(), state(isMuted = { it == "m1" || it == "me" || it == "g1" })))
    }

    @Test fun aSystemMessageNeverNotifies() {
        assertNull(classify(dm(system = true), state()))
        assertNull(classify(group(system = true), state()))
        assertNull(classify(channel(content = "<@samd>", system = true), state()))
        assertNull(classify(channel(content = "@everyone", mentionsEveryone = true, system = true), state()))
    }

    @Test fun nothingNotifiesWhileDnd() {
        assertNull(classify(dm(), state(dnd = true)))
        assertNull(classify(group(), state(dnd = true)))
        assertNull(classify(channel(content = "<@samd>", mentionsEveryone = true), state(dnd = true)))
        // and the same events do notify the moment it is off
        assertEquals(Kind.MESSAGE, classify(dm(), state(dnd = false)))
    }

    // ---- levels and mutes on servers, categories and channels ---------------

    @Test fun allMessagesNotifiesWithoutAMention_asAMessageRatherThanAMention() {
        val s = state(levelOf = levels("s1" to Level.ALL))
        assertEquals(Kind.MESSAGE, classify(channel(), s))
        assertEquals(Kind.MENTION, classify(channel(content = mention), s))
    }

    @Test fun nothingSilencesEvenAMention() {
        assertNull(classify(channel(content = mention), state(levelOf = levels("s1" to Level.NOTHING))))
        assertNull(
            classify(
                channel(content = mention, mentionsEveryone = true),
                state(levelOf = levels("k1" to Level.NOTHING)),
            ),
        )
    }

    @Test fun onlyMentionsIsWhatAServerLeftAloneMeans() {
        assertNull(classify(channel(), state()))
        assertEquals(Kind.MENTION, classify(channel(content = mention), state()))
        assertNull(classify(channel(), state(levelOf = levels("s1" to Level.MENTIONS))))
    }

    @Test fun theNearestLevelWins_channelAllUnderAServerSetToNothingNotifies() {
        val s = state(levelOf = levels("s1" to Level.NOTHING, "c1" to Level.ALL))
        assertEquals(Kind.MESSAGE, classify(channel(), s))
    }

    @Test fun theNearestLevelWins_aCategorySetToNothingBeatsAServerSetToAll() {
        val s = state(levelOf = levels("s1" to Level.ALL, "k1" to Level.NOTHING))
        assertNull(classify(channel(content = mention), s))
    }

    @Test fun aMuteOnTheCategorySilencesTheChannel() {
        assertNull(classify(channel(content = mention), state(isMuted = { it == "k1" })))
    }

    @Test fun aMutedServerSilencesItsChannels() {
        assertNull(classify(channel(content = mention), state(isMuted = { it == "s1" })))
    }

    @Test fun aMutedChannelSilencesItself_evenOnAllMessages() {
        assertNull(classify(channel(), state(isMuted = { it == "c1" }, levelOf = levels("c1" to Level.ALL))))
    }

    @Test fun aMutedCategoryDoesNotReachAChannelThatHasNone() {
        assertEquals(
            Kind.MENTION,
            classify(channel(content = mention, categoryId = null), state(isMuted = { it == "k1" })),
        )
    }

    @Test fun anEmptyCategoryIdCountsAsNoCategory_asTheWebTreatsIt() {
        // The web reads `categoryId ? ... : ...`, and "" is falsy there.
        assertFalse(placeMuted("c1", "", "s1", state(isMuted = { it == "" })))
        assertEquals(Level.ALL, placeLevel("c1", "", "s1", state(levelOf = levels("" to Level.NOTHING, "s1" to Level.ALL))))
    }

    @Test fun classifyIsForTheMessage_whateverTheOtherSettingsDo() {
        assertEquals(Kind.MENTION, classify(channel(content = mention), state()))
        assertEquals(Kind.MESSAGE, classify(dm(), state()))
        assertNull(classify(channel(), state()))
    }

    // ---- the place rules (notifyLevels.ts) -------------------------------

    @Test fun aPlaceIsMutedWhenItsChannelItsCategoryOrItsServerIs() {
        assertFalse(placeMuted("ch", "cat", "srv", state()))
        assertTrue(placeMuted("ch", "cat", "srv", state(isMuted = { it == "ch" })))
        assertTrue(placeMuted("ch", "cat", "srv", state(isMuted = { it == "cat" })))
        assertTrue(placeMuted("ch", "cat", "srv", state(isMuted = { it == "srv" })))
    }

    @Test fun aPlaceReadsNoCategoryWhenTheChannelHasNone() {
        assertFalse(placeMuted("ch", null, "srv", state(isMuted = { it == "cat" })))
    }

    @Test fun serversDefaultToOnlyMentions() {
        assertEquals(Level.MENTIONS, SERVER_DEFAULT)
        assertEquals(Level.MENTIONS, placeLevel("ch", "cat", "srv", state()))
    }

    @Test fun theLevelIsTheNearestOneSet_channelThenCategoryThenServer() {
        assertEquals(Level.ALL, placeLevel("ch", "cat", "srv", state(levelOf = levels("srv" to Level.ALL))))
        assertEquals(
            Level.NOTHING,
            placeLevel("ch", "cat", "srv", state(levelOf = levels("srv" to Level.ALL, "cat" to Level.NOTHING))),
        )
        assertEquals(
            Level.MENTIONS,
            placeLevel(
                "ch", "cat", "srv",
                state(levelOf = levels("srv" to Level.ALL, "cat" to Level.NOTHING, "ch" to Level.MENTIONS)),
            ),
        )
    }

    @Test fun aCategoryOrChannelLeftOnTheDefaultIsSkipped() {
        // levelOf answers null for "default", so only the server's NOTHING is set here.
        assertEquals(Level.NOTHING, placeLevel("ch", "cat", "srv", state(levelOf = levels("srv" to Level.NOTHING))))
        assertEquals(
            Level.ALL,
            placeLevel("ch", null, "srv", state(levelOf = levels("srv" to Level.ALL, "cat" to Level.NOTHING))),
        )
    }

    // ---- mentionsMe ------------------------------------------------------

    @Test fun mentionsMatchTheDisplayNameOrTheUsername_inAnyCase() {
        assertTrue(mentionsMe("<@sam doe>", me))
        assertTrue(mentionsMe("<@SAMD>", me))
        assertFalse(mentionsMe("<@Samantha>", me))
        assertFalse(mentionsMe("Sam Doe without brackets", me))
    }

    @Test fun regexCharactersInANameAreLiteral() {
        val odd = Me(id = "x", displayName = "a.b+c", username = "u")
        assertTrue(mentionsMe("<@a.b+c>", odd))
        assertFalse(mentionsMe("<@aXb+c>", odd))
    }

    @Test fun aNameWithBackslashEOrQuoteDoesNotBreakTheMatch() {
        val odd = Me(id = "x", displayName = "a\\Eb", username = "\\Q")
        assertTrue(mentionsMe("<@a\\Eb>", odd))
        assertTrue(mentionsMe("<@\\Q>", odd))
        assertFalse(mentionsMe("<@ab>", odd))
    }

    @Test fun blankNamesAreIgnored_andNoNameMeansNoMention() {
        assertTrue(mentionsMe("<@samd>", Me("x", displayName = "  ", username = "samd")))
        assertFalse(mentionsMe("<@>", Me("x", displayName = "", username = "samd")))
        assertFalse(mentionsMe("<@>", Me("x", displayName = "", username = "  ")))
        assertFalse(mentionsMe("<@ >", Me("x", displayName = " ", username = "")))
    }

    @Test fun namesAreTrimmedBeforeMatching() {
        assertTrue(mentionsMe("<@Sam Doe>", Me("x", displayName = "  Sam Doe ", username = "u")))
    }

    @Test fun caseIsFoldedForNonLatinNamesToo() {
        assertTrue(mentionsMe("<@иван>", Me("x", displayName = "Иван", username = "u")))
        assertTrue(mentionsMe("<@ÉMILE>", Me("x", displayName = "Émile", username = "u")))
    }

    @Test fun aMentionMustBeTheWholeTokenInsideTheBrackets() {
        assertFalse(mentionsMe("<@samdx>", me))
        assertFalse(mentionsMe("<@xsamd>", me))
        assertFalse(mentionsMe("@samd", me))
        assertTrue(mentionsMe("a <@Sam Doe> and <@samd>", me))
    }

    // ---- plainBody -------------------------------------------------------

    @Test fun longTextIsCutToOneLine() {
        val out = plainBody("a\n\n" + "b".repeat(400))
        assertEquals(BODY_MAX, out.length)
        assertTrue(out.endsWith("…"))
        assertFalse(out.contains("\n"))
    }

    @Test fun theBodyLimitIs200() {
        assertEquals(200, BODY_MAX)
    }

    @Test fun textExactlyAtTheLimitIsNotCut() {
        assertEquals("z".repeat(200), plainBody("z".repeat(200)))
        assertEquals("z".repeat(199) + "…", plainBody("z".repeat(201)))
    }

    @Test fun aSpaceBeforeTheCutIsDroppedNotLeftBeforeTheDots() {
        assertEquals("x".repeat(198) + "…", plainBody("x".repeat(198) + " yyyy"))
    }

    @Test fun theLimitCanBeChosen() {
        assertEquals("hell…", plainBody("hello world", 5))
        assertEquals("hello", plainBody("hello", 5))
    }

    @Test fun anEmptyMessageHasNoBody() {
        assertEquals("", plainBody(""))
        assertEquals("", plainBody("   \n\t "))
    }

    @Test fun whitespaceIsCollapsedToSingleSpaces() {
        assertEquals("a b c", plainBody("  a \n\t b\r\n\r\nc  "))
    }

    @Test fun anyWhitespaceTheWebCollapsesIsCollapsedHere() {
        // JS \s: no-break space, ideographic space, line and paragraph separators, zero-width no-break space
        assertEquals("a b c d e", plainBody("a b　c d﻿e"))
    }

    @Test fun charactersJavaScriptDoesNotCallWhitespaceAreLeftAlone() {
        // Java would collapse and trim these; the web does not, so neither does the phone.
        assertEquals("a\u0085b\u001Fc᠎d", plainBody("a\u0085b\u001Fc᠎d"))
        assertEquals("\u0085x\u001F", plainBody("\u0085x\u001F"))
    }

    // ---- stripMarkers: markers become words -----------------------------

    @Test fun codeFencesAndInlineCodeKeepTheirText() {
        assertEquals("fun main() {}", stripMarkers("```fun main() {}```"))
        assertEquals("use x now", stripMarkers("use `x` now"))
        assertEquals("line1\nline2", stripMarkers("```line1\nline2```"))
    }

    @Test fun aLinkKeepsItsLabel_onlyForHttpAndHttps() {
        assertEquals("Skycord", stripMarkers("[Skycord](https://skycord.xyz)"))
        assertEquals("see Skycord ok", stripMarkers("see [Skycord](http://skycord.xyz/a?b=1) ok"))
        assertEquals("[x](ftp://a.b)", stripMarkers("[x](ftp://a.b)"))
        assertEquals("[x](https://a b)", stripMarkers("[x](https://a b)"))
    }

    @Test fun aMentionBecomesAnAtAndTheName() {
        assertEquals("@Sam Doe and @samd", stripMarkers("<@Sam Doe> and <@samd>"))
        assertEquals("<@a\nb>", stripMarkers("<@a\nb>"))
    }

    @Test fun boldUnderlineStrikeAndItalicAreRemoved() {
        assertEquals("bold and under and gone and it", stripMarkers("**bold** and __under__ and ~~gone~~ and *it*"))
    }

    @Test fun anUnderscoreItalicNeedsASpaceOrEdgeOutside_soSnakeCaseSurvives() {
        assertEquals("an italic word", stripMarkers("an _italic_ word"))
        assertEquals("italic first", stripMarkers("_italic_ first"))
        assertEquals("snake_case_name stays", stripMarkers("snake_case_name stays"))
    }

    @Test fun onlyAsciiLettersAndDigitsCountAsPartOfAWord_forAnUnderscoreItalic() {
        // JavaScript's \w is ASCII, so an accented letter beside the underscores is a boundary.
        assertEquals("éxé", stripMarkers("é_x_é"))
        assertEquals("a_x_b", stripMarkers("a_x_b"))
        assertEquals("1_x_2", stripMarkers("1_x_2"))
    }

    @Test fun aMarkerDoesNotSpanLines() {
        assertEquals("**a\nb**", stripMarkers("**a\nb**"))
    }

    @Test fun aQuoteLosesItsArrow() {
        assertEquals("quoted\nmore", stripMarkers("> quoted\n> more"))
        assertEquals("not > a quote", stripMarkers("not > a quote"))
        assertEquals("quoted more", plainBody("> quoted\n> more"))
    }

    @Test fun anArrowOnlyCountsAtTheStartOfALine_andEatsOneSpaceOrLineBreakAfterIt() {
        // The web's /^>\s?/gm: the optional \s can be the line break itself.
        assertEquals("a\nb", stripMarkers("a\n>b"))
        assertEquals("a\nb", stripMarkers("a\n>\nb"))
    }

    @Test fun markersInsideACodeFenceAreStillStripped_theWebOrderOfSteps() {
        assertEquals("x", stripMarkers("```**x**```"))
    }

    @Test fun textWithNoMarkersComesBackTrimmed() {
        assertEquals("plain text", stripMarkers("  plain text \n"))
    }

    // ---- stripMarkers: time tokens -----------------------------------------

    // 1700000000 is 2023-11-14 22:13:20 UTC.
    private val token = 1_700_000_000L
    private fun utcEnglish(nowMs: Long = token * 1000) = TimeFormat(Locale.US, ZoneOffset.UTC) { nowMs }

    @Test fun aTimeTokenBecomesTheTimeInThePhonesOwnZone() {
        assertTrue(Regex("^10:13\\p{Zs}PM$").matches(stripMarkers("<t:$token:t>", utcEnglish())))
        assertTrue(Regex("^10:13:20\\p{Zs}PM$").matches(stripMarkers("<t:$token:T>", utcEnglish())))
        assertEquals("11/14/2023", stripMarkers("<t:$token:d>", utcEnglish()))
        assertEquals("November 14, 2023", stripMarkers("<t:$token:D>", utcEnglish()))
        assertTrue(stripMarkers("<t:$token:f>", utcEnglish()).startsWith("November 14, 2023"))
        assertTrue(stripMarkers("<t:$token:f>", utcEnglish()).contains("10:13"))
        assertTrue(stripMarkers("<t:$token:F>", utcEnglish()).startsWith("Tuesday, November 14, 2023"))
    }

    @Test fun theZoneDecidesTheClock() {
        val tokyo = TimeFormat(Locale.US, ZoneOffset.ofHours(9)) { token * 1000 }
        assertEquals("11/15/2023", stripMarkers("<t:$token:d>", tokyo))
    }

    @Test fun aTimeTokenSitsInsideTheText() {
        assertEquals("meet November 14, 2023 ok", stripMarkers("meet <t:$token:D> ok", utcEnglish()))
    }

    @Test fun aRelativeTimeTokenReadsAsWords() {
        fun rel(deltaMs: Long) = stripMarkers("<t:$token:R>", utcEnglish(token * 1000 + deltaMs))
        val min = 60_000L
        val hour = 60 * min
        val day = 24 * hour
        assertEquals("now", rel(0))
        assertEquals("in 5 seconds", rel(-5_000))
        assertEquals("5 seconds ago", rel(5_000))
        assertEquals("in 1 minute", rel(-min))
        assertEquals("2 minutes ago", rel(2 * min))
        assertEquals("3 hours ago", rel(3 * hour))
        assertEquals("yesterday", rel(day))
        assertEquals("tomorrow", rel(-day))
        assertEquals("2 days ago", rel(2 * day))
        assertEquals("last week", rel(7 * day))
        assertEquals("in 2 weeks", rel(-14 * day))
        assertEquals("4 weeks ago", rel(30 * day))
        assertEquals("last month", rel(31 * day))
        assertEquals("12 months ago", rel(365 * day))
        assertEquals("last year", rel(366 * day))
        assertEquals("in 3 years", rel(-3 * 365 * day))
    }

    @Test fun aTimeTokenThatIsNotADateDisappears_asOnTheWeb() {
        assertEquals("a  b", stripMarkers("a <t:99999999999999999999:t> b", utcEnglish()))
        assertEquals("a  b", stripMarkers("a <t:9000000000000:t> b", utcEnglish()))
    }

    @Test fun aTokenWithAnUnknownStyleIsLeftAlone() {
        assertEquals("<t:$token:x>", stripMarkers("<t:$token:x>", utcEnglish()))
    }

    @Test fun aTokenOfNonAsciiDigitsIsLeftAlone() {
        assertEquals("<t:١٧٠٠:t>", stripMarkers("<t:١٧٠٠:t>", utcEnglish()))
    }

    // ---- very long messages ---------------------------------------------

    @Test fun aHugeMessageDoesNotBlowTheStack() {
        val words = "word ".repeat(100_000)
        assertEquals(200, plainBody(words).length)
        val unclosed = "**" + "x".repeat(300_000)
        assertEquals(200, plainBody(unclosed).length)
        val links = "[x](https://a.b) `c` _d_ ".repeat(20_000)
        assertTrue(plainBody(links).startsWith("x c d x c d"))
        val fence = "```" + "y".repeat(300_000)
        assertEquals(200, plainBody(fence).length)
    }
}
