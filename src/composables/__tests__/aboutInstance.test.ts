import { describe, it, expect } from 'vitest'
import { aboutRows } from '../aboutInstance'
import type { InstanceProfile } from '../legalDocs'

const base: InstanceProfile = {
  software: 'skycord', version: 'v0.20.0', address: 'https://chat.example.com',
  name: 'chat.example.com', nameIsAddress: true, description: null, operator: null,
  contact: null, icon: null, legal: [], source: 'https://example.com/src',
}

describe('aboutRows', () => {
  it('shows only version and address when nothing is configured', () => {
    expect(aboutRows(base)).toEqual([
      { label: 'Version', value: 'v0.20.0' },
      { label: 'Address', value: 'https://chat.example.com', href: 'https://chat.example.com', external: true },
    ])
  })

  it('adds who runs it and how to reach them, above version and address', () => {
    const rows = aboutRows({ ...base, operator: 'Sam Doe', contact: { kind: 'email', value: 'sam@example.com' } })
    expect(rows.map(r => r.label)).toEqual(['Run by', 'Contact', 'Version', 'Address'])
    expect(rows[1]).toEqual({ label: 'Contact', value: 'sam@example.com', href: 'mailto:sam@example.com' })
  })

  it('links a contact link in a new tab, and leaves plain text as text', () => {
    expect(aboutRows({ ...base, contact: { kind: 'url', value: 'https://example.com/c' } })[0])
      .toEqual({ label: 'Contact', value: 'https://example.com/c', href: 'https://example.com/c', external: true })
    expect(aboutRows({ ...base, contact: { kind: 'text', value: '@sky on Matrix' } })[0])
      .toEqual({ label: 'Contact', value: '@sky on Matrix' })
  })

  it('never links an address that is not http(s)', () => {
    expect(aboutRows({ ...base, address: 'javascript:alert(1)' }).at(-1))
      .toEqual({ label: 'Address', value: 'javascript:alert(1)' })
  })

  it('has no Terms or Privacy row: those live in Settings › Legal', () => {
    const rows = aboutRows({ ...base, legal: [{ kind: 'terms', source: 'url', href: 'https://e.example/t' }] })
    expect(rows.map(r => r.label)).not.toContain('Terms')
  })
})
