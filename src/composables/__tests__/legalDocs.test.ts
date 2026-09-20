/// <reference types="node" />
/**
 * The client's list of legal kinds mirrors the server's. They cannot import
 * each other — tsconfig.server.json pins rootDir to server/ — so this test,
 * where both trees are reachable, is what stops them drifting apart: a kind
 * added on the server and forgotten here would be a document the app has no
 * title for.
 */
import { describe, it, expect } from 'vitest'
import { LEGAL_KINDS as SERVER_KINDS, UPSTREAM_REPO as SERVER_REPO } from '../../../server/utils/legalKinds'
import { LEGAL_KINDS, LEGAL_TITLES, UPSTREAM_REPO, formatUpdated } from '../legalDocs'

describe('the legal kinds mirror', () => {
  it('lists the same kinds as the server, in the same order', () => {
    expect([...LEGAL_KINDS]).toEqual([...SERVER_KINDS])
  })

  it('points at the same upstream repository', () => {
    expect(UPSTREAM_REPO).toBe(SERVER_REPO)
  })

  it('has the fixed title for every kind', () => {
    expect(LEGAL_TITLES).toEqual({
      terms: 'Terms of Service',
      privacy: 'Privacy Policy',
      guidelines: 'Community Guidelines',
      cookies: 'Cookie Policy',
      copyright: 'Copyright & Takedowns',
      imprint: 'Imprint',
    })
  })
})

describe('formatUpdated', () => {
  it('shows the calendar day the server sent, in every time zone', () => {
    // new Date('2026-09-02') is UTC midnight, which is 1 September anywhere
    // west of Greenwich. The helper must build a local date from the parts.
    const local = new Date(2026, 8, 2).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    expect(formatUpdated('2026-09-02')).toBe(local)
  })
})
