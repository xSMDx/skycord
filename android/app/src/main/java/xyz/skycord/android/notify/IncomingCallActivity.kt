package xyz.skycord.android.notify

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import xyz.skycord.android.R

/**
 * The incoming-call screen: who is calling, and Answer and Decline. A ring's full-screen
 * intent opens it, over the lock screen and turning the screen on (the manifest says
 * `showWhenLocked` and `turnScreenOn`); tapping the heads-up ring opens it too. Not exported:
 * only the ring's own PendingIntent reaches it.
 *
 *  - **Answer** opens the app joining the call. On a locked phone it first asks the keyguard
 *    to go away, so the person unlocks straight into the app — and if they back out of the
 *    unlock, the call is still ringing here.
 *  - **Decline** tells the service, which tells the server (the caller hears it), and closes.
 *  - **It closes itself when the ring ends** (the caller hung up, someone answered on another
 *    device, thirty seconds passed): [finishFor]. And it will not start for, or answer, a ring
 *    that has already ended ([CallRinger.isRinging]), so a late Answer can never start a new call.
 */
class IncomingCallActivity : AppCompatActivity() {
    private var room = ""
    private var origin = ""
    private var kind = ""
    private var convId = ""

    /** Answer is waiting on the keyguard; a second tap must not ask again. */
    private var answering = false

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        room = intent.getStringExtra(EXTRA_ROOM).orEmpty()
        origin = intent.getStringExtra(EXTRA_ORIGIN).orEmpty()
        kind = intent.getStringExtra(EXTRA_KIND).orEmpty()
        convId = intent.getStringExtra(EXTRA_CONV).orEmpty()
        val name = intent.getStringExtra(EXTRA_NAME).orEmpty()
        // Nothing to show for a call that is not ringing any more (the intent can arrive late, or be restored).
        if (room.isEmpty() || origin.isEmpty() || kind.isEmpty() || convId.isEmpty() || !CallRinger.isRinging(room)) {
            finish()
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
            // The manifest's showWhenLocked/turnScreenOn start at API 27; this is how API 26 asks.
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        // Held on while it rings: the phone must not go back to sleep with the call unanswered.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_incoming_call)
        // Drawn edge to edge on Android 15; keep the buttons clear of the bars.
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        findViewById<TextView>(R.id.call_name).text = name
        findViewById<TextView>(R.id.call_initial).text = name.codePoints().findFirst().let { cp ->
            if (cp.isPresent) String(Character.toChars(cp.asInt)).uppercase() else ""
        }
        findViewById<View>(R.id.call_answer).setOnClickListener { answer() }
        findViewById<View>(R.id.call_decline).setOnClickListener { decline() }
        open[room] = this
    }

    override fun onDestroy() {
        if (open[room] === this) open.remove(room)
        super.onDestroy()
    }

    private fun decline() {
        NotifyService.declineCall(this, room)
        finish()
    }

    private fun answer() {
        if (answering) return
        if (!CallRinger.isRinging(room)) { finish(); return }
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (keyguard == null || !keyguard.isKeyguardLocked) { openApp(); return }
        answering = true
        keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
            override fun onDismissSucceeded() = openApp()

            // The person backed out of the unlock: the call is still ringing.
            override fun onDismissCancelled() { answering = false }

            // Android would not ask (a keyguard it cannot dismiss): the app opens behind it, unlocked later.
            override fun onDismissError() = openApp()
        })
    }

    /** Joins the call in the app. The ring may have ended while the person was unlocking. */
    private fun openApp() {
        answering = false
        if (isFinishing || isDestroyed || !CallRinger.isRinging(room)) { finish(); return }
        startActivity(CallRinger.answerIntent(this, origin, room, kind, convId))
        finish()
    }

    companion object {
        private const val EXTRA_ROOM = "xyz.skycord.android.extra.CALL_ROOM"
        private const val EXTRA_ORIGIN = "xyz.skycord.android.extra.CALL_ORIGIN"
        private const val EXTRA_KIND = "xyz.skycord.android.extra.CALL_KIND"
        private const val EXTRA_CONV = "xyz.skycord.android.extra.CALL_CONV"
        private const val EXTRA_NAME = "xyz.skycord.android.extra.CALL_NAME"

        // The screens showing, by room. Main thread only.
        private val open = HashMap<String, IncomingCallActivity>()
        private val main = Handler(Looper.getMainLooper())

        /** The screen for a call: [name] is who is calling, the rest what Answer needs. */
        fun intent(context: Context, origin: String, room: String, name: String, kind: String, convId: String): Intent =
            Intent(context, IncomingCallActivity::class.java)
                .putExtra(EXTRA_ROOM, room)
                .putExtra(EXTRA_ORIGIN, origin)
                .putExtra(EXTRA_NAME, name)
                .putExtra(EXTRA_KIND, kind)
                .putExtra(EXTRA_CONV, convId)

        /** The ring for [room] is over: close its screen, if one is showing. From any thread. */
        fun finishFor(room: String) {
            main.post { open.remove(room)?.finish() }
        }
    }
}
