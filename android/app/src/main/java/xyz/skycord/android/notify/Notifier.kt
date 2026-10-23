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
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import xyz.skycord.android.MainActivity
import xyz.skycord.android.R
import xyz.skycord.android.core.Alert
import xyz.skycord.android.core.ConvRef
import xyz.skycord.android.core.IncomingMessage
import xyz.skycord.android.core.Kind
import xyz.skycord.android.core.NoticeText

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
 * The phone's notifications: one per conversation, updated as messages arrive,
 * with a reply field. The background service hands each message that passed the
 * rules to [post]; nothing here decides whether a message deserves one.
 *
 *  - **One per conversation.** Each is posted under its conversation key as the tag
 *    (never a hash, so two conversations cannot share one) and [NOTICE_ID]. A new
 *    message is added to the messages the notification already holds, read back
 *    from Android's own list of what is showing, so nothing is remembered in memory
 *    and a restarted process loses nothing. Android keeps the latest 25.
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
        val conv = Conv(origin, NoticeText.ref(e), NoticeText.conversationTitle(e))
        val sender = Person.Builder().setName(NoticeText.authorName(e)).setKey("user:${e.authorId}").build()
        val text = NoticeText.body(e.content, app.getString(R.string.notice_no_text))
        publish(conv, headline = NoticeText.title(e), mentions = kind == Kind.MENTION, loud = alert == Alert.LOUD, at = at, create = true) {
            it.addMessage(text, at, sender)
        }
    }

    /** Your reply went through: "You: …" joins the conversation, quietly. Nothing to do if the notice has gone. */
    internal fun appendReply(conv: Conv, text: String, at: Long = System.currentTimeMillis()) {
        publish(conv, headline = conv.title, mentions = false, loud = false, at = at, create = false) {
            it.addMessage(text, at, it.user)
        }
    }

    /** Your reply did not go: say so in the conversation, even if the notice was swiped away meanwhile. */
    internal fun replyFailed(conv: Conv, at: Long = System.currentTimeMillis()) {
        val skycord = Person.Builder().setName(app.getString(R.string.app_name)).setKey("skycord").build()
        publish(conv, headline = conv.title, mentions = false, loud = false, at = at, create = true) {
            it.addMessage(app.getString(R.string.notice_send_failed), at, skycord)
        }
    }

    /**
     * Posts the notification again as it is. Android shows a spinner on a notification
     * once something is typed into its reply field, until the app updates it; this ends
     * it when there is nothing to say.
     */
    internal fun settle(conv: Conv) {
        publish(conv, headline = conv.title, mentions = false, loud = false, at = System.currentTimeMillis(), create = false) {}
    }

    /** Removes one conversation's notification. */
    fun clear(convKey: String) {
        nm.cancel(convKey, NOTICE_ID)
    }

    /** Removes every message notification (not the service's own, nor a signed-out notice). */
    fun clearAll() {
        for (n in nm.activeNotifications) if (n.id == NOTICE_ID) nm.cancel(n.tag, n.id)
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
     * Reads what [conv]'s notification holds, lets [edit] change it, and posts the result.
     * With nothing showing it starts a fresh one, unless [create] is false. One at a time:
     * two posts for the same conversation must not both read the old list.
     */
    private fun publish(
        conv: Conv,
        headline: String,
        mentions: Boolean,
        loud: Boolean,
        at: Long,
        create: Boolean,
        edit: (NotificationCompat.MessagingStyle) -> Unit,
    ) = synchronized(LOCK) {
        ensureChannelsOnce()
        val previous = showing(conv.key)
        if (previous == null && !create) return@synchronized

        val style = previous?.let { NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(it) }
            ?: NotificationCompat.MessagingStyle(Person.Builder().setName(app.getString(R.string.notice_you)).build())
        // A DM is between two people and needs no title; a group or a channel is named.
        if (conv.ref.kind != "dm") {
            style.conversationTitle = conv.title
            style.isGroupConversation = true
        }
        edit(style)

        // Once a mention is in the notification it stays marked, even as plain messages join it.
        val mentioned = mentions || previous?.extras?.getBoolean(EXTRA_MENTIONED, false) == true
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
        // Only-alert-once keeps an update quiet, but a notification that is new (catch-up, or one
        // swiped away a moment ago) alerts all the same. Silent covers that case.
        if (!loud && previous == null) builder.setSilent(true)
        nm.notify(conv.key, NOTICE_ID, builder.build())
    }

    /** The notification showing for [convKey], if any. */
    private fun showing(convKey: String): Notification? =
        nm.activeNotifications.firstOrNull { it.id == NOTICE_ID && it.tag == convKey }?.notification

    private fun ensureChannelsOnce() {
        if (!channelsMade) ensureChannels()
    }

    // ---- the PendingIntents --------------------------------------------------------------------

    // PendingIntents are told apart by their intent (action, data, component) and request code,
    // never by extras. The data URI makes each conversation's intents distinct for certain;
    // the request code, from the key, is the usual second guard.
    private fun uri(key: String): Uri = Uri.Builder().scheme("skycord").authority("notice").appendPath(key).build()

    private fun tapIntent(conv: Conv): PendingIntent {
        val intent = Intent(app, MainActivity::class.java)
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

        private const val EXTRA_MENTIONED = "xyz.skycord.android.extra.MENTIONED"

        private val LOCK = Any()
        @Volatile private var channelsMade = false
    }
}
