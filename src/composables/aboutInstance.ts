/**
 * The rows of Settings › About this instance. A row with nothing to say is
 * omitted, not filled with "Not provided": an instance with nothing configured
 * shows its version and address and nothing that reads as broken.
 *
 * Legal documents are not here — the owner asked for them in a tab of their
 * own (Settings › Legal).
 */
import type { Contact, InstanceProfile } from './legalDocs'

export interface AboutRow { label: string; value: string; href?: string; external?: boolean }

const isHttp = (value: string) => /^https?:\/\//i.test(value)

const contactRow = (contact: Contact): AboutRow => {
  if (contact.kind === 'email') return { label: 'Contact', value: contact.value, href: `mailto:${contact.value}` }
  if (contact.kind === 'url' && isHttp(contact.value)) {
    return { label: 'Contact', value: contact.value, href: contact.value, external: true }
  }
  return { label: 'Contact', value: contact.value }
}

export const aboutRows = (profile: InstanceProfile): AboutRow[] => {
  const rows: AboutRow[] = []
  if (profile.operator) rows.push({ label: 'Run by', value: profile.operator })
  if (profile.contact) rows.push(contactRow(profile.contact))
  rows.push({ label: 'Version', value: profile.version })
  rows.push(isHttp(profile.address)
    ? { label: 'Address', value: profile.address, href: profile.address, external: true }
    : { label: 'Address', value: profile.address })
  return rows
}
