/**
 * Is this URL safe for the music service to fetch?
 *
 * This is the first thing in Skycord that takes a URL from a member and makes
 * the SERVER go and get it. PRODUCT.md's whole premise is that the server
 * runs on hardware the host already owns, which in practice is a box on a
 * home LAN — next to a router admin page, a NAS, a Home Assistant install,
 * and whatever else has no authentication because it is "only on the local
 * network". `/play http://192.168.1.1/reboot` must do nothing.
 *
 * ## Why this is not a denylist on the string
 *
 * Checking the text of a URL loses, and the ways it loses are all known:
 *
 *   http://2130706433/        decimal for 127.0.0.1
 *   http://0x7f.0.0.1/        hex
 *   http://[::ffff:192.168.1.1]/   IPv6-mapped IPv4
 *   http://0.0.0.0/           localhost on Linux
 *   http://nip.io hostnames   public name, private answer
 *   a 302 to any of the above
 *   DNS rebinding             public on the first lookup, 127.0.0.1 on the second
 *
 * So the check is on the RESOLVED ADDRESS, never on the text. Resolving also
 * disposes of every encoding trick above for free: whatever notation the
 * attacker wrote, the resolver hands back an address, and an address is
 * something we can judge.
 *
 * ## Why the caller must connect by IP
 *
 * Validating a hostname and then handing that hostname to an HTTP client
 * re-opens the hole: the client does its own lookup, and a DNS server under
 * the attacker's control can answer differently the second time. That is
 * rebinding, and it defeats any amount of checking done beforehand.
 *
 * `check()` therefore returns the address it approved. The caller connects to
 * THAT, with `Host` set to the original hostname, and never resolves again.
 *
 * ## This is the second line, not the first
 *
 * The music container has egress to private address space blocked at the
 * firewall. That is the control that holds when this file has a bug, and it
 * is why this file being careful is not the same as this file being trusted.
 */
import { promises as dns } from 'dns'
import { isIP } from 'net'

export type GuardResult =
  | { ok: true; address: string; family: 4 | 6; hostname: string; port: number; href: string }
  | { ok: false; reason: string }

/** Extensions the service will play. Checked here so nothing else has to. */
const AUDIO = /\.(mp3|ogg|oga|opus|flac|wav|m4a|aac)$/i

const bad = (reason: string): GuardResult => ({ ok: false, reason })

/** a.b.c.d -> a 32-bit number, for range maths. */
const v4 = (s: string): number => {
  const p = s.split('.').map(Number)
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]
}
const inV4 = (ip: string, cidr: string): boolean => {
  const [net, bits] = cidr.split('/')
  const mask = bits === '0' ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0
  return (v4(ip) & mask) === (v4(net) & mask)
}

/**
 * Everything that is not the public internet.
 *
 * Carrier-grade NAT (100.64/10) is here because on a home connection behind
 * CGNAT it addresses other subscribers' equipment. The documentation and
 * benchmark ranges are here because they are not routable and a request to
 * one is always a mistake or a probe.
 */
const V4_BLOCKED = [
  '0.0.0.0/8',          // "this network" — 0.0.0.0 is localhost on Linux
  '10.0.0.0/8',         // private
  '100.64.0.0/10',      // carrier-grade NAT
  '127.0.0.0/8',        // loopback
  '169.254.0.0/16',     // link-local — includes 169.254.169.254, cloud metadata
  '172.16.0.0/12',      // private
  '192.0.0.0/24',       // IETF protocol assignments
  '192.0.2.0/24',       // TEST-NET-1
  '192.88.99.0/24',     // 6to4 relay anycast
  '192.168.0.0/16',     // private
  '198.18.0.0/15',      // benchmarking
  '198.51.100.0/24',    // TEST-NET-2
  '203.0.113.0/24',     // TEST-NET-3
  '224.0.0.0/4',        // multicast
  '240.0.0.0/4',        // reserved, and 255.255.255.255 broadcast within it
]

