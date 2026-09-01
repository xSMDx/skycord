/**
 * User-Agent → a name a person recognises.
 *
 * Deliberately not a dependency. The well-known parsers carry hundreds of
 * regexes to distinguish devices nobody needs distinguished here, and one of
 * them (ua-parser-js) has been the subject of a supply-chain compromise. What
 * this screen needs is "Chrome on Windows" — enough to answer "is that me?" —
 * and the shortlist below covers essentially all real traffic.
 *
 * Order matters throughout. Every Chromium browser says "Chrome", every
 * WebKit browser says "Safari", and Edge says all three, so the most specific
 * claim has to be tested first.
 */

export interface ParsedAgent {
  browser: string
  os: string
  /** For picking an icon. */
  kind: 'desktop' | 'mobile' | 'tablet' | 'unknown'
  /** "Chrome on Windows", or the best available approximation. */
  label: string
}

const BROWSERS: [RegExp, string][] = [
  // Before Chrome: these all carry "Chrome" in their UA.
  [/\bEdgA?\//i,                 'Edge'],
  [/\bOPR\/|\bOpera\//i,         'Opera'],
  [/\bVivaldi\//i,               'Vivaldi'],
  [/\bBrave\//i,                 'Brave'],
  [/\bSamsungBrowser\//i,        'Samsung Internet'],
  [/\bYaBrowser\//i,             'Yandex'],
  // Before Safari: Chrome on iOS is WebKit and says "Safari" too.
  [/\bCriOS\//i,                 'Chrome'],
  [/\bFxiOS\//i,                 'Firefox'],
  [/\bChrome\/|\bChromium\//i,   'Chrome'],
  [/\bFirefox\/|\bFxQuantum/i,   'Firefox'],
  [/\bSafari\//i,                'Safari'],
  // Not browsers, but they hold refresh cookies and should be nameable.
  [/\bElectron\//i,              'Electron'],
  [/\bcurl\/|\bWget\//i,         'Command line'],
  [/\bPostmanRuntime\//i,        'Postman'],
  [/\bnode-fetch|\baxios\/|\bundici/i, 'Script'],
]

const OSES: [RegExp, string][] = [
  // Before Android: an Android UA also contains "Linux".
  [/\bWindows NT 10\.0|\bWindows NT 11/i, 'Windows'],
  [/\bWindows NT/i,             'Windows'],
  [/\bAndroid\b/i,              'Android'],
  // Before macOS: iPadOS 13+ reports itself as "Macintosh" and is separated
  // below by touch support, which the UA does not carry — so an iPad shows as
  // macOS, and that is the honest limit of UA parsing rather than a bug.
  [/\biPhone\b/i,               'iOS'],
  [/\biPad\b/i,                 'iPadOS'],
  [/\bMac OS X|\bMacintosh/i,   'macOS'],
  [/\bCrOS\b/i,                 'ChromeOS'],
  [/\bUbuntu\b/i,               'Ubuntu'],
  [/\bLinux\b|\bX11\b/i,        'Linux'],
]

const first = (table: [RegExp, string][], ua: string): string | null => {
  for (const [re, name] of table) if (re.test(ua)) return name
  return null
}

const kindOf = (ua: string, os: string): ParsedAgent['kind'] => {
  if (/\biPad\b/i.test(ua) || os === 'iPadOS') return 'tablet'
  if (/\bTablet\b/i.test(ua)) return 'tablet'
  // "Mobile" alone is the reliable marker; Android tablets omit it.
  if (/\bMobile\b|\biPhone\b|\bAndroid\b/i.test(ua)) return 'mobile'
  if (os === 'Windows' || os === 'macOS' || os === 'Linux' || os === 'Ubuntu' || os === 'ChromeOS') {
    return 'desktop'
  }
  return 'unknown'
}

export const parseUserAgent = (raw: unknown): ParsedAgent => {
  const ua = String(raw ?? '').slice(0, 512)
  if (!ua.trim()) {
    return { browser: 'Unknown browser', os: 'Unknown device', kind: 'unknown', label: 'Unknown device' }
  }

  const browser = first(BROWSERS, ua)
  const os = first(OSES, ua)
  const kind = kindOf(ua, os ?? '')

  // Never invent a name. A UA we cannot read is more useful shown as unknown
  // than confidently mislabelled — the whole point of the screen is deciding
  // whether a row is you, and a wrong label answers that question wrongly.
  const label =
    browser && os ? `${browser} on ${os}`
    : browser     ? browser
    : os          ? os
    :               'Unknown device'

  return {
    browser: browser ?? 'Unknown browser',
    os: os ?? 'Unknown device',
    kind,
    label,
  }
}
