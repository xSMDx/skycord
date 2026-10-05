package xyz.skycord.android.core

import org.json.JSONArray
import org.json.JSONObject

/** What the page sends. Anything that does not parse is dropped, not guessed at. */
sealed interface Incoming {
    data object Hello : Incoming
    data class BackAnswer(val id: Int, val used: Boolean) : Incoming
    data class Call(val id: Int?, val method: String, val args: JSONArray) : Incoming
}

object BridgeProtocol {
    private const val MAX_METHOD = 40
    // Far above any real message (the largest is a saved server's name and
    // icon address). Size and depth are checked before parsing: Android's JSON
    // parser is recursive, and thousands of nested brackets would overflow the
    // main thread's stack with an Error that no catch here would stop.
    private const val MAX_MESSAGE = 64 * 1024
    private const val MAX_DEPTH = 16

    fun parse(text: String): Incoming? {
        if (text.length > MAX_MESSAGE || tooDeep(text)) return null
        return try {
            val o = JSONObject(text)
            when (o.opt("type")) {
                "hello" -> Incoming.Hello
                "back" -> (o.opt("id") as? Int)?.let { Incoming.BackAnswer(it, o.opt("used") == true) }
                "call" -> call(o)
                else -> null
            }
        } catch (e: Exception) {
            null
        }
    }

    // Strict: Android's getInt/getString would turn "7" into 7 and 123 into
    // "123"; a message of the wrong shape is dropped instead.
    private fun call(o: JSONObject): Incoming.Call? {
        val method = o.opt("method") as? String ?: return null
        if (method.isEmpty() || method.length > MAX_METHOD) return null
        val id = o.opt("id")
        if (id != null && id != JSONObject.NULL && id !is Int) return null
        val args = o.opt("args")
        if (args != null && args !is JSONArray) return null
        return Incoming.Call(id as? Int, method, args as? JSONArray ?: JSONArray())
    }

    /** True when brackets nest deeper than MAX_DEPTH; brackets inside strings don't count. */
    private fun tooDeep(text: String): Boolean {
        var depth = 0
        var inString = false
        var escaped = false
        for (c in text) {
            if (inString) {
                when {
                    escaped -> escaped = false
                    c == '\\' -> escaped = true
                    c == '"' -> inString = false
                }
            } else when (c) {
                '"' -> inString = true
                '[', '{' -> if (++depth > MAX_DEPTH) return true
                ']', '}' -> depth--
            }
        }
        return false
    }

    fun reply(id: Int, value: Any?): String =
        JSONObject().put("type", "reply").put("id", id).put("value", value ?: JSONObject.NULL).toString()

    fun error(id: Int, message: String): String =
        JSONObject().put("type", "reply").put("id", id).put("error", message).toString()

    fun event(name: String, value: Any?): String =
        JSONObject().put("type", "event").put("name", name).put("value", value ?: JSONObject.NULL).toString()
}