const v6Blocked = (raw: string): string | null => {
  const ip = raw.toLowerCase().split('%')[0]          // strip any zone index
  if (ip === '::' || ip === '::1') return 'loopback or unspecified'
  /*
   * An IPv4 address wearing an IPv6 coat. Judge the v4 underneath.
   *
   * Both notations, because they are the same address and only one of them
   * survives a URL: `new URL('http://[::ffff:10.0.0.1]/')` normalises the
   * hostname to `[::ffff:a00:1]`, so the dotted form never reaches here from
   * a parsed URL. A version of this that knew only the dotted form passed
   * ::ffff:10.0.0.1 straight through — caught by the test that goes through
   * check() rather than calling this directly, which is the reason to have
   * both kinds of test.
   */
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)
  if (dotted) return v4Blocked(dotted[1])
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip)
  if (hex) {
    const n = ((parseInt(hex[1], 16) << 16) >>> 0) + parseInt(hex[2], 16)
    return v4Blocked([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'))
  }
  if (/^f[cd]/.test(ip)) return 'unique local address'          // fc00::/7
  if (/^fe[89ab]/.test(ip)) return 'link-local'                 // fe80::/10
  if (/^ff/.test(ip)) return 'multicast'                        // ff00::/8
  if (ip.startsWith('64:ff9b:')) return 'NAT64'
  if (ip.startsWith('2001:db8:')) return 'documentation range'
  if (/^0*100:/.test(ip)) return 'discard prefix'               // 100::/64
  return null
}

const v4Blocked = (ip: string): string | null => {
  const hit = V4_BLOCKED.find(c => inV4(ip, c))
  return hit ? `not a public address (${hit})` : null
}

/** null when the address is fine, otherwise why it is not. */
export const addressBlocked = (address: string): string | null => {
  const fam = isIP(address)
  if (fam === 4) return v4Blocked(address)
  if (fam === 6) return v6Blocked(address)
  return 'not an IP address'
}

export interface GuardOptions {
  /** Injectable so the tests do not need a resolver or a network. */
  resolve?: (hostname: string) => Promise<{ address: string; family: number }[]>
  /** Skip the audio-extension check, for a redirect hop mid-chain. */
  anyExtension?: boolean
}

const realResolve = (hostname: string) => dns.lookup(hostname, { all: true, verbatim: true })

/**
 * Approve a URL, or say why not.
 *
 * On success the caller gets the address to connect to. Connect to that, set
 * `Host` to `hostname`, and do not resolve again — see the note above.
 */
export const check = async (raw: string, opts: GuardOptions = {}): Promise<GuardResult> => {
  let u: URL
  try { u = new URL(raw) } catch { return bad('not a URL') }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return bad(`scheme ${u.protocol} is not allowed`)
  if (u.username || u.password) return bad('credentials in a URL are not allowed')
  if (!opts.anyExtension && !AUDIO.test(u.pathname)) return bad('not an audio file')

  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return bad('bad port')

  // A literal address needs no resolver, and must still be judged.
  const literal = u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal)) {
    const why = addressBlocked(literal)
    if (why) return bad(why)
    return { ok: true, address: literal, family: isIP(literal) as 4 | 6, hostname: u.hostname, port, href: u.href }
  }

  let answers: { address: string; family: number }[]
  try {
    answers = await (opts.resolve ?? realResolve)(u.hostname)
  } catch {
    return bad('the hostname does not resolve')
  }
  if (!answers.length) return bad('the hostname does not resolve')

  /*
   * EVERY answer, not the first.
   *
   * A hostname that returns one public address and one private one is the
   * cheapest rebinding setup there is: validate the public one, then let the
   * HTTP client pick either. Any private answer disqualifies the name.
   */
  for (const a of answers) {
    const why = addressBlocked(a.address)
    if (why) return bad(`${u.hostname} resolves to ${a.address}: ${why}`)
  }

  const first = answers[0]
  return { ok: true, address: first.address, family: (isIP(first.address) as 4 | 6), hostname: u.hostname, port, href: u.href }
}
