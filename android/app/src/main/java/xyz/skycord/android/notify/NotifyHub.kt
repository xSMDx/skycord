package xyz.skycord.android.notify

/**
 * The one way a notification's buttons reach the background service. A reply or a
 * dismiss means the person has dealt with a conversation, so its next message must
 * alert again — but the burst gate that decides that lives in the service, and a
 * receiver must not start a service to say so. The service puts itself here while
 * it runs; with none registered (the service is not running) there is no gate to
 * re-arm and nothing to do.
 *
 * In-process on purpose: both sides live in the same app process, so a plain
 * object is enough.
 */
object NotifyHub {
    /** Implemented by whatever owns the burst gates; today the background service. */
    fun interface Listener {
        fun rearm(convKey: String)
    }

    /** Set by the service when it starts, cleared when it stops. */
    @Volatile
    var listener: Listener? = null

    /** The person replied to or dismissed [convKey]: its next message alerts again. */
    fun rearm(convKey: String) {
        // Read once: the service may unregister between a null check and the call.
        listener?.rearm(convKey)
    }
}
