/**
 * The legal documents an instance can publish, in the order every surface
 * lists them. The client keeps a mirror in src/composables/legalDocs.ts —
 * tsconfig.server.json pins rootDir to server/, so the two cannot import each
 * other — and legalDocs.test.ts holds them equal.
 *
 * No imports here, on purpose: that test imports this file from the client's
 * side, where server-only modules do not resolve.
 */
export const LEGAL_KINDS = ['terms', 'privacy', 'guidelines', 'cookies', 'copyright', 'imprint'] as const
export type LegalKind = typeof LEGAL_KINDS[number]

/** The .env variable that publishes each kind as a link. */
export const LEGAL_URL_VARS: Record<LegalKind, string> = {
  terms:      'TERMS_URL',
  privacy:    'PRIVACY_URL',
  guidelines: 'GUIDELINES_URL',
  cookies:    'COOKIES_URL',
  copyright:  'COPYRIGHT_URL',
  imprint:    'IMPRINT_URL',
}

/** The one file in INSTANCE_DIR that publishes each kind as a document. */
export const legalFile = (kind: LegalKind): string => `${kind}.md`

export const isLegalKind = (value: string): value is LegalKind =>
  (LEGAL_KINDS as readonly string[]).includes(value)

/**
 * Where Skycord's source is when a host has not changed the code. Skycord is
 * AGPL v3: every instance owes its members the source of what they are using.
 * Mirrored by the client for when the profile cannot be fetched.
 */
export const UPSTREAM_REPO = 'https://github.com/xSMDx/skycord'
