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
    // Room for the longest real name (androidNotifications.requestBatteryExemption is 44), and no more.
    private const val MAX_METHOD = 64
    // Far above any real message (the largest is a saved server's name and
    // icon address). The bracket count is checked before parsing: Android's JSON
    // parser is recursive, and thousands of nested brackets would overflow the
    // main thread's stack with an Error that no catch here would stop. The parsers
    // accept single quotes, comments and bare literals, so a string-aware scan
    // can be fooled; counting raw brackets cannot. Any nesting of depth d needs
    // at least d opening brackets. 256 levels is safe to recurse on any thread.
    private const val MAX_MESSAGE = 64 * 1024
    private const val MAX_OPENS = 256

    fun parse(text: String): Incoming? {
        if (text.length > MAX_MESSAGE || text.count { it == '[' || it == '{' } > MAX_OPENS) return null
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
        } catch (e: StackOverflowError) {
            null // Last line of defence; the bracket bound is the real guard.
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

    fun reply(id: Int, value: Any?): String =
        JSONObject().put("type", "reply").put("id", id).put("value", value ?: JSONObject.NULL).toString()

    fun error(id: Int, message: String): String =
        JSONObject().put("type", "reply").put("id", id).put("error", message).toString()

    fun event(name: String, value: Any?): String =
        JSONObject().put("type", "event").put("name", name).put("value", value ?: JSONObject.NULL).toString()
}
