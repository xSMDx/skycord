package xyz.skycord.android.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import xyz.skycord.android.MainActivity
import xyz.skycord.android.R
import xyz.skycord.android.core.Alert
import xyz.skycord.android.core.ConvLines
import xyz.skycord.android.core.ConvRef
import xyz.skycord.android.core.IncomingMessage
import xyz.skycord.android.core.Kind
import xyz.skycord.android.core.NoticeText
import xyz.skycord.android.core.freshLines

/**
 * What a notification's buttons need to know about their conversation, carried in
 * the extras of the tap, reply and dismiss intents: the server it came from
 * ([origin]), the conversation ([ref]) and its title, so that a reply can be sent,
 * and shown, even if the notification has since gone.
 */
internal data class Conv(val origin: String, val ref: ConvRef, val title: String) {
    val key: String get() = ref.key

    fun putInto(intent: Intent): Intent = intent
        .putExtra(NoticeActions.EXTRA_CONV_KEY, key)
        .putExtra(EXTRA_ORIGIN, origin)
        .putExtra(EXTRA_KIND, ref.kind)
        .putExtra(EXTRA_ID, ref.id)
        .putExtra(EXTRA_SERVER_ID, ref.serverId)
        .putExtra(EXTRA_TITLE, title)

    companion object {
        private const val EXTRA_ORIGIN = "xyz.skycord.android.extra.CONV_ORIGIN"
        private const val EXTRA_KIND = "xyz.skycord.android.extra.CONV_KIND"
        private const val EXTRA_ID = "xyz.skycord.android.extra.CONV_ID"
        private const val EXTRA_SERVER_ID = "xyz.skycord.android.extra.CONV_SERVER_ID"
        private const val EXTRA_TITLE = "xyz.skycord.android.extra.CONV_TITLE"

        /** The conversation an intent from [putInto] names, or null when it lacks the essentials. */
        fun from(intent: Intent): Conv? {
            val origin = intent.getStringExtra(EXTRA_ORIGIN)?.takeIf { it.isNotEmpty() } ?: return null
            val kind = intent.getStringExtra(EXTRA_KIND)?.takeIf { it.isNotEmpty() } ?: return null
            val id = intent.getStringExtra(EXTRA_ID)?.takeIf { it.isNotEmpty() } ?: return null
            return Conv(
                origin = origin,
                ref = ConvRef(kind, id, intent.getStringExtra(EXTRA_SERVER_ID)),
                title = intent.getStringExtra(EXTRA_TITLE).orEmpty(),
            )
        }
    }
}

/**
 * One message that passed the rules, on its way into its conversation's notification:
 * the event, what it is for the person ([kind]), and when it was sent ([at]).
 */
internal class Note(val e: IncomingMessage, val kind: Kind, val at: Long)

/**
 * One line of a conversation's notification. A null [sender] is the person themself (a reply). The [id] is
 * the message's, kept in the notification itself (the line's extras) so that a notification a killed process
 * left behind can still tell which messages it already has; a reply has none.
 */
private class Line(val text: String, val at: Long, val sender: Person?, val id: String? = null)

/**
 * The phone's notifications: one per conversation, updated as messages arrive,
 * with a reply field. The background service hands each message that passed the
 * rules to [post] (or, for a catch-up, a conversation's several to [postAll], once);
 * nothing here decides whether a message deserves one.
 *
 *  - **One per conversation.** Each is posted under its conversation key as the tag
 *    (never a hash, so two conversations cannot share one) and [NOTICE_ID]. A new
 *    message is added to the lines the conversation already holds. Those are kept
 *    here, in memory, last 25 ([ConvLines]), not read back from Android's list of what
 *    is showing: `notify()` is asynchronous and Android sheds updates posted too fast,
 *    so a burst read a stale list and lost lines. They are forgotten when the
 *    notification goes ([clear], [clearAll], [signedOut], [forget] on a swipe). A
 *    notification left over from before the process began is taken over once, from
 *    Android's list; one gone without a word (a tap) is noticed on the next post after
 *    a few seconds, by asking Android once.
 *  - **Alerts.** A [Alert.LOUD] post lets the channel make its sound. A
 *    [Alert.SILENT] post updates quietly (`setOnlyAlertOnce`); and when there is
 *    nothing showing to update, as with catch-up, it is also marked silent, because
 *    only-alert-once cannot silence a notification that is new.
 *  - **PendingIntents.** The reply action's is mutable, as Android requires for a
 *    RemoteInput to fill it in; the tap and the dismiss are immutable. Every one is
 *    explicit, and made distinct per conversation by its request code and a data
 *    URI (PendingIntents ignore extras when deciding whether two are the same).
 *
 * Ids 1001 and up are this class's; the service's own notification must use another.
 */
