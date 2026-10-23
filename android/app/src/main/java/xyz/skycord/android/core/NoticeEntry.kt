package xyz.skycord.android.core

/**
 * Who may tell the app to open a conversation or join a call.
 *
 * MainActivity is exported (it is the launcher), so any app on the phone can start it with the
 * open/join extras filled in and, with a saved server's origin, make Skycord start a call with the
 * microphone live or switch servers. The app's own notifications, rings and Answer buttons
 * therefore enter through a second door: an activity-alias, [ALIAS], that is not exported, so no
 * other app can address it. MainActivity honours the extras only for an intent that came through
 * that alias, and starts normally for any other.
 */
object NoticeEntry {
    /** The activity-alias in AndroidManifest.xml (".NoticeEntry", in the app's package). */
    const val ALIAS = "xyz.skycord.android.NoticeEntry"

    /** Whether an intent addressed to the component class [className] may carry open/join extras. */
    fun honours(className: String?): Boolean = className == ALIAS
}
