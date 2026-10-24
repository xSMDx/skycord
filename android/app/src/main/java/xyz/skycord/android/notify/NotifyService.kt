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
import xyz.skycord.android.core.Alert
import xyz.skycord.android.core.Backoff
import xyz.skycord.android.core.BurstGate
import xyz.skycord.android.core.CallEvents
import xyz.skycord.android.core.CallRooms
import xyz.skycord.android.core.ConvGroups
import xyz.skycord.android.core.CursorPolicy
import xyz.skycord.android.core.Deadline
import xyz.skycord.android.core.FrontGate
import xyz.skycord.android.core.IncomingMessage
import xyz.skycord.android.core.MessageEvents
import xyz.skycord.android.core.Me
import xyz.skycord.android.core.NetworkWatch
import xyz.skycord.android.core.NoticeText
import xyz.skycord.android.core.RawMessage
import xyz.skycord.android.core.RingAction
import xyz.skycord.android.core.RingGate
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
 * with the last server and catches up. After a restart of the phone, or an update of
 * the app, [BootReceiver] starts it, so it does not wait for the app to be opened. It stops when background notifications
 * are turned off, when the sign-in is over (then it leaves the "Signed out —
 * open Skycord to sign in" notice and does not loop, Review Focus 1), or when
 * the activity asks.
 *
 * **What it posts.** Each message event goes through, in order: your own are
 * dropped before anything else (the server echoes a REST reply to your own
 * sockets); a message met before is dropped ([SeenMessages], across live and
 * catch-up); nothing at all while the app is in front — this server's page on
 * screen and its web client ready, signed in and subscribed ([FrontGate]); the launcher, the
 * can't-reach screen, a page still loading and the sign-in screen are not (the page has the sound
 * then, and nothing else would show the message); then the web client's rules
 * ([classify]: DND, which ends by itself at its end time, mutes, levels); then the
 * names the event lacks are looked up, only now; then [BurstGate] decides loud
 * or quiet (on the monotonic clock, so a corrected clock offset cannot buzz),
 * and [Notifier] posts. Catch-up runs after every reconnect that has a place to
 * start from, and is always quiet; it posts each conversation once, with all its
 * lines, oldest first.
 *
 * **Calls.** `call:state` goes through a [RingGate] (per server, told of every
 * reconnect first, and given the server's clock): it says when a DM or group call
 * is one to ring for, and [CallRinger] rings it. Not while the app is in front or
 * for a muted conversation or Do Not Disturb (the page rings, or the person has
 * said no; "in front" as above, so with only the launcher up the phone rings); each of those ends the ring before it begins. A ring ends on the gate's
 * word (joined, the room emptied: a missed call), after 30 s (a missed call), on
 * Answer, on Decline (which sends `call:decline`, so the caller is told), on your own
 * decline elsewhere (`call:declined` with your id), and when the app comes to the front.
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

        /** All the name lookups of one ring together (see startRing). */
        private const val RING_LOOKUP_MS = 1_500L

        @Volatile private var instance: NotifyService? = null

        /**
         * Whether the page of the server this service is for is on screen and its web client is ready. Fed by the
         * activity and the bridge; read by the worker (see [FrontGate]).
         */
        private val front = FrontGate()

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
                // Before the cursor is cleared (stop does it too, before it clears anything of its own): a
                // worker mid-way through a catch-up or a fresh start must not write it back.
                instance?.stopNow()
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
            // First, here and now: the service only learns it is stopped when Android gets round to
            // onDestroy, a main-loop turn later, and in that turn the worker could post a message after
            // the clear below, or write a cursor after the caller cleared it.
            instance?.stopNow()
            if (clearNotices) Notifier(context).clearAll()
            context.stopService(Intent(context, NotifyService::class.java))
        }

        /**
         * The app came on screen ([onScreen] true) or left it. On screen alone is not "in front": the page
         * of the server must also be showing and its web client ready ([pageShown], [pageReady]).
         */
        fun setForeground(@Suppress("UNUSED_PARAMETER") context: Context, onScreen: Boolean) {
            front.onScreen(onScreen)
        }

        /**
         * [origin]'s page is now what the app shows, or has just started loading again (a reload, a
         * redirect, opening the server): a page that is not ready yet. Null when it is the launcher or the
         * can't-reach screen. While a page is loading, signing in, or none is there, messages are shown on
         * the phone as usual.
         */
        fun pageShown(@Suppress("UNUSED_PARAMETER") context: Context, origin: String?) {
            front.shown(origin)
        }

        /**
         * The web client of [origin]'s page is ready ([up]: it has subscribed to the app's background state,
         * which it does only once signed in) or has gone (signed out, the chat closed). From ready it has the
         * sounds and its own ring, so a call still ringing on the phone ends here ([pageTakesOver]).
         */
        fun pageReady(context: Context, origin: String, up: Boolean) {
            front.ready(origin, up)
            if (up) pageTakesOver(context)
        }

        /**
         * The page may now have the sounds and its own ring (the app resumed, or the page became ready): a
         * call still ringing on the phone ends — but only when this server's page really is in front, ready
         * and on screen. Resumed onto the launcher, or onto a page still loading or signing in, nothing
         * there rings, so the phone's ring goes on. Judged on the worker, when it runs. Not from onStart:
         * for an activity that was stopped Android runs onStart *before* onNewIntent, and an Answer that
         * brought the app back must still find its ring ringing there (MainActivity refuses an Answer for
         * a ring that has ended); it is called from onResume.
         */
        fun pageTakesOver(@Suppress("UNUSED_PARAMETER") context: Context) {
            instance?.let { svc ->
                svc.onWorker {
                    val s = svc.session
                    if (s != null && front.inFront(s.origin)) s.endRings()
                }
            }
        }

        /**
         * Answer was pressed (the call screen, or the notification): the ring is over, quietly — no missed
         * call, nothing said to the caller — and the page joins. Takes the ring down at once, service or not.
         */
        fun callAnswered(context: Context, room: String) {
            CallRinger.cancel(context, room)
            instance?.let { svc -> svc.onWorker { svc.session?.endRing(room) } }
        }

        /**
         * Decline was pressed: the ring ends at once, and the server is told, so the caller sees "declined"
         * and the person's other devices stop ringing. With no service there is no connection to tell it by.
         */
        fun declineCall(context: Context, room: String) {
            CallRinger.cancel(context, room)
            instance?.let { svc -> svc.onWorker { svc.session?.decline(room) } }
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

        // Calls: when to ring, the ring itself, and for each room ringing its name and its 30 s timer.
        // Worker thread only. (Room names are this server's, so a new server starts with a new gate.)
        val gate = RingGate()
        val ringer = CallRinger(this@NotifyService, origin)
        private val ringing = HashMap<String, Ringing>()

        private inner class Ringing(val name: String, val timer: ScheduledFuture<*>?)

        fun open() {
            connection.on("call:state") { onCallState(this, it) }
            connection.on("call:declined") { onCallDeclined(this, it) }
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
            endRings()
        }

        /** Worker. A ring started for [room], named [name], to end by itself in [RING_MS]. */
        fun began(room: String, name: String) {
            ringing[room]?.timer?.cancel(false)
            ringing[room] = Ringing(name, later(CallRinger.RING_MS) { onRingTimeout(this, room) })
        }

        /** Worker. [room] stops ringing, whatever ended it; its name, if it was ringing. */
        fun ended(room: String): String? {
            val r = ringing.remove(room) ?: return null
            r.timer?.cancel(false)
            return r.name
        }

        /** Worker. The call was answered here: the ring is over, quietly. */
        fun endRing(room: String) {
            gate.onDeclined(room)
            ended(room)
            ringer.stop(room)
        }

        /** Worker. Every ring over, quietly: the app is in front, or this connection is going. */
        fun endRings() {
            for (room in ringing.keys.toList()) endRing(room)
            ringer.stopAll()
        }

        /** Worker. Decline: the ring ends, and the server is told, if the ring was still on. */
        fun decline(room: String) {
            gate.onDeclined(room)
            val was = ended(room)
            ringer.stop(room)
            if (was != null && !connection.emit("call:decline", JSONObject().put("room", room))) {
                // Not connected right now: the caller is not told, and goes on seeing a ringing call until it ends.
                Log.w(TAG, "a decline couldn’t be sent: the connection is down")
            }
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

    /**
     * Set the moment a stop is asked for ([stopNow], from [stop] and [setEnabled], on the main thread,
     * before they clear anything) and again first in [onDestroy]. The worker may still be in the middle of
     * something (a blocking load, a catch-up) when the service is stopped, and a stopped service must post
     * nothing and write no cursor: a notification after "off" is a bug, and a fresh-start cursor written
     * after Settings cleared it would make the next start catch up instead of starting fresh. Checked
     * wherever work is about to be shown or kept; what is shown or kept goes through [unlessStopped].
     * Not left to [onDestroy] alone, which runs a main-loop turn after the stop was asked for.
     */
    @Volatile private var destroyed = false

    /** Held while something is shown or kept, and while a stop raises the flag: see [unlessStopped]. */
    private val stopLock = Any()

    /** Main thread, from [stop] and [setEnabled]: from here on nothing more is shown or kept. */
    private fun stopNow() {
        synchronized(stopLock) { destroyed = true }
    }

    /**
     * Runs [block] (a post, a cursor write) unless the service has been stopped. The flag is raised under
     * the same lock, so a stop waits for a block that has begun, and what that block did is then cleared by
     * the stop; a block that has not begun finds the flag. A check followed by a write, with nothing between,
     * would leave a gap in which the stop's clear could come first.
     */
    private inline fun unlessStopped(block: () -> Unit) {
        synchronized(stopLock) { if (!destroyed) block() }
    }

    // Worker thread only, from here down.
    private var prefsTimer: ScheduledFuture<*>? = null
    private var cursorTimer: ScheduledFuture<*>? = null
    private var prefsSoon: ScheduledFuture<*>? = null
    private val networkWatch = NetworkWatch()

    private val hub = NotifyHub.Listener { key -> burst.rearm(key) }

    private val network = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(net: Network) {
            onWorker { onNetworkAvailable(net) }
        }

        override fun onLost(net: Network) {
            onWorker { networkWatch.onLost(net) }
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
        stopNow() // first (usually already so): anything the worker is still doing must see it
        // Turned off in Settings: its clear ran when Stop was asked, before this service was gone; once
        // nothing more can be written (above), the cursor is cleared for good, so turning it back on is fresh.
        if (!isEnabled(this)) cursor.clear()
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
        if (destroyed) return // queued before the stop, run after it: connect to nothing
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
        if (destroyed || s !== session) return
        // Every (re)connect, before the call:state events the server replays right after it: a call
        // that was going on is not one that has just begun.
        s.gate.onConnected(s.api.serverNow())
        val loaded = s.directory.load() // blocking: the service may have been stopped meanwhile
        if (destroyed || s !== session) return
        when (loaded) {
            Directory.Outcome.SIGNED_OUT -> { signedOut(); return }
            Directory.Outcome.FAILED -> {
                // Connected, but without knowing who the person is or what they muted nothing can be decided.
                // The connect did not reset the backoff, so a server that keeps doing this is retried 1 s,
                // 2 s, 4 s … up to a minute, not every second.
                Log.w(TAG, "connected, but couldn’t read the account; trying again")
                s.connection.fail()
                return
            }
            Directory.Outcome.READY -> {}
        }
        val me = s.directory.me ?: return
        // Usable from here: the socket is up and the account is known. Only now does a later failure start
        // its backoff over.
        s.connection.markReady()
        notifier.clearSignedOut()
        goForeground(nameOf(s.origin), connected = true)

        val since = cursor.get(s.origin, me.id)
        if (since == null) {
            // The first run on this server, for this person (or another person than last time):
            // whatever was showing belonged to someone else, and this starts fresh, with no catch-up.
            Log.i(TAG, "first connect for this server and person: starting fresh")
            notifier.clearAll()
            burst = BurstGate()
            if (destroyed) return // Settings just cleared the cursor: a start-fresh one must not be written back
            unlessStopped { cursor.set(s.origin, me.id, freshSince(s)) }
            s.caughtUp = true
        } else {
            s.catchUpTries = 0
            runCatchUp(s, since)
        }
    }

    private fun onSessionDisconnected(s: Session) {
        if (destroyed || s !== session) return
        openGap(s)
    }

    /**
     * Worker. The connection has dropped, or is about to be dropped by us: the cursor moves on as far
     * as the last packet vouches for (and no further), and from here until a catch-up succeeds there is a
     * gap, so it stays before it.
     */
    private fun openGap(s: Session) {
        moveCursor(s)
        s.caughtUp = false
        s.catchUpRetry?.cancel(false)
        goForeground(nameOf(s.origin), connected = false)
    }

    /**
     * Worker. The phone's default network is now [net]. Never connected, or waiting out a backoff:
     * try now. Connected, but on a different network (or the same one back after a loss): the socket
     * is probably dead and would linger until its ping timeout, so make it again.
     */
    private fun onNetworkAvailable(net: Network) {
        val changed = networkWatch.onAvailable(net)
        val s = session
        if (destroyed || s == null) return
        if (changed && s.connection.connected) {
            Log.i(TAG, "the network changed; connecting again")
            openGap(s)
            s.connection.restart()
        } else {
            s.connection.retryNow()
        }
    }

    /** Worker. The sign-in is over: say so once, forget the place, stop. No retries, no loop. */
    private fun signedOut() {
        if (destroyed) return // stopped meanwhile: no notice; whoever stopped the service decided about the cursor
        Log.i(TAG, "signed out; the background connection stops")
        session?.let {
            it.catchUpRetry?.cancel(false)
            it.connection.stop()
            it.endRings()
        }
        session = null
        cursor.clear()
        notifier.signedOut()
        stopSelf()
    }

    // ---- catch-up --------------------------------------------------------------------------------

    private fun runCatchUp(s: Session, since: Long) {
        if (destroyed || s !== session || !s.connection.connected) return
        val outcome = s.catchUp.fetch(since) // blocking: the service may have been stopped meanwhile
        if (destroyed || s !== session) return
        when (val r = outcome) {
            is CatchUp.Outcome.Caught -> {
                Log.i(TAG, "caught up: ${r.missed.events.size} message(s) since the gap")
                val me = s.directory.me ?: return
                // Newest first from the server; taken oldest first, so each conversation reads in order. Each
                // conversation is posted once, with all its lines (up to 5 per conversation, 100 in all): posting
                // them one by one would read half-updated notifications, and Android drops updates that come too fast.
                val ready = ArrayList<Ready>()
                for (raw in r.missed.events.asReversed()) {
                    if (destroyed) return // stopped mid-way: no more posts, and the gap stays open
                    if (raw.authorId == me.id) continue
                    prepare(s, raw, live = false)?.let(ready::add)
                }
                // The conversation with the newest message goes last, so it ends up on top.
                for (group in ConvGroups.byConversation(ready, { NoticeText.convKey(it.note.e) }, { it.note.at })) {
                    if (destroyed) return
                    post(s, group)
                }
                if (destroyed) return
                // The server's own clock at the answer: everything before it was in the answer, however the
                // socket was doing, so this one is safe without a packet to vouch for it.
                unlessStopped { cursor.advance(s.origin, me.id, r.missed.now) }
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

    /** The first `since` on a fresh start ([CursorPolicy.fresh]): the server's clock now, or a minute back if it is unknown. */
    private fun freshSince(s: Session): Long =
        CursorPolicy.fresh(if (s.api.serverOffsetMs != null) s.api.serverNow() else null, System.currentTimeMillis())

    /**
     * Moves catch-up's place on, while everything before it has been seen — but only as far as the
     * last packet received vouches for ([CursorPolicy.advance]): "now" proves nothing when the
     * socket may have died silently, and a packet that did arrive vouches for what came before it
     * whatever the phone did afterwards. Only on the server's clock: with the offset unknown it stays
     * where the server put it.
     */
    private fun moveCursor(s: Session) {
        if (destroyed || !s.caughtUp || s.api.serverOffsetMs == null) return
        val me = s.directory.me ?: return
        val current = cursor.get(s.origin, me.id) ?: return
        val to = CursorPolicy.advance(current, s.connection.lastPacketAt)
        if (to > current) unlessStopped { cursor.advance(s.origin, me.id, to) }
    }

    // ---- messages --------------------------------------------------------------------------------

    private fun onMessage(s: Session, kind: String, payload: JSONObject) {
        if (s !== session) return
        val me = s.directory.me ?: return
        val raw = MessageEvents.live(kind, payload) ?: return
        // Your own never notify, including the echo of a reply sent from a notification. First of all.
        if (raw.authorId == me.id) return
        MessageEvents.nameToLearn(raw)?.let { s.directory.learnName(raw.authorId, it) }
        handle(s, raw, live = true)
    }

    /** A message that passed every rule and is ready to be shown: what it is, and how loudly. */
    private class Ready(val note: Note, val alert: Alert)

    /** Worker. One live message through the rules to a notification (or not). */
    private fun handle(s: Session, raw: RawMessage, live: Boolean) {
        prepare(s, raw, live)?.let { post(s, listOf(it)) }
    }

    /**
     * Worker. One message, live or caught up, through the rules: null when it is not to be shown (a
     * duplicate, in front, muted, DND…), else what to show. Shows nothing itself.
     */
    private fun prepare(s: Session, raw: RawMessage, live: Boolean): Ready? {
        if (destroyed) return null // before marking it seen: nothing is shown after stop
        if (!seenIds.firstTime(raw.messageId)) return null
        // In front (this server's page is on screen and its web client is ready), the page sounds and shows it. Marked seen
        // above, so catch-up won't bring it back. With only the launcher, a page still loading or signing in, or the can't-reach
        // screen up, nobody would show it: it is posted as usual.
        if (front.inFront(s.origin)) return null
        val me = s.directory.me ?: return null
        val state = s.directory.ruleState() ?: return null
        // The rules first, with no names: a channel message that won't notify must not cost a lookup.
        val bare = MessageEvents.toIncoming(raw, me.id, NO_NAMES, FALLBACKS_FOR_RULES) ?: return null
        val kind = classify(bare, state) ?: return null
        val e: IncomingMessage = MessageEvents.toIncoming(raw, me.id, s.directory, fallbacks()) ?: return null
        val key = NoticeText.convKey(e)
        val alert = if (live) {
            burst.onLive(key, SystemClock.elapsedRealtime(), mentionsMe(e.content, me))
        } else {
            burst.onCatchUp(key)
        }
        // A caught-up message is shown at the time it was sent, on the phone's clock.
        val at = if (live) System.currentTimeMillis() else raw.createdAt?.let { it - (s.api.serverOffsetMs ?: 0L) } ?: System.currentTimeMillis()
        return Ready(Note(e, kind, at), alert)
    }

    /** Worker. [group], one conversation's messages oldest first, as one post to its notification. */
    private fun post(s: Session, group: List<Ready>) {
        if (destroyed || group.isEmpty()) return
        val alert = if (group.any { it.alert == Alert.LOUD }) Alert.LOUD else Alert.SILENT
        try {
            unlessStopped { notifier.postAll(group.map { it.note }, alert, s.origin) }
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

    // ---- calls -----------------------------------------------------------------------------------

    /**
     * Worker. A `call:state`: [RingGate] says whether it is a call to ring for, one that has ended its
     * ring (joined, or the room emptied: a missed call), or nothing. Voice channels never ring.
     */
    private fun onCallState(s: Session, payload: JSONObject) {
        if (destroyed || s !== session) return // stopped: no ring starts
        val me = s.directory.me ?: return
        val state = CallEvents.state(payload) ?: return
        val target = CallRooms.target(state.room, me.id)
        val isMember = when (target?.kind) {
            "dm" -> true // the room names the two people, and the person is one of them
            // The server sends a group's call:state only to the group's members, so getting one is the proof.
            // (The group list is a best-effort fetch; asking it would silence a group's calls whenever it failed.)
            "group" -> true
            else -> false
        }
        when (s.gate.onCallState(state.room, state.userIds, state.startedAt, me.id, isMember, s.api.serverNow())) {
            is RingAction.Ring -> if (target != null) startRing(s, me, state, target) else s.gate.onDeclined(state.room)
            is RingAction.Stop -> finishRing(s, state.room, missed = false)
            is RingAction.Missed -> finishRing(s, state.room, missed = true)
            RingAction.None -> {}
        }
    }

    /**
     * Worker. The gate says ring. Not while the app is in front (the page rings then), nor for a muted
     * conversation or Do Not Disturb (the web client's own rules for a call); those end the ring before it
     * begins, so nothing is left behind for it. The caller is named from the directory, asked if need be.
     */
    private fun startRing(s: Session, me: Me, state: CallEvents.State, target: CallRooms.Target) {
        val room = state.room
        val rules = s.directory.ruleState()
        if (front.inFront(s.origin) || rules == null || rules.dnd || rules.isMuted(target.convId)) {
            s.gate.onDeclined(room)
            return
        }
        // In a DM the caller is the other person; in a group, whoever is in the call first started it.
        val callerId = if (target.kind == "dm") target.convId else state.userIds.firstOrNull { it != me.id }
        // Names that are not known yet are asked of the server, but only within one short deadline: the
        // worker is blocked while it asks, the phone is silent, and a name is not worth a ring ten seconds late.
        // What it could not find the label does without ("Someone", "a group").
        val lookup = Deadline(RING_LOOKUP_MS)
        val label = CallRooms.callerLabel(
            kind = target.kind,
            callerName = callerId?.let { s.directory.callerName(it, lookup) },
            groupName = if (target.kind == "group") s.directory.groupNameWithin(target.convId, lookup) else null,
            someone = getString(R.string.call_someone),
            unknownGroup = getString(R.string.notice_unknown_group),
        )
        try {
            s.ringer.ring(room, label, target.kind, target.convId)
        } catch (ex: RuntimeException) {
            // Android refused to show it, so nothing is ringing, and nothing can be missed.
            Log.w(TAG, "couldn’t ring: ${ex.javaClass.simpleName}")
            s.gate.onDeclined(room)
            return
        }
        Log.i(TAG, "ringing for a ${target.kind} call")
        s.began(room, label)
    }

    /** Worker. The ring ran its 30 s unanswered. */
    private fun onRingTimeout(s: Session, room: String) {
        if (destroyed || s !== session) return
        if (s.gate.onTimeout(room) is RingAction.Missed) finishRing(s, room, missed = true)
    }

    /** Worker. A ring over: [missed] when nobody answered, else (joined elsewhere) quietly. */
    private fun finishRing(s: Session, room: String, missed: Boolean) {
        val name = s.ended(room)
        if (missed && name != null) {
            // The ring ran out of time on the worker while a stop was being asked for: a "Missed call" posted
            // after the stop's clear would outlive it, so it goes through the same gate as every post.
            unlessStopped { s.ringer.missed(room, name) }
        } else {
            s.ringer.stop(room)
        }
        Log.i(TAG, if (missed) "the call rang out: a missed call" else "the ring is over")
    }

    /** Worker. Somebody declined: only your own decline, from another of your devices, ends this ring. */
    private fun onCallDeclined(s: Session, payload: JSONObject) {
        if (s !== session) return
        val me = s.directory.me ?: return
        val declined = CallEvents.declined(payload) ?: return
        // Someone you called declining is for the caller's screen; a phone that rings is never the caller's.
        if (declined.userId != me.id) return
        s.endRing(declined.room)
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