class Notifier(context: Context) {
    private val app = context.applicationContext
    private val nm: NotificationManager = app.getSystemService(NotificationManager::class.java)

    /** Creates the three channels. Safe to repeat; Android keeps what the person changed. */
    fun ensureChannels() {
        val messages = NotificationChannel(CHANNEL_MESSAGES, app.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_HIGH)
            .apply {
                description = app.getString(R.string.channel_messages_description)
                setShowBadge(true)
            }
        val calls = NotificationChannel(CHANNEL_CALLS, app.getString(R.string.channel_calls), NotificationManager.IMPORTANCE_HIGH)
            .apply {
                description = app.getString(R.string.channel_calls_description)
                setSound(
                    Settings.System.DEFAULT_RINGTONE_URI,
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                enableVibration(true)
                setShowBadge(false)
            }
        val connection = NotificationChannel(CHANNEL_CONNECTION, app.getString(R.string.channel_connection), NotificationManager.IMPORTANCE_MIN)
            .apply {
                description = app.getString(R.string.channel_connection_description)
                setShowBadge(false)
            }
        nm.createNotificationChannels(listOf(messages, calls, connection))
        channelsMade = true
    }

    /**
     * A message that passed the rules. Added to its conversation's notification, or
     * the start of a new one. [origin] is the server it came from; [at] is when the
     * message was sent (the live moment by default; catch-up passes the real one).
     */
    fun post(e: IncomingMessage, kind: Kind, alert: Alert, origin: String, at: Long = System.currentTimeMillis()) {
        postAll(listOf(Note(e, kind, at)), alert, origin)
    }

    /**
     * Several messages of one conversation (a catch-up's), oldest first, as one post: the conversation's
     * notification gets all their lines at once and is posted a single time, so nothing depends on how
     * fast Android takes updates. All [notes] must be for the same conversation; the title and the time
     * are the newest's, and a mention in any of them marks the notification.
     */
    internal fun postAll(notes: List<Note>, alert: Alert, origin: String) {
        val newest = notes.lastOrNull() ?: return
        val conv = Conv(origin, NoticeText.ref(newest.e), NoticeText.conversationTitle(newest.e))
        val noText = app.getString(R.string.notice_no_text)
        val added = notes.map { n ->
            val sender = Person.Builder().setName(NoticeText.authorName(n.e)).setKey("user:${n.e.authorId}").build()
            Line(NoticeText.body(n.e.content, noText), n.at, sender, n.e.messageId.takeIf { it.isNotBlank() })
        }
        publish(
            conv, headline = NoticeText.title(newest.e), mentions = notes.any { it.kind == Kind.MENTION },
            loud = alert == Alert.LOUD, at = newest.at, create = true, added = added,
        )
    }

    /** Your reply went through: "You: …" joins the conversation, quietly. Nothing to do if the notice has gone. */
    internal fun appendReply(conv: Conv, text: String, at: Long = System.currentTimeMillis()) {
        publish(conv, headline = conv.title, mentions = false, loud = false, at = at, create = false, added = listOf(Line(text, at, null)))
    }

    /**
     * Your reply did not go: the notification says so, even if it was swiped away meanwhile. The
     * conversation's own lines and title stay as they are: a failure posted as a line from a "Skycord"
     * sender made a one-to-one conversation's collapsed header read "Skycord". It goes in the sub-text and
     * the content text instead, for this post only.
     */
    internal fun replyFailed(conv: Conv, at: Long = System.currentTimeMillis()) {
        publish(
            conv, headline = conv.title, mentions = false, loud = false, at = at, create = true, added = emptyList(),
            failure = app.getString(R.string.notice_send_failed),
        )
    }

    /**
     * Posts the notification again as it is. Android shows a spinner on a notification
     * once something is typed into its reply field, until the app updates it; this ends
     * it when there is nothing to say.
     */
    internal fun settle(conv: Conv) {
        publish(conv, headline = conv.title, mentions = false, loud = false, at = System.currentTimeMillis(), create = false, added = emptyList())
    }

    /**
     * A call nobody answered: "Missed call from Sam" on the Messages channel, one per
     * conversation, until it is tapped (which opens that conversation, like any message
     * notification's tap) or dismissed. [text] is the whole title ([NoticeText.missedCallText]).
     */
    internal fun missedCall(conv: Conv, text: String, at: Long = System.currentTimeMillis()) {
        ensureChannelsOnce()
        val notice = NotificationCompat.Builder(app, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(app, R.color.accent))
            .setContentTitle(text)
            .setCategory(CATEGORY_MISSED_CALL)
            .setAutoCancel(true)
            .setWhen(at)
            .setShowWhen(true)
            .setContentIntent(tapIntent(conv))
            .build()
        nm.notify(missedTag(conv.key), MISSED_ID, notice)
    }

    /** Removes one conversation's notification and its lines, and the missed call it holds. */
    fun clear(convKey: String) = synchronized(LOCK) {
        lines.clear(convKey)
        nm.cancel(convKey, NOTICE_ID)
        nm.cancel(missedTag(convKey), MISSED_ID)
    }

    /**
     * The conversation's notification was swiped away (Android has already removed it): its lines go
     * with it, so the next message starts a new one.
     */
    internal fun forget(convKey: String) = synchronized(LOCK) {
        lines.clear(convKey)
    }

    /** Removes every message and missed-call notification (not the service's own, nor a signed-out notice), and every line. */
    fun clearAll() = synchronized(LOCK) {
        lines.clearAll()
        for (n in nm.activeNotifications) if (n.id == NOTICE_ID || n.id == MISSED_ID) nm.cancel(n.tag, n.id)
    }

    /**
     * The person is signed out, so the connection is over: the message notifications
     * (their replies would fail) give way to one quiet notice that opens the app.
     */
    fun signedOut() {
        clearAll()
        ensureChannelsOnce()
        val tap = PendingIntent.getActivity(
            app, SIGNED_OUT_ID, Intent(app, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notice = NotificationCompat.Builder(app, CHANNEL_CONNECTION)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(app, R.color.accent))
            .setContentTitle(app.getString(R.string.app_name))
            .setContentText(app.getString(R.string.notice_signed_out))
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tap)
            .build()
        nm.notify(SIGNED_OUT_ID, notice)
    }

    /** The person signed in again: the signed-out notice has nothing left to say. */
    fun clearSignedOut() {
        nm.cancel(SIGNED_OUT_ID)
    }

    // ---- building and posting ------------------------------------------------------------------

    /**
     * Adds [added] (oldest first) to the lines [conv]'s notification holds and posts the result. With
     * nothing held it starts a fresh one, unless [create] is false. One at a time: two posts for the
     * same conversation must not both start from the old lines. A [failure] is shown for this post only
     * (sub-text and content text), never kept as a line.
     */
    private fun publish(
        conv: Conv,
        headline: String,
        mentions: Boolean,
        loud: Boolean,
        at: Long,
        create: Boolean,
        added: List<Line>,
        failure: String? = null,
    ) = synchronized(LOCK) {
        ensureChannelsOnce()
        val key = conv.key
        val now = SystemClock.elapsedRealtime()
        when {
            // Not touched since this process began: a notification from before it may be showing.
            !lines.tracked(key) -> takeOver(key, now)
            // Held for a while without a post: it may have gone without telling us (a tap), so ask Android.
            lines.stale(key, now) && showing(key) == null -> lines.clear(key)
        }
        val before = lines.held(key)
        if (before == null && !create) return@synchronized
        // A message the notification already holds is not added again: after a process kill the notification is
        // still showing, and the catch-up that follows lists messages that are in it. If that leaves nothing,
        // there is nothing to say (and nothing to buzz about).
        val fresh = freshLines(before?.lines.orEmpty(), added) { it.id }
        if (added.isNotEmpty() && fresh.isEmpty()) return@synchronized

        val style = NotificationCompat.MessagingStyle(Person.Builder().setName(app.getString(R.string.notice_you)).build())
        // A DM is between two people and needs no title; a group or a channel is named.
        if (conv.ref.kind != "dm") {
            style.conversationTitle = conv.title
            style.isGroupConversation = true
        }
        // Once a mention is in the notification it stays marked, even as plain messages join it.
        val held = lines.append(key, fresh, mentions, now)
        for (l in held.lines) {
            val message = NotificationCompat.MessagingStyle.Message(l.text, l.at, l.sender ?: style.user)
            l.id?.let { message.extras.putString(EXTRA_MESSAGE_ID, it) }
            style.addMessage(message)
        }
        val mentioned = held.mentioned
        val builder = NotificationCompat.Builder(app, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(app, R.color.accent))
            .setContentTitle(headline)
            .setStyle(style)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setWhen(at)
            .setShowWhen(true)
            .setOnlyAlertOnce(!loud)
            .setContentIntent(tapIntent(conv))
            .setDeleteIntent(dismissIntent(conv))
            .addAction(replyAction(conv))
            .addExtras(Bundle().apply { putBoolean(EXTRA_MENTIONED, mentioned) })
        if (mentioned) builder.setSubText(app.getString(R.string.notice_mentioned))
        if (failure != null) {
            // Nothing held (swiped away meanwhile) leaves a MessagingStyle with nothing to show, so the
            // failure is its one line, the person's own so that it never becomes the header's name. Not kept.
            if (held.lines.isEmpty()) style.addMessage(failure, at, style.user)
            builder.setSubText(failure).setContentText(failure)
        }
        // Only-alert-once keeps an update quiet, but a notification that is new (catch-up, or one
        // swiped away a moment ago) alerts all the same. Silent covers that case.
        if (!loud && before == null) builder.setSilent(true)
        nm.notify(key, NOTICE_ID, builder.build())
    }

    /**
     * A notification for [key] that was showing before this process began (Android keeps them when it
     * kills the app): its lines become the ones held, once, so the next message adds to them.
     */
    private fun takeOver(key: String, now: Long) {
        val shown = showing(key) ?: return
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(shown) ?: return
        // Lines with no key are the person's own (their user has none); every other sender has one.
        val old = style.messages.map { m ->
            Line(m.text.toString(), m.timestamp, m.person?.takeIf { it.key != null }, m.extras.getString(EXTRA_MESSAGE_ID))
        }
        lines.seed(key, old, shown.extras.getBoolean(EXTRA_MENTIONED, false), now)
    }

    /** The notification showing for [convKey], if any. */
    private fun showing(convKey: String): Notification? =
        nm.activeNotifications.firstOrNull { it.id == NOTICE_ID && it.tag == convKey }?.notification

    internal fun ensureChannelsOnce() {
        if (!channelsMade) ensureChannels()
    }

    // ---- the PendingIntents --------------------------------------------------------------------

    // PendingIntents are told apart by their intent (action, data, component) and request code,
    // never by extras. The data URI makes each conversation's intents distinct for certain;
    // the request code, from the key, is the usual second guard.
    private fun uri(key: String): Uri = Uri.Builder().scheme("skycord").authority("notice").appendPath(key).build()

    private fun tapIntent(conv: Conv): PendingIntent {
        val intent = MainActivity.noticeIntent(app)
            .setData(uri(conv.key))
            .putExtra(MainActivity.EXTRA_OPEN_KIND, conv.ref.kind)
            .putExtra(MainActivity.EXTRA_OPEN_ID, conv.ref.id)
            .putExtra(MainActivity.EXTRA_OPEN_SERVER, conv.ref.serverId)
            .putExtra(MainActivity.EXTRA_OPEN_ORIGIN, conv.origin)
        return PendingIntent.getActivity(app, conv.key.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun dismissIntent(conv: Conv): PendingIntent {
        val intent = conv.putInto(Intent(app, NoticeActions::class.java).setAction(NoticeActions.ACTION_DISMISSED).setData(uri(conv.key)))
        return PendingIntent.getBroadcast(app, conv.key.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun replyAction(conv: Conv): NotificationCompat.Action {
        val input = RemoteInput.Builder(NoticeActions.KEY_REPLY)
            .setLabel(app.getString(R.string.notice_reply_hint))
            .build()
        val intent = conv.putInto(Intent(app, NoticeActions::class.java).setAction(NoticeActions.ACTION_REPLY).setData(uri(conv.key)))
        // The one mutable PendingIntent: Android writes the typed text into it. (From API 31 that is
        // a flag to ask for; before, every PendingIntent is mutable anyway.) The intent is explicit,
        // as Android 14 insists for a mutable one.
        val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val pending = PendingIntent.getBroadcast(app, conv.key.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
        return NotificationCompat.Action.Builder(R.drawable.ic_notification, app.getString(R.string.notice_reply), pending)
            .addRemoteInput(input)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            // Suggested replies are written by reading the message; nothing here is shared for that.
            .setAllowGeneratedReplies(false)
            .build()
    }

    companion object {
        const val CHANNEL_MESSAGES = "messages"
        const val CHANNEL_CALLS = "calls"
        const val CHANNEL_CONNECTION = "connection"

        /** Every message notification: the conversation key is its tag, this its id. */
        private const val NOTICE_ID = 1001
        private const val SIGNED_OUT_ID = 1002
        // 1003 is the service's own (NotifyService). The two below belong to calls (CallRinger,
        // missedCall here): a ringing call, tagged by its room, and a missed one, tagged by its conversation.
        internal const val RING_ID = 1004
        private const val MISSED_ID = 1005

        // Android's own "missed_call" category (a constant of Notification from API 33).
        private const val CATEGORY_MISSED_CALL = "missed_call"

        private fun missedTag(convKey: String) = "missed:$convKey"

        private const val EXTRA_MENTIONED = "xyz.skycord.android.extra.MENTIONED"

        /** On each message of a notification's MessagingStyle: the id of the message it shows. */
        private const val EXTRA_MESSAGE_ID = "xyz.skycord.android.extra.MESSAGE_ID"

        private val LOCK = Any()
        @Volatile private var channelsMade = false

        /**
         * Every conversation's lines, for the whole process: a Notifier is made afresh by whoever needs
         * one (the service, a reply, a ring), and all of them must see the same lines.
         */
        private val lines = ConvLines<Line>()
    }
}
