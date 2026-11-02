package xyz.skycord.android.notify

import android.util.Log
import io.socket.client.IO
import io.socket.client.Manager
import io.socket.client.Socket
import io.socket.engineio.client.Transport
import io.socket.engineio.client.transports.WebSocket
import org.json.JSONObject
import xyz.skycord.android.core.LastPacket
import xyz.skycord.android.core.ReconnectCounter
import java.net.URI
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * The one socket.io connection the background service keeps to a server — the
 * same real-time channel the web client uses, signed in as the person.
 *
 *  - **Background.** It connects with `auth: { token, background: true }`, so the
 *    server leaves it out of presence (the person does not look online because a
 *    phone is in a pocket) and refuses it a seat in a call; it still receives
 *    everything the person's other sockets do.
 *  - **Reconnecting** is done here, not by the client library (its own is off):
 *    after a drop or a failed try it waits [ReconnectCounter] — 1 s, doubling, at most a
 *    minute — and the count starts again only when the service says the session is
 *    usable ([markReady]), not when the socket merely connects: a server whose socket
 *    works and whose REST does not would otherwise be retried every second for ever.
 *  - **Proof of life.** Every packet that arrives (any event, and the engine's own
 *    ping and pong) is noted with the server-clock time, in [lastPacketAt]; catch-up's
 *    cursor never moves past it.
 *  - **The token** comes from [ServerApi], which keeps it. A handshake the server
 *    refuses for the token (`connect_error` carrying the server's message, not a
 *    network error) gets one fresh token and an immediate retry; refused again, it
 *    waits its backoff like any failure. So the rate-limited `/auth/refresh` is
 *    asked about once per backoff step at worst, never per reconnect blindly.
 *  - **Signed out** (no sign-in, or the server no longer honours it) ends it:
 *    [Listener.onSignedOut], and no further tries.
 *
 * Every method must be called on [worker], and every listener and event handler
 * runs there too, so the service's state needs no locks. Each socket made is
 * numbered; a callback from one that has since been replaced is dropped.
 *
 * Events are handled by name ([on]): the messages and presence today; Task 12
 * adds `call:state` and `call:declined` the same way, and sends `call:decline`
 * with [emit].
 */
