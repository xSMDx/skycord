package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

class PickerTypesTest {
    private val known = mapOf("mp3" to "audio/mpeg", "flac" to "audio/flac", "m4a" to "audio/mp4")
    private val guess = { ext: String -> known[ext] }

    @Test fun mimeTypesPassThrough_extensionsAreLookedUp_unknownOnesDropped() {
        assertEquals(
            listOf("audio/*", "audio/mpeg", "audio/flac", "audio/mp4"),
            PickerTypes.mimeTypes(listOf("audio/*,.mp3,.flac,.opus,.m4a"), guess),
        )
    }

    @Test fun webViewMaySplitTheAttributeOrNot_andCaseAndSpacesDoNotMatter() {
        assertEquals(listOf("image/*", "audio/mpeg"), PickerTypes.mimeTypes(listOf(" IMAGE/* ", ".MP3", "image/*"), guess))
    }

    @Test fun nothingUsable_meansAnything() {
        assertEquals(emptyList<String>(), PickerTypes.mimeTypes(listOf(""), guess))
        assertEquals(emptyList<String>(), PickerTypes.mimeTypes(emptyList(), guess))
        assertEquals(emptyList<String>(), PickerTypes.mimeTypes(listOf("junk", ".opus"), guess))
    }
}
