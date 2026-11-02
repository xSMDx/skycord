package xyz.skycord.android.core

enum class BackAction { DONE, TO_BACKGROUND }

/**
 * The back button is offered to the page first. The page answers whether it
 * used it; if it says nothing within the timeout it counts as unused, so a
 * hung page cannot trap the button. Only the newest press counts.
 */
class BackGate(val timeoutMs: Long = 300) {
    private var seq = 0
    private var pending: Int? = null

    fun ask(): Int {
        seq += 1
        pending = seq
        return seq
    }

    fun answer(id: Int, used: Boolean): BackAction? =
        settle(id)?.let { if (used) BackAction.DONE else BackAction.TO_BACKGROUND }

    fun timeout(id: Int): BackAction? = settle(id)?.let { BackAction.TO_BACKGROUND }

    private fun settle(id: Int): Unit? {
        if (pending != id) return null
        pending = null
        return Unit
    }
}
