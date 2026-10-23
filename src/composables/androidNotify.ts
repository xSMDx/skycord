/**
 * The page's side of the Android app's notifications.
 *
 * The app posts them itself while it is in the background, from a service that
 * outlives the page, so the page must step aside then: two voices for one
 * message is a bug. In front, the page keeps its sounds and its ring, as it
 * always has. Pure, so the rule is tested without a WebView.
 */

/**
 * Whether the page sounds a message or rings a call. False only inside the
 * Android app while it is in the background — the service has that.
 */
export const alertsBelongToPage = (platform: string | undefined, backgrounded: boolean): boolean =>
  !(platform === 'android' && backgrounded)

/** The toast for someone declining the call you are in. */
export const declinedText = (name: string): string => `${name} declined`

/**
 * Whether this is the first time `userId` has declined `room`'s call, noting it
 * if so. The server does not throttle `call:decline`, so a double tap would
 * otherwise toast twice. The caller clears the set when it leaves the call.
 */
export const firstDecline = (seen: Set<string>, room: string, userId: string): boolean => {
  const key = `${room}\u0000${userId}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
}
