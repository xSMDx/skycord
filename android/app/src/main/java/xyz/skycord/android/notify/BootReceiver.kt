package xyz.skycord.android.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.webkit.CookieManager
import androidx.core.app.NotificationManagerCompat
import xyz.skycord.android.PrefsKeyValue
import xyz.skycord.android.core.RefreshCookie
import xyz.skycord.android.core.ServerStore

/**
 * Brings the background connection back without anyone opening the app: after the phone starts
 * (`BOOT_COMPLETED`) and after the app has been updated (`MY_PACKAGE_REPLACED`, which stops the
 * process; an in-app update must not leave the phone silent until the next time Skycord is opened).
 *
 * The same rule as the activity's, minus the screen: background notifications are on, Android lets
 * the app show them, and there is a last server. A server never signed in to gets no service, so no
 * "Signed out" notice either; where that cannot be told (the cookie store won't answer) the service
 * starts, and finds out for itself.
 *
 * `BOOT_COMPLETED` only, not `LOCKED_BOOT_COMPLETED`: before the first unlock the WebView's cookie
 * store, where the sign-in is, cannot be read. Both broadcasts are protected (only the system sends
 * them), and both are among the starts Android lets a foreground service make from the background;
 * the service's type, remoteMessaging, is one Android 15 still allows from boot.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val origin = ServerStore(PrefsKeyValue(context)).last()
        if (origin == null) {
            Log.i(TAG, "${intent.action}: no server to reconnect to")
            return
        }
        if (!NotifyService.isEnabled(context) || !NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            Log.i(TAG, "${intent.action}: background notifications are off or not allowed")
            return
        }
        if (!signedIn(origin)) {
            Log.i(TAG, "${intent.action}: not signed in to the last server")
            return
        }
        Log.i(TAG, "${intent.action}: starting the background connection")
        NotifyService.start(context, origin)
    }

    /** Whether [origin] holds a sign-in; true when that cannot be read, so the service decides. */
    private fun signedIn(origin: String): Boolean = try {
        RefreshCookie.from(CookieManager.getInstance().getCookie(origin)) != null
    } catch (e: Exception) {
        Log.w(TAG, "couldn’t read the sign-in: ${e.javaClass.simpleName}")
        true
    }

    private companion object {
        const val TAG = "BootReceiver"
    }
}
