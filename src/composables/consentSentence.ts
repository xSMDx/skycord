/**
 * The sentence under the register form, as segments the template renders:
 * plain text, and links to the Terms and Privacy Policy entries.
 *
 * Only those two: they are what someone agrees to by registering. Other
 * documents are listed under the sign-in card instead. No sentence at all
 * while the profile is loading or failed, or when neither is published — the
 * page must not claim terms it cannot show.
 *
 * "Terms" is the approved short wording here; every other surface uses the
 * full title from LEGAL_TITLES.
 */
import type { InstanceProfile, LegalEntry } from './legalDocs'

export interface Segment { text: string; link?: LegalEntry }

export const consentSentence = (profile: InstanceProfile | null): Segment[] => {
  if (!profile) return []
  const terms = profile.legal.find(e => e.kind === 'terms')
  const privacy = profile.legal.find(e => e.kind === 'privacy')
  const links: Segment[] = []
  if (terms) links.push({ text: 'Terms', link: terms })
  if (terms && privacy) links.push({ text: ' and ' })
  if (privacy) links.push({ text: 'Privacy Policy', link: privacy })
  if (links.length === 0) return []
  return profile.nameIsAddress
    ? [{ text: 'By registering you agree to the ' }, ...links, { text: ` of ${profile.name}.` }]
    : [{ text: `By registering you agree to ${profile.name}'s ` }, ...links, { text: '.' }]
}
