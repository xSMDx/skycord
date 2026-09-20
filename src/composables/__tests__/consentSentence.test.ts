import { describe, it, expect } from 'vitest'
import { consentSentence, type Segment } from '../consentSentence'
import type { InstanceProfile, LegalEntry } from '../legalDocs'

const TERMS: LegalEntry = { kind: 'terms', source: 'url', href: 'https://example.com/terms' }
const PRIVACY: LegalEntry = { kind: 'privacy', source: 'document', href: '/instance/legal/privacy', updated: '2026-09-02' }
const IMPRINT: LegalEntry = { kind: 'imprint', source: 'url', href: 'https://example.com/imprint' }

const profile = (legal: LegalEntry[], named: boolean): InstanceProfile => ({
  software: 'skycord', version: 'v0.20.0', address: 'https://chat.example.com',
  name: named ? 'Sky Den' : 'chat.example.com', nameIsAddress: !named,
  description: null, operator: null, contact: null, icon: null, legal, source: 'https://example.com/src',
})

/** The sentence as a reader sees it, with [brackets] marking the links. */
const read = (segments: Segment[]) => segments.map(s => (s.link ? `[${s.text}]` : s.text)).join('')

describe('consentSentence', () => {
  it.each([
    [[TERMS, PRIVACY], true,  "By registering you agree to Sky Den's [Terms] and [Privacy Policy]."],
    [[TERMS],          true,  "By registering you agree to Sky Den's [Terms]."],
    [[PRIVACY],        true,  "By registering you agree to Sky Den's [Privacy Policy]."],
    [[TERMS, PRIVACY], false, 'By registering you agree to the [Terms] and [Privacy Policy] of chat.example.com.'],
    [[TERMS],          false, 'By registering you agree to the [Terms] of chat.example.com.'],
    [[PRIVACY],        false, 'By registering you agree to the [Privacy Policy] of chat.example.com.'],
  ] as const)('%# reads as the spec table says', (legal, named, expected) => {
    expect(read(consentSentence(profile([...legal], named)))).toBe(expected)
  })

  it('has no sentence without terms or privacy, whatever else is published', () => {
    expect(consentSentence(profile([IMPRINT], true))).toEqual([])
    expect(consentSentence(profile([], false))).toEqual([])
  })

  it('has no sentence while the profile is loading or failed', () => {
    expect(consentSentence(null)).toEqual([])
  })

  it('links each document to its own entry', () => {
    const links = consentSentence(profile([TERMS, PRIVACY], true)).filter(s => s.link).map(s => s.link)
    expect(links).toEqual([TERMS, PRIVACY])
  })
})
