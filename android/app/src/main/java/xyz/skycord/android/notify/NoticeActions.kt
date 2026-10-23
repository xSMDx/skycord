package xyz.skycord.android.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.RemoteInput
import org.json.JSONObject
import xyz.skycord.android.PrefsKeyValue
import xyz.skycord.android.core.NoticeText
import xyz.skycord.android.core.ServerStore
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * What a message notification's buttons do. Not exported: only the notification's own
 * PendingIntents reach it.
 *
 *  - **Dismissed** (swiped away): the person has dealt with the conversation, so its
 *    next message alerts again. Passed to [NotifyHub], which does nothing when the
 *    background service is not running.
 *  - **Reply** (typed into the notification's reply field): sent to the server as the
 *    person; on success "You: …" joins the notification and the conversation re-arms;
 *    on failure the notification says it could not send. Either way the notification
 *    is updated, because Android shows a spinner on it until the app does.
 *
 * A reply is network work, so it runs off the main thread, with the broadcast held
 * open (goAsync) until it is done. A broadcast started by a PendingIntent is a
 * background one, which Android lets run for a minute; the work here is bounded by the
 * timeouts of the token request and of the send, a few seconds each.
 *
 * Nothing here logs the token, the cookie, or what anyone wrote.
 */
class NoticeActions : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_DISMISSED -> intent.getStringExtra(EXTRA_CONV_KEY)?.let(NotifyHub::rearm)
            ACTION_REPLY -> reply(context, intent)
        }
    }

    private fun reply(context: Context, intent: Intent) {
        val conv = Conv.from(intent) ?: return
        val typed = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(KEY_REPLY)?.toString()?.trim().orEmpty()
        val app = context.applicationContext
        val pending = goAsync()
        thread(name = "notice-reply") {
            try {
                answer(app, conv, typed)
            } catch (e: Exception) {
                // The class name only: a message can quote part of what was being sent.
                Log.w(TAG, "a reply went wrong: ${e.javaClass.simpleName}")
                // Last try at ending the spinner; if even that fails there is nothing more to do.
                try { Notifier(app).replyFailed(conv) } catch (_: Exception) {}
            } finally {
                pending.finish()
            }
        }
    }

    private fun answer(app: Context, conv: Conv, text: String) {
        val notifier = Notifier(app)
        // Nothing typed: nothing to send, but the spinner still has to stop.
        if (text.isEmpty()) { notifier.settle(conv); return }
        if (send(app, conv, text)) {
            // First the gate, then the screen: if the update fails, the next message still alerts.
            NotifyHub.rearm(conv.key)
            notifier.appendReply(conv, text)
        } else {
            notifier.replyFailed(conv)
        }
    }

    /** POSTs the reply to the conversation's route with the person's own token. True only if the server took it. */
    private fun send(app: Context, conv: Conv, text: String): Boolean {
        // Only to a server the person saved: the token goes nowhere else, whatever an intent says.
        if (ServerStore(PrefsKeyValue(app)).find(conv.origin) == null) return false
        val path = NoticeText.replyPath(conv.ref) ?: return false
        val token = when (val auth = SessionAuth(app).accessToken(conv.origin)) {
            is AuthResult.Token -> auth.value
            // The service learns of a sign-in that has ended on its own; this reply just says it could not go.
            AuthResult.SignedOut, AuthResult.Unreachable -> return false
        }

        var conn: HttpURLConnection? = null
        return try {
            conn = URL(conv.origin + path).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            // A redirect is not the server answering, and following one would carry the token elsewhere.
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("Accept", "application/json")
            val body = JSONObject().put("content", text).toString().toByteArray(Charsets.UTF_8)
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(body.size)
            conn.outputStream.use { it.write(body) }
            val status = conn.responseCode
            if (status !in 200..299) Log.w(TAG, "the server answered $status to a reply")
            status in 200..299
        } catch (e: Exception) {
            Log.w(TAG, "couldn’t send a reply: ${e.javaClass.simpleName}")
            false
        } finally {
            conn?.disconnect()
        }
    }

    companion object {
        const val ACTION_REPLY = "xyz.skycord.android.action.NOTICE_REPLY"
        const val ACTION_DISMISSED = "xyz.skycord.android.action.NOTICE_DISMISSED"

        /** The RemoteInput key the reply field's text comes back under. */
        const val KEY_REPLY = "reply"

        /** The conversation's key ("dm:…", "group:…", "channel:…") on the reply and dismiss intents. */
        const val EXTRA_CONV_KEY = "xyz.skycord.android.extra.CONV_KEY"

        private const val TAG = "NoticeActions"
        private const val TIMEOUT_MS = 5000
    }
}
