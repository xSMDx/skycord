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

    fun parse(text: String): Incoming? = try {
        val o = JSONObject(text)
        when (o.optString("type")) {
            "hello" -> Incoming.Hello
            "back" -> Incoming.BackAnswer(o.getInt("id"), o.optBoolean("used", false))
            "call" -> {
                val method = o.getString("method")
                if (method.isEmpty() || method.length > MAX_METHOD) null
                else Incoming.Call(if (o.has("id")) o.getInt("id") else null, method, o.optJSONArray("args") ?: JSONArray())
            }
            else -> null
        }
    } catch (e: Exception) {
        null
    }

    fun reply(id: Int, value: Any?): String =
        JSONObject().put("type", "reply").put("id", id).put("value", value ?: JSONObject.NULL).toString()

    fun error(id: Int, message: String): String =
        JSONObject().put("type", "reply").put("id", id).put("error", message).toString()

    fun event(name: String, value: Any?): String =
        JSONObject().put("type", "event").put("name", name).put("value", value ?: JSONObject.NULL).toString()
}
