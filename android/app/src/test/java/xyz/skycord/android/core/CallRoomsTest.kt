package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Reading a call's room name, and what a ring calls its caller. Rooms are as the
 * server names them (chatSocket.ts): `dm:<a>_<b>`, `group:<id>`, `voice:<channelId>`.
 */
class CallRoomsTest {
    private val me = "aaaaaaaaaaaaaaaaaaaaaaaa"
    private val ana = "bbbbbbbbbbbbbbbbbbbbbbbb"

    // ---- which conversation a room is --------------------------------------------------------

    @Test fun aDmRoomIsTheDmWithTheOtherPerson() {
        assertEquals(CallRooms.Target("dm", ana), CallRooms.target("dm:${me}_$ana", me))
        assertEquals(CallRooms.Target("dm", ana), CallRooms.target("dm:${ana}_$me", me))
    }

    @Test fun aDmRoomOfTwoOtherPeopleIsNotMine() = assertNull(CallRooms.target("dm:${ana}_cccccccccccccccccccccccc", me))

    @Test fun aMalformedDmRoomIsNobodys() {
        assertNull(CallRooms.target("dm:", me))
        assertNull(CallRooms.target("dm:$me", me))
        assertNull(CallRooms.target("dm:${me}_", me))
        assertNull(CallRooms.target("dm:${me}_${ana}_$me", me))
    }

    @Test fun aDmWithOneselfIsNotACall() = assertNull(CallRooms.target("dm:${me}_$me", me))

    @Test fun aGroupRoomIsTheGroup() = assertEquals(CallRooms.Target("group", "g-crew"), CallRooms.target("group:g-crew", me))

    @Test fun anEmptyGroupRoomIsNothing() = assertNull(CallRooms.target("group:", me))

    @Test fun aVoiceChannelIsNeverACallToYou() = assertNull(CallRooms.target("voice:c1", me))

    @Test fun anythingElseIsNothing() {
        assertNull(CallRooms.target("", me))
        assertNull(CallRooms.target("chan:c1", me))
    }

    @Test fun theTargetsKeyIsTheConversationsNotificationKey() {
        assertEquals("dm:$ana", CallRooms.Target("dm", ana).key)
        assertEquals("group:g-crew", CallRooms.Target("group", "g-crew").key)
    }

    // ---- what the ring calls the caller -------------------------------------------------------

    private fun label(kind: String, caller: String?, group: String?) =
        CallRooms.callerLabel(kind, caller, group, someone = "Someone", unknownGroup = "Group")

    @Test fun aDmRingsWithThePartnersName() = assertEquals("Ana", label("dm", "Ana", null))

    @Test fun aDmWhoseCallerIsUnknownIsSomeone() = assertEquals("Someone", label("dm", null, null))

    @Test fun aGroupRingsWithTheCallerAndTheGroup() = assertEquals("Ana · Crew", label("group", "Ana", "Crew"))

    @Test fun aGroupWithNoKnownCallerRingsWithTheGroupsName() = assertEquals("Crew", label("group", null, "Crew"))

    @Test fun aGroupWhoseNameIsUnknownSaysGroup() {
        assertEquals("Ana · Group", label("group", "Ana", null))
        assertEquals("Group", label("group", null, null))
    }
}
