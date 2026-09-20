/**
 * Legal documents on the client: the kinds and their titles, the shape of the
 * instance profile, and small pure helpers the surfaces share.
 *
 * LEGAL_KINDS and UPSTREAM_REPO mirror server/utils/legalKinds.ts, and
 * legalDocs.test.ts holds them equal. Titles live only here: the server sends
 * kinds, and every surface names them the same way.
 */
export const LEGAL_KINDS = ['terms', 'privacy', 'guidelines', 'cookies', 'copyright', 'imprint'] as const
export type LegalKind = typeof LEGAL_KINDS[number]

export const LEGAL_TITLES: Record<LegalKind, string> = {
  terms:      'Terms of Service',
  privacy:    'Privacy Policy',
  guidelines: 'Community Guidelines',
  cookies:    'Cookie Policy',
  copyright:  'Copyright & Takedowns',
  imprint:    'Imprint',
}

/** Where Skycord's source is: used when the profile cannot be fetched, because
 *  the AGPL's offer of the source must not depend on the server answering. */
export const UPSTREAM_REPO = 'https://github.com/xSMDx/skycord'

export type DocumentEntry = { kind: LegalKind; source: 'document'; href: string; updated: string }
export type LegalEntry = { kind: LegalKind; source: 'url'; href: string } | DocumentEntry

export interface Contact { kind: 'email' | 'url' | 'text'; value: string }

export interface InstanceProfile {
  software: 'skycord'
  version: string
  address: string
  name: string
  nameIsAddress: boolean
  description: string | null
  operator: string | null
  contact: Contact | null
  icon: string | null
  legal: LegalEntry[]
  source: string
}

/**
 * "2026-09-02" as the reader's own short date. Built from its parts, because
 * new Date('2026-09-02') is UTC midnight — the previous day anywhere west of
 * Greenwich.
 */
export const formatUpdated = (iso: string): string => {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
