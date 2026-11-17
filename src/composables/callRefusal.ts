/**
 * Whether a failed voice token request was the server refusing the call.
 *
 * A join retries a failure fourteen times, 1.6 s apart, before it gives up.
 * That is right for whatever may pass on a later try — no network, a 5xx, a
 * media server that is busy — and wrong for a refusal, which gets the same
 * answer every time. A 4xx answer is a refusal, except:
 * - 429, too many requests: it passes once the window does.
 * - 401: the session lapsed, it was not the call that was refused. The
 *   access token is refreshed on a timer and whenever the socket is turned
 *   away, and the next try carries the new one.
 *
 * Read from what useApi throws for a failed response: the body, with
 * `status` added. Nothing without a whole-number status is a refusal: a
 * network that is down, a body that would not parse. Only the token request's
 * failures are judged by this at all — LiveKit's connection errors carry a
 * status too, and useVoice retries every one of them.
 */
export interface CallRefusal {
  /** The server's own words for it; null when it gave none, and the surfaces say "Couldn’t connect". */
  reason: string | null
}

/** The 4xx answers that may still pass on a later try. */
const PASSING = new Set([401, 429])

export const callRefusal = (err: unknown): CallRefusal | null => {
  if (typeof err !== 'object' || err === null) return null
  const { status, message } = err as { status?: unknown; message?: unknown }
  if (typeof status !== 'number' || !Number.isInteger(status)) return null
  if (status < 400 || status > 499 || PASSING.has(status)) return null
  const reason = typeof message === 'string' ? message.trim() : ''
  return { reason: reason || null }
}
