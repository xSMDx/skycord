package xyz.skycord.android

import android.content.Context
import xyz.skycord.android.core.KeyValue

class PrefsKeyValue(context: Context) : KeyValue {
    private val prefs = context.getSharedPreferences("skycord", Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    override fun put(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
}
