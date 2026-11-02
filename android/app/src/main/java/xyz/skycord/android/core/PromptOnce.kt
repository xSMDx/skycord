package xyz.skycord.android.core

/**
 * Questions the app asks the person once and never again: the notification permission, the battery
 * exemption, full-screen calls. Whatever the answer was (or whether there was one: the dialog dismissed,
 * the app killed behind it), the question is [markAsked] the moment it is put, and from then on
 * [shouldAsk] says no. The way back is Settings, not a second dialog.
 *
 * Over the app's one shared [KeyValue] (where the saved servers live too), so every key is prefixed:
 * a question can never read as asked because it is named like one of those entries.
 */
object PromptOnce {
    private const val PREFIX = "asked_"

    fun shouldAsk(key: String, store: KeyValue): Boolean = store.get(PREFIX + key) == null

    fun markAsked(key: String, store: KeyValue) = store.put(PREFIX + key, "1")
}
