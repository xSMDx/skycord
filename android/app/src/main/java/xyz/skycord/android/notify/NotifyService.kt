package xyz.skycord.android.notify

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import xyz.skycord.android.MainActivity
import xyz.skycord.android.PrefsKeyValue
import xyz.skycord.android.R
import xyz.skycord.android.core.Backoff
import xyz.skycord.android.core.BurstGate
import xyz.skycord.android.core.IncomingMessage
import xyz.skycord.android.core.MessageEvents
import xyz.skycord.android.core.NoticeText
import xyz.skycord.android.core.RawMessage
import xyz.skycord.android.core.SeenMessages
import xyz.skycord.android.core.ServerStore
import xyz.skycord.android.core.classify
import xyz.skycord.android.core.mentionsMe
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * The background part of the app: one connection to the last server used in
 * the app, which posts the phone's message notifications while Skycord is not
 * on screen — closed, in the background, or with the phone locked.
 *
 * **Why a foreground service of type remoteMessaging.** Android lets an app hold a
 * network connection in the background only from a foreground service, with its
 * always-on notification (the quiet "Connected to …" in the Connection channel).
 * remoteMessaging is the type made for passing messages on to the person, has no
 * daily time limit (dataSync has six hours on Android 15), and is one Android 15
 * still lets a boot receiver start (Task 13), unlike dataSync. On Android 8 and 9
 * there are no types and the attribute is ignored.
 *
 * **Lifecycle.** The activity starts it ([start], while it is on screen, which
 * Android allows) whenever the last server is known and signed in, and tells it
 * when the app comes to the front or leaves it ([setForeground]). Started with
 * another server, it clears the old server's notifications and reconnects
 * (Review Focus 2). It is sticky: if Android kills the process, it comes back
 * with the last server and catches up. It stops when background notifications
 * are turned off, when the sign-in is over (then it leaves the "Signed out —
 * open Skycord to sign in" notice and does not loop, Review Focus 1), or when
 * the activity asks.
 *
 * **What it posts.** Each message event goes through, in order: your own are
 * dropped before anything else (the server echoes a REST reply to your own
 * sockets); a message met before is dropped ([SeenMessages], across live and
 * catch-up); nothing at all while the app is in front (the page has the sound
 * then); then the web client's rules ([classify]: DND, mutes, levels); then the
 * names the event lacks are looked up, only now; then [BurstGate] decides loud
 * or quiet (on the monotonic clock, so a corrected clock offset cannot buzz),
 * and [Notifier] posts. Catch-up runs after every reconnect that has a place to
 * start from, and is always quiet.
 *
 * Everything runs on one worker thread, so the state below needs no locks; the
 * companion functions only hand things over to it.
 */
class NotifyService : Service() {
    companion object {
        const val ACTION_START = "xyz.skycord.android.action.START_NOTIFY"
        const val ACTION_STOP = "xyz.skycord.android.action.STOP_NOTIFY"
        /** The server to connect to, a saved origin. */
        const val EXTRA_ORIGIN = "xyz.skycord.android.extra.NOTIFY_ORIGIN"

        /** The service's own small store: whether background notifications are on, and catch-up's place. */
        internal const val PREFS = "skycord_notify"
        private const val KEY_ENABLED = "enabled"

        /** The always-on notification. Notifier owns 1001 and 1002. */
        private const val SERVICE_NOTICE_ID = 1003
        private const val TAG = "NotifyService"

        private const val PREFS_EVERY_MS = 15 * 60_000L
        private const val CURSOR_EVERY_MS = 60_000L
        private const val PREFS_DEBOUNCE_MS = 1_000L
        private const val MAX_CATCH_UP_TRIES = 6

        /**
         * How far behind "now" catch-up's place is kept while connected. A dropped
         * connection is noticed up to ~15 s late (the server pings every 10 s and
         * waits 5), and the phone's estimate of the server's clock is good to a second
         * or two; this covers both, with room. Too far back only repeats messages,
         * which [SeenMessages] drops; too little would lose them.
         */
        private const val CURSOR_MARGIN_MS = 30_000L

        @Volatile private var instance: NotifyService? = null
        @Volatile private var inFront = false

        /** The server the running service is for, or null when it is not running. */
        val runningOrigin: String? get() = instance?.origin

        /** Whether the person wants background notifications (Settings › Notifications). On by default. */
        fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, true)

        /**
         * Turns background notifications on or off. Off stops the service and forgets
         * catch-up's place, so turning it back on starts fresh, as the first run does.
         * The activity decides whether to start it again.
         */
        fun setEnabled(context: Context, on: Boolean) {
            prefs(context).edit().putBoolean(KEY_ENABLED, on).apply()
            if (!on) {
                stop(context, clearNotices = false)
                CatchUpCursor(context).clear()
            }
        }

        /** Start (or point at [origin]) — only while the app is on screen, as Android 12+ requires. */
        fun start(context: Context, origin: String) {
            val intent = Intent(context, NotifyService::class.java).setAction(ACTION_START).putExtra(EXTRA_ORIGIN, origin)
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (e: IllegalStateException) {
                // Android 12+ refuses a start from the background (ForegroundServiceStartNotAllowedException).
                // The next time the app is on screen starts it.
                Log.w(TAG, "Android wouldn’t start the background connection now: ${e.javaClass.simpleName}")
            }
        }

        /** Stop, with the message notifications too when [clearNotices] (their server is no longer the one). */
        fun stop(context: Context, clearNotices: Boolean) {
            if (clearNotices) Notifier(context).clearAll()
            context.stopService(Intent(context, NotifyService::class.java))
        }

        /** The app came to the front ([inFront] true) or left it. Nothing is posted while it is in front. */
        fun setForeground(@Suppress("UNUSED_PARAMETER") context: Context, inFront: Boolean) {
            this.inFront = inFront
        }

        /**
         * The page has [convKey] ("dm:…", "group:…", "channel:…") on screen: its
         * notification goes, and its next message alerts again.
         */
        fun seen(context: Context, convKey: String) {
            Notifier(context).clear(convKey)
            instance?.burst?.rearm(convKey)
        }

        /** The page wrote a mute or a level: read them again. */
        fun prefsChanged(@Suppress("UNUSED_PARAMETER") context: Context) {
            instance?.onPrefsChanged()
        }

        /** The server's clock as the running service estimates it (Task 12's ring rule), or null when not running. */
        fun serverNow(): Long? = instance?.session?.api?.serverNow()

        private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    /** Everything that belongs to one server's connection. Replaced whole when the server changes. */
    private inner class Session(val origin: String) : LiveConnection.Listener {
        val api = ServerApi(this@NotifyService, origin)
        val directory = Directory(api)
        val catchUp = CatchUp(api)
        val connection = LiveConnection(api, worker, this)

        /** Whether everything up to the cursor has been shown (or deliberately skipped), so it may move on. */
        var caughtUp = false
        var catchUpTries = 0
        var catchUpRetry: ScheduledFuture<*>? = null

        fun open() {
            connection.on("dm:receive") { onMessage(this, "dm", it) }
            connection.on("group:receive") { onMessage(this, "group", it) }
            connection.on("channel:receive") { onMessage(this, "channel", it) }
            // `mention:everyone` needs nothing of its own: the message it accompanies is the
            // notification (a channel event carries mentionsEveryone; a DM or group always notifies).
            connection.on("presence:self") { directory.onPresenceSelf(it) }
            connection.on("group:created") { onGroup(this, it) }
            connection.on("group:updated") { onGroup(this, it) }
            connection.start()
        }

        fun close() {
            catchUpRetry?.cancel(false)
            moveCursor(this)
            connection.stop()
        }

        override fun onConnected() = onSessionConnected(this)
        override fun onDisconnected() = onSessionDisconnected(this)
        override fun onSignedOut() = signedOut()
    }

    // A delayed task (a reconnect waiting out its backoff) must not run once the service has gone.
    private val worker: ScheduledExecutorService = ScheduledThreadPoolExecutor(1) { r -> Thread(r, "skycord-notify") }.apply {
        executeExistingDelayedTasksAfterShutdownPolicy = false
        removeOnCancelPolicy = true
    }
    private lateinit var notifier: Notifier
    private lateinit var cursor: CatchUpCursor
    private val seenIds = SeenMessages()

    /** Swapped for a new one when the server changes; read by [seen] and NotifyHub from other threads. */
    @Volatile private var burst = BurstGate()

    /** The server this service is for. Set on the main thread as soon as it is asked for. */
    @Volatile private var origin: String? = null

    // What the always-on notification says now, so a repeated start does not reset it to "Connecting".
    @Volatile private var noticeConnected = false

    // Written on the worker only; volatile so serverNow() can read it from elsewhere.
    @Volatile private var session: Session? = null

    // Worker thread only, from here down.
    private var prefsTimer: ScheduledFuture<*>? = null
    private var cursorTimer: ScheduledFuture<*>? = null
    private var prefsSoon: ScheduledFuture<*>? = null

    private val hub = NotifyHub.Listener { key -> burst.rearm(key) }

    private val network = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(net: Network) {
            onWorker { session?.connection?.retryNow() }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        notifier = Notifier(this)
        notifier.ensureChannels()
        cursor = CatchUpCursor(this)
        instance = this
        NotifyHub.listener = hub
        try {
            getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(network)
        } catch (e: RuntimeException) {
            Log.w(TAG, "couldn’t watch the network: ${e.javaClass.simpleName}")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val store = ServerStore(PrefsKeyValue(this))
        // A null intent is Android restarting the service after it killed the process.
        val wanted = if (intent?.action == ACTION_STOP) null else intent?.getStringExtra(EXTRA_ORIGIN) ?: store.last()
        val saved = wanted?.let(store::find)
        // First, always: a service started with startForegroundService must say so within seconds,
        // even if it is about to stop.
        goForeground(saved?.name ?: wanted ?: getString(R.string.app_name), connected = noticeConnected && wanted == origin)
        // Only to a server the person saved: the token goes nowhere else, whatever an intent says.
        if (saved == null || !isEnabled(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        origin = saved.origin
        onWorker { use(saved.origin) }
        return START_STICKY
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        if (NotifyHub.listener === hub) NotifyHub.listener = null
        try {
            getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(network)
        } catch (e: RuntimeException) {
            // It was never registered.
        }
        onWorker {
            prefsTimer?.cancel(false)
            cursorTimer?.cancel(false)
            prefsSoon?.cancel(false)
            session?.close()
            session = null
        }
        worker.shutdown()
        super.onDestroy()
    }

    // ---- the server, and the person signed in to it --------------------------------------------

    /** Worker. Connect to [origin], or, when already there, check that the sign-in is still the same. */
    private fun use(origin: String) {
        val current = session
        if (current != null && current.origin == origin) {
            checkSignIn(current)
            return
        }
        if (current != null) {
            // Another server: its notifications, and the replies they offer, belong to the old one.
            current.close()
            notifier.clearAll()
            burst = BurstGate()
        }
        Log.i(TAG, "connecting in the background")
        session = Session(origin).also { it.open() }
        scheduleTimers()
    }

    /**
     * Worker. The app has just been left, or opened: the WebView may have signed out, or
     * signed in as someone else, while it was on screen. No sign-in at all is the end;
     * a different one starts the connection over, and [onSessionConnected] notices whether
     * it is a different person.
     */
    private fun checkSignIn(s: Session) {
        when {
            !s.api.hasSignIn() -> signedOut()
            s.api.signInChanged() -> {
                s.api.invalidate()
                s.connection.restart()
            }
            else -> s.connection.retryNow()
        }
    }

    private fun onSessionConnected(s: Session) {
        if (s !== session) return
        when (s.directory.load()) {
            Directory.Outcome.SIGNED_OUT -> { signedOut(); return }
            Directory.Outcome.FAILED -> {
                // Connected, but without knowing who the person is or what they muted nothing can be decided.
                Log.w(TAG, "connected, but couldn’t read the account; trying again")
                s.connection.fail()
                return
            }
            Directory.Outcome.READY -> {}
        }
        val me = s.directory.me ?: return
        notifier.clearSignedOut()
        goForeground(nameOf(s.origin), connected = true)

        val since = cursor.get(s.origin, me.id)
        if (since == null) {
            // The first run on this server, for this person (or another person than last time):
            // whatever was showing belonged to someone else, and this starts fresh, with no catch-up.
            Log.i(TAG, "first connect for this server and person: starting fresh")
            notifier.clearAll()
            burst = BurstGate()
            cursor.set(s.origin, me.id, freshSince(s))
            s.caughtUp = true
        } else {
            s.catchUpTries = 0
            runCatchUp(s, since)
        }
    }

    private fun onSessionDisconnected(s: Session) {
        if (s !== session) return
        moveCursor(s)
        // From here until a catch-up succeeds, there is a gap, and the cursor must stay before it.
        s.caughtUp = false
        s.catchUpRetry?.cancel(false)
        goForeground(nameOf(s.origin), connected = false)
    }

    /** Worker. The sign-in is over: say so once, forget the place, stop. No retries, no loop. */
    private fun signedOut() {
        Log.i(TAG, "signed out; the background connection stops")
        session?.let {
            it.catchUpRetry?.cancel(false)
            it.connection.stop()
        }
        session = null
        cursor.clear()
        notifier.signedOut()
        stopSelf()
    }

    // ---- catch-up --------------------------------------------------------------------------------

    private fun runCatchUp(s: Session, since: Long) {
        if (s !== session || !s.connection.connected) return
        when (val r = s.catchUp.fetch(since)) {
            is CatchUp.Outcome.Caught -> {
                Log.i(TAG, "caught up: ${r.missed.events.size} message(s) since the gap")
                val me = s.directory.me ?: return
                // Newest first from the server; shown oldest first, so each conversation reads in order.
                for (raw in r.missed.events.asReversed()) {
                    if (raw.authorId == me.id) continue
                    handle(s, raw, live = false)
                }
                cursor.advance(s.origin, me.id, r.missed.now)
                s.caughtUp = true
            }
            CatchUp.Outcome.NotSupported -> {
                Log.i(TAG, "this server has no catch-up; live notifications only")
                s.caughtUp = true
            }
            CatchUp.Outcome.SignedOut -> signedOut()
            CatchUp.Outcome.Failed -> {
                Log.w(TAG, "catch-up failed; the gap stays open")
                // The gap stays open (the cursor does not move) until a try succeeds.
                s.caughtUp = false
                if (++s.catchUpTries > MAX_CATCH_UP_TRIES) return // the next reconnect tries again
                s.catchUpRetry = later(Backoff.next(s.catchUpTries)) { runCatchUp(s, since) }
            }
        }
    }

    /** The first `since` on a fresh start: the server's clock now, or a minute back if its clock is unknown. */
    private fun freshSince(s: Session): Long =
        if (s.api.serverOffsetMs != null) s.api.serverNow() else System.currentTimeMillis() - 60_000L

    /**
     * Moves catch-up's place up to (a margin before) now, while everything before it has been
     * seen. Only on the server's clock: with the offset unknown it stays where the server put it.
     */
    private fun moveCursor(s: Session) {
        if (!s.caughtUp || s.api.serverOffsetMs == null) return
        val me = s.directory.me ?: return
        cursor.advance(s.origin, me.id, s.api.serverNow() - CURSOR_MARGIN_MS)
    }

    // ---- messages --------------------------------------------------------------------------------

    private fun onMessage(s: Session, kind: String, payload: JSONObject) {
        if (s !== session) return
        val me = s.directory.me ?: return
        val raw = MessageEvents.live(kind, payload) ?: return
        // Your own never notify, including the echo of a reply sent from a notification. First of all.
        if (raw.authorId == me.id) return
        if (raw.kind == "dm") s.directory.learnName(raw.authorId, raw.authorName)
        handle(s, raw, live = true)
    }

    /** Worker. One message, live or caught up, through the rules to a notification (or not). */
    private fun handle(s: Session, raw: RawMessage, live: Boolean) {
        if (!seenIds.firstTime(raw.messageId)) return
        // In front, the page sounds and shows it. Marked seen above, so catch-up won't bring it back.
        if (inFront) return
        val me = s.directory.me ?: return
        val state = s.directory.ruleState() ?: return
        // The rules first, with no names: a channel message that won't notify must not cost a lookup.
        val bare = MessageEvents.toIncoming(raw, me.id, NO_NAMES, FALLBACKS_FOR_RULES) ?: return
        val kind = classify(bare, state) ?: return
        val e: IncomingMessage = MessageEvents.toIncoming(raw, me.id, s.directory, fallbacks()) ?: return
        val key = NoticeText.convKey(e)
        val alert = if (live) {
            burst.onLive(key, SystemClock.elapsedRealtime(), mentionsMe(e.content, me))
        } else {
            burst.onCatchUp(key)
        }
        // A caught-up message is shown at the time it was sent, on the phone's clock.
        val at = if (live) System.currentTimeMillis() else raw.createdAt?.let { it - (s.api.serverOffsetMs ?: 0L) } ?: System.currentTimeMillis()
        try {
            notifier.post(e, kind, alert, s.origin, at)
        } catch (ex: RuntimeException) {
            // Android can refuse a post (a notification it finds too big, say); the next message tries afresh.
            Log.w(TAG, "couldn’t post a notification: ${ex.javaClass.simpleName}")
        }
    }

    private fun onGroup(s: Session, payload: JSONObject) {
        if (s !== session) return
        // Added to a group mid-connection: the server joined this socket to its groups only at connect.
        s.directory.onGroup(payload)?.let { id -> s.connection.emit("group:subscribe", JSONObject().put("groupId", id)) }
    }

    private fun onPrefsChanged() {
        onWorker {
            prefsSoon?.cancel(false)
            // A few writes in a row (a menu of levels) make one read.
            prefsSoon = later(PREFS_DEBOUNCE_MS) { refreshPrefs() }
        }
    }

    private fun refreshPrefs() {
        val s = session ?: return
        if (s.directory.me == null) return // not loaded yet; the connect's load reads them
        // Also how a sign-in ended elsewhere is noticed while connected: the request needs a token.
        if (s.directory.refreshPrefs() == Directory.Outcome.SIGNED_OUT) signedOut()
    }

    private fun scheduleTimers() {
        if (prefsTimer == null) {
            prefsTimer = every(PREFS_EVERY_MS) { refreshPrefs() }
        }
        if (cursorTimer == null) {
            cursorTimer = every(CURSOR_EVERY_MS) { session?.let { if (it.connection.connected) moveCursor(it) } }
        }
    }

    // ---- the always-on notification --------------------------------------------------------------

    private fun goForeground(name: String, connected: Boolean) {
        noticeConnected = connected
        val notice = serviceNotice(name, connected)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0
        try {
            ServiceCompat.startForeground(this, SERVICE_NOTICE_ID, notice, type)
        } catch (e: RuntimeException) {
            // Android 12+ can refuse it (started from the background); nothing more can be done from here.
            Log.w(TAG, "couldn’t go to the foreground: ${e.javaClass.simpleName}")
        }
    }

    private fun serviceNotice(name: String, connected: Boolean): Notification {
        val open = PendingIntent.getActivity(
            this, SERVICE_NOTICE_ID, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, Notifier.CHANNEL_CONNECTION)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(this, R.color.accent))
            .setContentTitle(getString(if (connected) R.string.service_connected else R.string.service_connecting, name))
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(open)
            .build()
    }

    private fun nameOf(origin: String): String = ServerStore(PrefsKeyValue(this)).find(origin)?.name ?: origin

    private fun fallbacks() = MessageEvents.Fallbacks(
        group = getString(R.string.notice_unknown_group),
        channel = getString(R.string.notice_unknown_channel),
        server = getString(R.string.notice_unknown_server),
    )

    // ---- the worker ------------------------------------------------------------------------------

    private fun onWorker(block: () -> Unit) {
        try {
            worker.execute(guarded(block))
        } catch (e: RejectedExecutionException) {
            // Stopping; nothing more to do.
        }
    }

    private fun later(delayMs: Long, block: () -> Unit): ScheduledFuture<*>? = try {
        worker.schedule(guarded(block), delayMs, TimeUnit.MILLISECONDS)
    } catch (e: RejectedExecutionException) {
        null
    }

    private fun every(everyMs: Long, block: () -> Unit): ScheduledFuture<*>? = try {
        worker.scheduleWithFixedDelay(guarded(block), everyMs, everyMs, TimeUnit.MILLISECONDS)
    } catch (e: RejectedExecutionException) {
        null
    }

    /** One bad event must not end the worker (a scheduled task that throws is never run again). */
    private fun guarded(block: () -> Unit) = Runnable {
        try {
            block()
        } catch (e: RuntimeException) {
            // Where, not what: an exception's message can quote a payload, and message text is never logged.
            Log.w(TAG, "the background connection hit a problem: ${e.javaClass.simpleName} at ${e.stackTrace.firstOrNull()}")
        }
    }
}

/** The rules never read a name, so the first pass looks none up. */
private val NO_NAMES = object : MessageEvents.Names {
    override fun groupName(groupId: String): String? = null
    override fun channelName(serverId: String, channelId: String): String? = null
    override fun serverName(serverId: String): String? = null
}
private val FALLBACKS_FOR_RULES = MessageEvents.Fallbacks(group = "", channel = "", server = "")
