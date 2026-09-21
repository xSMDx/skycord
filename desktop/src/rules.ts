/**
 * The shell's security rules, as pure functions so they can be tested without
 * Electron. The instance's page is trusted only as far as its own origin: it
 * may navigate within it and use a chat app's permissions, and nothing more.
 * A self-hosted instance is somebody else's server — these rules are what
 * keep a hostile page from reaching the machine.
 */

const originOf = (url: string): string | null => {
  try { return new URL(url).origin } catch { return null }
}

/** True only for a URL on exactly the chosen origin (scheme, host and port). */
export const sameOrigin = (url: string, origin: string | null): boolean => {
  if (!origin) return false
  const o = originOf(url)
  return o !== null && o !== 'null' && o === origin
}

/** Only web links may leave the app for the system browser. */
export const externalSafe = (url: string): boolean => {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** What a chat client needs: calls, notifications, copying invite links, fullscreen video, choosing an output device. */
const GRANTED = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection'])

export const permissionAllowed = (permission: string, requestingUrl: string, origin: string | null): boolean =>
  GRANTED.has(permission) && sameOrigin(requestingUrl, origin)

/**
 * Whether an origin needs Chromium told to treat it as secure. Microphone and
 * camera are only offered to secure origins; https is one, and so is localhost.
 * A self-hosted server at http://192.168.1.5 is not — without this switch its
 * members could not talk. The switch only takes effect at startup, which is
 * why choosing such a server restarts the app once.
 */
export const needsSecureOriginSwitch = (origin: string | null): boolean => {
  if (!origin) return false
  let url: URL
  try { url = new URL(origin) } catch { return false }
  if (url.protocol !== 'http:') return false
  return !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}
