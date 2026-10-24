package xyz.skycord.android.core

/**
 * What POST /auth/refresh's status code means for the background sign-in. The
 * server answers 200 with a token, or 401 (with a clearing cookie) for a
 * missing, revoked or expired sign-in, and nothing else about the sign-in. It
 * never sends 403 from there, so a 403 comes from a proxy or firewall in
 * between and must not sign the phone out; 429, 5xx and redirects do not
 * either. Only a 200 and a 401 carry cookies the web client has to hear about.
 */
object RefreshStatus {
    enum class Outcome { TOKEN, SIGNED_OUT, UNREACHABLE }

    fun outcomeOf(status: Int): Outcome = when (status) {
        200 -> Outcome.TOKEN
        401 -> Outcome.SIGNED_OUT
        else -> Outcome.UNREACHABLE
    }

    fun writesBack(status: Int): Boolean = status == 200 || status == 401
}
