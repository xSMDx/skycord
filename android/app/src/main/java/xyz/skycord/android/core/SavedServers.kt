package xyz.skycord.android.core

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

data class SavedServer(val origin: String, val name: String, val icon: String?) {
    fun toJson(): JSONObject =
        JSONObject().put("origin", origin).put("name", name).put("icon", icon ?: JSONObject.NULL)
}

/**
 * A string field, or null when it is missing or JSON null. Android's own
 * org.json turns a JSON null into the text "null" through optString, the
 * JVM's does not; this answers the same on both.
 */
fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else optString(key)

/**
 * The saved servers as plain data, with the rules desktop/src/servers.ts
 * applies: read back defensively, one entry per origin, a name that falls back
 * to the address, and an icon only when it is a web address.
 */
object SavedServers {
    const val MAX_NAME = 64

    fun hostOf(origin: String): String {
        val u = URI(origin)
        return if (u.port == -1) u.host else "${u.host}:${u.port}"
    }

    private fun nameFor(name: String?, origin: String): String =
        name?.trim()?.take(MAX_NAME)?.takeIf { it.isNotEmpty() } ?: hostOf(origin)

    private fun iconFor(icon: String?): String? {
        if (icon == null) return null
        val scheme = try { URI(icon).scheme?.lowercase() } catch (e: Exception) { null }
        return if (scheme == "https" || scheme == "http") icon else null
    }

    fun entry(origin: String?, name: String?, icon: String?): SavedServer? {
        val o = origin?.let { Origins.normalise(it) } ?: return null
        return SavedServer(o, nameFor(name, o), iconFor(icon))
    }

    fun read(json: String?): List<SavedServer> {
        val arr = try { JSONArray(json ?: return emptyList()) } catch (e: Exception) { return emptyList() }
        val out = mutableListOf<SavedServer>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val e = entry(o.stringOrNull("origin"), o.stringOrNull("name"), o.stringOrNull("icon")) ?: continue
            if (out.none { it.origin == e.origin }) out += e
        }
        return out
    }

    fun write(list: List<SavedServer>): String = JSONArray(list.map { it.toJson() }).toString()

    fun save(list: List<SavedServer>, e: SavedServer, keepName: Boolean = false): List<SavedServer> {
        val at = list.indexOfFirst { it.origin == e.origin }
        if (at < 0) return list + e
        val old = list[at]
        val name = if (keepName && old.name != hostOf(old.origin)) old.name else e.name
        return list.mapIndexed { i, s -> if (i == at) SavedServer(e.origin, name, e.icon ?: old.icon) else s }
    }

    fun remove(list: List<SavedServer>, origin: String): List<SavedServer> = list.filter { it.origin != origin }
}
