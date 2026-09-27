/**
 * Which address an invite link carries.
 *
 * A link was built from `location.origin` — whichever address the person who
 * made it happened to be using. That is fine when everyone reaches the server
 * the same way, and wrong the moment they do not: a link made on one address
 * cannot be opened by someone who only has the other, and the person who sent
 * it has no way to tell.
 *
 * So a link carries the address the SERVER says is its own (the instance
 * profile's `address`, which a host sets in the installer or in .env), and
 * falls back to the current one when that is missing or unusable.
 */

const loopback = (host: string) =>
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')

/**
 * @param address  what the instance profile reports, if anything
 * @param here     `location.origin` of the page making the link
 */
export const inviteBase = (address: string | null | undefined, here: string): string => {
  if (!address) return here
  let url: URL
  try { url = new URL(address) } catch { return here }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return here
  // A host whose .env still says localhost would otherwise hand out invites
  // nobody else can open. The address being wrong is not the sender's problem
  // to discover, so the page they are actually on wins.
  if (loopback(url.host.split(':')[0]) && !loopback(new URL(here).host.split(':')[0])) return here
  return url.origin
}
