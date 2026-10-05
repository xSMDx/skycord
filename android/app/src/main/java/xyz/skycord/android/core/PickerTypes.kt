package xyz.skycord.android.core

/**
 * An `<input accept>` as MIME types for Android's picker. WebView hands the
 * attribute over either whole ("audio/mpeg,.flac") or split; extensions such as
 * .flac are looked up, because Android's picker filters by type only. An
 * empty answer means any file.
 */
object PickerTypes {
    fun mimeTypes(accept: List<String>, mimeForExtension: (String) -> String?): List<String> =
        accept.asSequence()
            .flatMap { it.split(',') }
            .map { it.trim().lowercase() }
            .mapNotNull { entry ->
                when {
                    entry.startsWith('.') && entry.length > 1 -> mimeForExtension(entry.drop(1))
                    entry.contains('/') -> entry
                    else -> null
                }
            }
            .distinct()
            .toList()
}
