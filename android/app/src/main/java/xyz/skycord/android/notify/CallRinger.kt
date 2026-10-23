package xyz.skycord.android.notify

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import xyz.skycord.android.MainActivity
import xyz.skycord.android.R
import xyz.skycord.android.core.ConvRef
import xyz.skycord.android.core.NoticeText
import java.util.concurrent.ConcurrentHashMap

/**
 * An incoming call, rung like a phone call. The background service decides *when*
 * ([xyz.skycord.android.core.RingGate]); this is the ring itself, for one server.
 *
 *  - **The ring** is a notification on the Calls channel, tagged by the call's room,
 *    with **Answer** and **Decline**. From Android 12 it is a CallStyle incoming-call
 *    notification; before, a high-priority one with the same two actions. It carries a
 *    full-screen intent to [IncomingCallActivity] — over the lock screen when the phone
 *    is locked, a heads-up when it is in use — where Android lets the app have one: always
 *    before Android 14, after it only while [NotificationManager.canUseFullScreenIntent]
 *    (the person can switch that off). Without it the ring is the heads-up notification alone,
 *    and tapping it opens the same call screen. The sound is the channel's ringtone, looped
 *    (`FLAG_INSISTENT`) until the notification goes, so the ring and its sound end together.
 *  - **Ending it.** [stop] (the call was joined elsewhere, or you declined), [missed] (nobody
 *    answered), [cancel] (the buttons) all take the notification down *and* close the call
 *    screen, so an Answer cannot be pressed on a call that has ended. [isRinging] says whether
 *    a room is still ringing, and the screen, and Answer itself, ask it first.
 *  - **Missed.** "Missed call from *name*" on the Messages channel, opening that conversation.
 *
 * Answer opens [MainActivity] with the call to join ([EXTRA_JOIN_ROOM] says which ring it
 * answers, so the app can end it, and refuse an Answer whose ring has already ended);
 * Decline goes to [NoticeActions], which tells the service to say so to the server.
 *
 * One per server connection; what is ringing is process-wide (a ring is the phone's, whichever
 * object posted it), so the buttons and the call screen can reach it without the service.
 */
class CallRinger(context: Context, private val origin: String) {
    private val app = context.applicationContext
    private val nm: NotificationManager = app.getSystemService(NotificationManager::class.java)
    private val notifier = Notifier(app)

    /** What a ring was for, kept to open the conversation if it ends unanswered. */
    private class Ring(val kind: String, val convId: String)

    private val rings = ConcurrentHashMap<String, Ring>()

    /** Starts ringing for [room]: from [name], a call in the [kind] ("dm" or "group") conversation [convId]. */
    fun ring(room: String, name: String, kind: String, convId: String) {
        notifier.ensureChannelsOnce()
        rings[room] = Ring(kind, convId)
        ringing.add(room)
        try {
            nm.notify(room, Notifier.RING_ID, notification(room, name, kind, convId))
        } catch (e: RuntimeException) {
            // Nothing is ringing if Android would not show it.
            rings.remove(room)
            ringing.remove(room)
            throw e
        }
    }

    /** The ring for [room] is over without a missed call: the call was joined, or declined. */
    fun stop(room: String) {
        rings.remove(room)
        cancel(app, room)
    }

    /** The ring for [room] went unanswered: it ends, and "Missed call from [name]" is left. */
    fun missed(room: String, name: String) {
        val ring = rings.remove(room)
        cancel(app, room)
        // A ring this object did not start has no conversation to open; nothing to leave.
        ring ?: return
        notifier.missedCall(
            Conv(origin, ConvRef(ring.kind, ring.convId), name),
            NoticeText.missedCallText(name, app.getString(R.string.notice_missed_call)),
        )
    }

    /** Every ring, ended quietly: the connection is going away. */
    fun stopAll() {
        for (room in rings.keys.toList()) stop(room)
    }

    private fun fullScreenAllowed(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE || nm.canUseFullScreenIntent()

    private fun notification(room: String, name: String, kind: String, convId: String): Notification {
        val code = room.hashCode()
        // Tapping the ring, and the full-screen intent, open the call screen.
        val screen = PendingIntent.getActivity(
            app, code, IncomingCallActivity.intent(app, origin, room, name, kind, convId).setData(uri("screen", room)),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val answer = PendingIntent.getActivity(
            app, code, answerIntent(app, origin, room, kind, convId), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val decline = PendingIntent.getBroadcast(
            app, code,
            Intent(app, NoticeActions::class.java).setAction(NoticeActions.ACTION_DECLINE_CALL)
                .setData(uri("decline", room)).putExtra(NoticeActions.EXTRA_CALL_ROOM, room),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val fullScreen = fullScreenAllowed()
        val builder = NotificationCompat.Builder(app, Notifier.CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(app, R.color.accent))
            .setContentText(app.getString(R.string.call_incoming))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(screen)
            // Backstop: if this process dies mid-ring nothing else would take the notification down.
            .setTimeoutAfter(RING_MS + 5_000L)
        if (fullScreen) builder.setFullScreenIntent(screen, true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && fullScreen) {
            // CallStyle is only valid with a full-screen intent (or a foreground service's notification).
            val caller = Person.Builder().setName(name).setImportant(true).build()
            builder.setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
        } else {
            builder.setContentTitle(name)
                .addAction(R.drawable.ic_notification, app.getString(R.string.call_decline), decline)
                .addAction(R.drawable.ic_notification, app.getString(R.string.call_answer), answer)
        }
        // The channel's ringtone, repeated until the notification is taken down.
        return builder.build().apply { flags = flags or Notification.FLAG_INSISTENT }
    }

    companion object {
        /** How long a call rings before it is a missed one. */
        const val RING_MS = 30_000L

        /** Rooms ringing now, in this process. */
        private val ringing: MutableSet<String> = ConcurrentHashMap.newKeySet()

        /** Whether [room] is still ringing: false once it was answered, declined, missed or stopped. */
        fun isRinging(room: String): Boolean = room in ringing

        /**
         * Takes [room]'s ring down: its notification (and with it the sound) and the call screen.
         * Safe from any thread, and with or without a service — the buttons use it too.
         */
        fun cancel(context: Context, room: String) {
            ringing.remove(room)
            context.applicationContext.getSystemService(NotificationManager::class.java).cancel(room, Notifier.RING_ID)
            IncomingCallActivity.finishFor(room)
        }

        /** What Answer opens: the app, on [origin]'s page, joining the [kind] call with [convId]. */
        fun answerIntent(context: Context, origin: String, room: String, kind: String, convId: String): Intent =
            Intent(context, MainActivity::class.java)
                .setData(uri("answer", room))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(MainActivity.EXTRA_JOIN_KIND, kind)
                .putExtra(MainActivity.EXTRA_JOIN_ID, convId)
                .putExtra(MainActivity.EXTRA_JOIN_ROOM, room)
                .putExtra(MainActivity.EXTRA_OPEN_ORIGIN, origin)

        // PendingIntents are told apart by data, never extras: one URI per room and purpose.
        private fun uri(purpose: String, room: String): Uri =
            Uri.Builder().scheme("skycord").authority("call").appendPath(purpose).appendPath(room).build()
    }
}