internal class LiveConnection(
    private val api: ServerApi,
    private val worker: ScheduledExecutorService,
    private val listener: Listener,
) {
    interface Listener {
        /** A connect succeeded. */
        fun onConnected()

        /** An established connection dropped; a retry is already scheduled. */
        fun onDisconnected()

        /** The sign-in is over. Nothing more will be tried. */
        fun onSignedOut()
    }

    private val handlers = LinkedHashMap<String, (JSONObject) -> Unit>()
    private val signals = LinkedHashMap<String, () -> Unit>()
    private var socket: Socket? = null
    private var generation = 0
    private val failures = ReconnectCounter()
    private val lastPacket = LastPacket()
    private var authRetried = false
    private var pending: ScheduledFuture<*>? = null
    private var stopped = true

    /** Whether the socket is connected right now. */
    var connected = false
        private set

    /** Server-clock time of the last packet this socket received, or null when none has since it was made. */
    val lastPacketAt: Long? get() = lastPacket.at

    /** The session is usable (the socket is up and the account loaded): the next failure waits the first wait again. */
    fun markReady() {
        failures.markReady()
    }

    /** Handle [event] (its first argument, a JSON object) on [worker]. Register before [start]. */
    fun on(event: String, handler: (JSONObject) -> Unit) {
        handlers[event] = handler
    }

    /**
     * Handle [event] on [worker] when it says only that something happened: it carries no payload (`on` skips an
     * event that has none), and whatever it does carry is ignored. Register before [start].
     */
    fun onSignal(event: String, handler: () -> Unit) {
        signals[event] = handler
    }

    fun start() {
        if (!stopped) return
        stopped = false
        failures.reset()
        connect()
    }

    /** Closes the socket for good: no more tries, no more callbacks. */
    fun stop() {
        stopped = true
        cancelPending()
        closeSocket()
    }

    /** If waiting out a backoff, try now (the network came back, or the app was opened). */
    fun retryNow() {
        if (stopped || connected || pending == null) return
        cancelPending()
        connect()
    }

    /** Drop the socket and connect again straight away, with whatever token [ServerApi] holds now. */
    fun restart() {
        if (stopped) return
        cancelPending()
        closeSocket()
        failures.reset()
        connect()
    }

    /**
     * A connection that cannot be used (the service could not load what it needs
     * after connecting): drop it and try again after the backoff.
     */
    fun fail() {
        if (stopped) return
        closeSocket()
        scheduleRetry()
    }

    /** Sends [event] if connected. True when it went out. */
    fun emit(event: String, payload: JSONObject): Boolean {
        val s = socket ?: return false
        if (!connected) return false
        s.emit(event, payload)
        return true
    }

    // ---- connecting -----------------------------------------------------------------------------

    private fun connect() {
        pending = null
        if (stopped) return
        when (val auth = api.token()) {
            is AuthResult.Token -> open(auth.value)
            AuthResult.SignedOut -> { stopped = true; listener.onSignedOut() }
            AuthResult.Unreachable -> scheduleRetry()
        }
    }

    private fun open(token: String) {
        closeSocket()
        val gen = ++generation
        val opts = IO.Options().apply {
            forceNew = true
            reconnection = false
            // The web client goes websocket-first too; one transport, no upgrade dance.
            transports = arrayOf(WebSocket.NAME)
            timeout = CONNECT_TIMEOUT_MS
            auth = authOf(token)
        }
        val s = try {
            IO.socket(URI(api.origin), opts)
        } catch (e: Exception) {
            Log.w(TAG, "couldn’t make a socket for the server: ${e.javaClass.simpleName}")
            scheduleRetry()
            return
        }
        lastPacket.clear() // a new socket has heard nothing yet; the dead one's last packet vouches for nothing of it
        // Every engine.io packet, pings and pongs included: the manager hands the transport on as it is made.
        // (A transport that never reports is no harm: the events below count too, and the cursor only waits.)
        s.io().on(Manager.EVENT_TRANSPORT) { args ->
            (args.firstOrNull() as? Transport)?.on(Transport.EVENT_PACKET) { heard(gen) }
        }
        s.on(Socket.EVENT_CONNECT) {
            // The connect is a packet too: stamped here, on the socket's thread, as every other is. Taken
            // on the worker instead it would be stamped after whatever was queued ahead of it, a long
            // delay later than it arrived, and the cursor could be moved past what was received. (Queued
            // first, so it lands before onConnect runs.)
            heard(gen)
            post(gen) { onConnect() }
        }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            // The server's own refusal (its middleware's `next(new Error(…))`) arrives as a JSON
            // object; a network failure or a timeout as an exception.
            val refused = args.firstOrNull() is JSONObject
            post(gen) { onConnectError(refused) }
        }
        s.on(Socket.EVENT_DISCONNECT) { args ->
            val reason = args.firstOrNull() as? String
            post(gen) { onDisconnect(reason) }
        }
        for ((event, handler) in handlers) {
            s.on(event) { args ->
                val payload = args.firstOrNull() as? JSONObject ?: return@on
                heard(gen)
                post(gen) { handler(payload) }
            }
        }
        for ((event, handler) in signals) {
            s.on(event) {
                heard(gen)
                post(gen) { handler() }
            }
        }
        socket = s
        s.connect()
    }

    private fun onConnect() {
        Log.i(TAG, "connected")
        connected = true
        // Not a reset of the backoff: a connected socket proves nothing about the session (markReady does).
        failures.connected()
        authRetried = false
        listener.onConnected()
    }

    private fun onConnectError(refused: Boolean) {
        closeSocket()
        if (refused && !authRetried) {
            // The token, most likely: it has run out. One fresh one, and straight back.
            Log.i(TAG, "the server refused the handshake; trying once with a fresh token")
            authRetried = true
            api.invalidate()
            connect()
            return
        }
        scheduleRetry()
    }

    private fun onDisconnect(reason: String?) {
        if (reason == CLIENT_DISCONNECT) return // ours; closeSocket already moved on
        Log.i(TAG, "the connection dropped ($reason)")
        closeSocket()
        // A server that hangs up on us may have ended the sign-in; the next try asks afresh.
        if (reason == SERVER_DISCONNECT) api.invalidate()
        scheduleRetry()
        listener.onDisconnected()
    }

    private fun scheduleRetry() {
        if (stopped) return
        cancelPending()
        val delay = failures.failed()
        Log.i(TAG, "trying again in ${delay / 1000} s")
        // After a wait, a refused token earns one more fresh one.
        authRetried = false
        pending = try {
            worker.schedule({ connect() }, delay, TimeUnit.MILLISECONDS)
        } catch (e: RejectedExecutionException) {
            null // the service is shutting down
        }
    }

    private fun cancelPending() {
        pending?.cancel(false)
        pending = null
    }

    private fun closeSocket() {
        connected = false
        generation++ // anything the old socket still says is dropped
        val s = socket ?: return
        socket = null
        s.off()
        s.close()
    }

    /** Any socket thread: a packet arrived on the socket numbered [gen]. Stamped now, stored on the worker. */
    private fun heard(gen: Int) {
        val serverAt = api.serverNow()
        post(gen) { lastPacket.heard(serverAt) }
    }

    /** Runs [block] on [worker], unless the socket numbered [gen] has been replaced by then. */
    private fun post(gen: Int, block: () -> Unit) {
        try {
            worker.execute {
                try {
                    if (gen == generation && !stopped) block()
                } catch (e: RuntimeException) {
                    // An executor keeps a task's exception to itself; say where it was (never what: a
                    // message can quote a payload), and carry on with the next event.
                    Log.w(TAG, "an event went wrong: ${e.javaClass.simpleName} at ${e.stackTrace.firstOrNull()}")
                }
            }
        } catch (e: RejectedExecutionException) {
            // The service has stopped; nothing is listening.
        }
    }

    private companion object {
        const val TAG = "LiveConnection"
        const val CONNECT_TIMEOUT_MS = 20_000L
        const val CLIENT_DISCONNECT = "io client disconnect"
        const val SERVER_DISCONNECT = "io server disconnect"

        /**
         * `{ token, background: true }`. The library types `auth` as strings only, but it
         * hands the map straight to `new JSONObject(map)`, which keeps a Boolean a JSON
         * boolean — and the server checks `background === true`, so the string "true"
         * would not do. The cast is unchecked on purpose; nothing reads the map as strings.
         */
        @Suppress("UNCHECKED_CAST")
        fun authOf(token: String): Map<String, String> =
            hashMapOf<String, Any>("token" to token, "background" to true) as Map<String, String>
    }
}
