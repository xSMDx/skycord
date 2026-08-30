/**
 * Email, via Resend.
 *
 * Their HTTP API directly rather than the `resend` SDK: it is one POST with a
 * bearer token, and a dependency that sits in the password-reset path is a
 * dependency that has to be audited and kept current forever. Node 22 has
 * global fetch, so there is nothing to install.
 *
 * Optional by design. An instance with no RESEND_API_KEY runs fine; password
 * reset is simply unavailable and the UI says so, the same way the GIF picker
 * does. Self-hosters should not have to sign up for a mail provider to run a
 * chat server for six friends.
 */
import { config } from '../config/env'

const API = 'https://api.resend.com/emails'
/** A hung provider must not hold an auth request open. */
const TIMEOUT_MS = 10_000

/** Whether this instance can send mail at all. Callers branch on it rather
 *  than discovering it from a failed send. */
export const emailEnabled = (): boolean =>
  Boolean(config.email.resendApiKey && config.email.from)

interface SendArgs { to: string; subject: string; html: string; text: string }

/**
 * Returns true if the provider accepted the message.
 *
 * Never throws. The one caller is the forgot-password endpoint, which must
 * answer identically whether or not the address exists — so a send failure
 * cannot be allowed to change the shape of that response. Failures are logged
 * server-side, where an operator can see them and an attacker cannot.
 */
export const sendEmail = async ({ to, subject, html, text }: SendArgs): Promise<boolean> => {
  if (!emailEnabled()) return false

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(API, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${config.email.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: config.email.from, to, subject, html, text }),
    })
    if (!res.ok) {
      // Body, not just status: Resend explains an unverified sending domain
      // here, which is the single most common reason a correct-looking setup
      // sends nothing.
      console.warn('[email] send failed', res.status, await res.text().catch(() => ''))
      return false
    }
    return true
  } catch (err) {
    console.warn('[email] send error', (err as Error).message)
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The reset email.
 *
 * Plain text alongside the HTML because some clients render only that, and a
 * password reset that arrives blank is a support ticket. The link is the only
 * thing in it — no logo, no tracking pixel, nothing that would make a spam
 * filter look twice at mail people need to receive.
 */
export const resetPasswordEmail = (link: string, minutes: number) => ({
  subject: 'Reset your Skycord password',
  text:
    `Someone asked to reset the password on your Skycord account.\n\n` +
    `${link}\n\n` +
    `The link works once and expires in ${minutes} minutes.\n\n` +
    `If this wasn't you, ignore this email — nothing has changed, and your ` +
    `password stays as it is.`,
  html:
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#111">` +
    `<p>Someone asked to reset the password on your Skycord account.</p>` +
    `<p><a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#5865F2;color:#fff;text-decoration:none;font-weight:600">Reset password</a></p>` +
    `<p style="color:#555;font-size:13px">The link works once and expires in ${minutes} minutes.</p>` +
    `<p style="color:#555;font-size:13px">If this wasn't you, ignore this email — nothing has changed, and your password stays as it is.</p>` +
    `</div>`,
})
