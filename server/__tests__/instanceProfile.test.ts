import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  readInstanceProfile, scanInstanceDir, instanceDir, classifyContact, LIMITS,
  type InstanceFiles,
} from '../utils/instanceProfile'
import { UPSTREAM_REPO } from '../utils/legalKinds'

const NO_FILES: InstanceFiles = { documents: {}, icons: [] }
const BASE = { APP_URL: 'https://chat.example.com', SKYCORD_VERSION: 'v0.20.0' }
const doc = (size = 100, modified = new Date('2026-09-02T10:00:00Z')) => ({ size, modified })

describe('readInstanceProfile: nothing configured', () => {
  it('still says what the software is, its version, address, name and source', () => {
    const { profile, warnings, iconFile } = readInstanceProfile(BASE, NO_FILES)
    expect(profile).toEqual({
      software: 'skycord',
      version: 'v0.20.0',
      address: 'https://chat.example.com',
      name: 'chat.example.com',
      nameIsAddress: true,
      description: null,
      operator: null,
      contact: null,
      icon: null,
      legal: [],
      source: `${UPSTREAM_REPO}/tree/v0.20.0`,
    })
    expect(iconFile).toBeNull()
    expect(warnings).toEqual([])
  })

  it('takes the address from APP_URL, then CLIENT_ORIGIN, then the development default', () => {
    expect(readInstanceProfile({ CLIENT_ORIGIN: 'https://a.example' }, NO_FILES).profile.address).toBe('https://a.example')
    const bare = readInstanceProfile({}, NO_FILES).profile
    expect(bare.address).toBe('http://localhost:5173')
    expect(bare.name).toBe('localhost')
    expect(bare.version).toBe('dev')
  })

  it('treats an empty or whitespace-only value as unset', () => {
    const { profile, warnings } = readInstanceProfile(
      { ...BASE, INSTANCE_NAME: '   ', INSTANCE_OPERATOR: '', TERMS_URL: ' ' }, NO_FILES)
    expect(profile.nameIsAddress).toBe(true)
    expect(profile.operator).toBeNull()
    expect(profile.legal).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe('readInstanceProfile: the text fields', () => {
  it('trims and uses each configured value', () => {
    const { profile } = readInstanceProfile({
      ...BASE,
      INSTANCE_NAME: '  Sky Den ',
      INSTANCE_DESCRIPTION: 'A server for our study group.',
      INSTANCE_OPERATOR: 'Sam Doe',
    }, NO_FILES)
    expect(profile.name).toBe('Sky Den')
    expect(profile.nameIsAddress).toBe(false)
    expect(profile.description).toBe('A server for our study group.')
    expect(profile.operator).toBe('Sam Doe')
  })

  it('shortens an over-long value by character, never cutting an emoji in half, and says so', () => {
    const { profile, warnings } = readInstanceProfile({ ...BASE, INSTANCE_NAME: '🎉'.repeat(LIMITS.name + 6) }, NO_FILES)
    expect(Array.from(profile.name)).toHaveLength(LIMITS.name)
    expect(profile.name).toBe('🎉'.repeat(LIMITS.name))
    expect(warnings).toContain(`INSTANCE_NAME is longer than ${LIMITS.name} characters and was shortened`)
  })

  it('applies each field its own limit', () => {
    const { profile } = readInstanceProfile({
      ...BASE,
      INSTANCE_DESCRIPTION: 'd'.repeat(LIMITS.description + 1),
      INSTANCE_OPERATOR: 'o'.repeat(LIMITS.operator + 1),
      INSTANCE_CONTACT: 'c'.repeat(LIMITS.contact + 1),
    }, NO_FILES)
    expect(profile.description).toHaveLength(LIMITS.description)
    expect(profile.operator).toHaveLength(LIMITS.operator)
    expect(profile.contact?.value).toHaveLength(LIMITS.contact)
  })
})

describe('classifyContact', () => {
  it('reads an email address as email', () => {
    expect(classifyContact('sam@example.com')).toEqual({ kind: 'email', value: 'sam@example.com' })
  })
  it('strips a mailto: prefix rather than publishing it twice', () => {
    expect(classifyContact('mailto:sam@example.com')).toEqual({ kind: 'email', value: 'sam@example.com' })
    expect(classifyContact('MAILTO:Sam@Example.com')).toEqual({ kind: 'email', value: 'Sam@Example.com' })
    // Not an address once the prefix is gone: keep what the host actually wrote.
    expect(classifyContact('mailto:not an address')).toEqual({ kind: 'text', value: 'mailto:not an address' })
  })
  it('reads an http(s) address as a link', () => {
    expect(classifyContact('https://example.com/contact')).toEqual({ kind: 'url', value: 'https://example.com/contact' })
  })
  it('reads anything else as plain text', () => {
    expect(classifyContact('@sky on Matrix')).toEqual({ kind: 'text', value: '@sky on Matrix' })
    expect(classifyContact('sam@example')).toEqual({ kind: 'text', value: 'sam@example' })
    expect(classifyContact('javascript:alert(1)')).toEqual({ kind: 'text', value: 'javascript:alert(1)' })
  })
})

describe('readInstanceProfile: legal documents', () => {
  it('publishes a link from its variable', () => {
    const { profile } = readInstanceProfile({ ...BASE, PRIVACY_URL: 'https://example.com/privacy' }, NO_FILES)
    expect(profile.legal).toEqual([{ kind: 'privacy', source: 'url', href: 'https://example.com/privacy' }])
  })

  it('ignores a link that is not http(s), and says so', () => {
    const { profile, warnings } = readInstanceProfile({ ...BASE, TERMS_URL: 'javascript:alert(1)' }, NO_FILES)
    expect(profile.legal).toEqual([])
    expect(warnings).toContain('TERMS_URL is not an http(s) link and was ignored')
  })

  it('publishes a file as a document, dated by the day it was last changed', () => {
    const { profile } = readInstanceProfile(BASE, { documents: { terms: doc() }, icons: [] })
    expect(profile.legal).toEqual([
      { kind: 'terms', source: 'document', href: '/instance/legal/terms', updated: '2026-09-02' },
    ])
  })

  it('prefers the link when both are set, and names both in a warning', () => {
    const { profile, warnings } = readInstanceProfile(
      { ...BASE, IMPRINT_URL: 'https://example.com/imprint' }, { documents: { imprint: doc() }, icons: [] })
    expect(profile.legal).toEqual([{ kind: 'imprint', source: 'url', href: 'https://example.com/imprint' }])
    expect(warnings).toContain('IMPRINT_URL and imprint.md are both set; the link is used')
  })

  it('ignores a file over 256 KB as if it were absent, and says so', () => {
    const { profile, warnings } = readInstanceProfile(
      BASE, { documents: { cookies: doc(LIMITS.documentBytes + 1) }, icons: [] })
    expect(profile.legal).toEqual([])
    expect(warnings).toContain('cookies.md is larger than 256 KB and was ignored')
  })

  it('lists documents in the fixed order, whatever order they were found in', () => {
    const { profile } = readInstanceProfile(
      { ...BASE, PRIVACY_URL: 'https://example.com/privacy' },
      { documents: { imprint: doc(), terms: doc(), guidelines: doc() }, icons: [] })
    expect(profile.legal.map(e => e.kind)).toEqual(['terms', 'privacy', 'guidelines', 'imprint'])
  })

  it('gives a date only to documents: a link\'s date is not the server\'s to know', () => {
    const { profile } = readInstanceProfile({ ...BASE, COPYRIGHT_URL: 'https://example.com/dmca' }, NO_FILES)
    expect('updated' in profile.legal[0]).toBe(false)
  })

  it('handles all six kinds', () => {
    const env = {
      ...BASE,
      TERMS_URL: 'https://e.example/t', PRIVACY_URL: 'https://e.example/p', GUIDELINES_URL: 'https://e.example/g',
      COOKIES_URL: 'https://e.example/c', COPYRIGHT_URL: 'https://e.example/d', IMPRINT_URL: 'https://e.example/i',
    }
    expect(readInstanceProfile(env, NO_FILES).profile.legal.map(e => e.kind))
      .toEqual(['terms', 'privacy', 'guidelines', 'cookies', 'copyright', 'imprint'])
  })
})

describe('readInstanceProfile: the icon', () => {
  it('uses the first present of png, webp, jpg', () => {
    const r = readInstanceProfile(BASE, { documents: {}, icons: [{ name: 'icon.webp', size: 10 }, { name: 'icon.png', size: 10 }] })
    expect(r.iconFile).toBe('icon.png')
    expect(r.profile.icon).toBe('/instance/icon')
  })

  it('skips an icon over 512 KB for the next one, and says so', () => {
    const r = readInstanceProfile(BASE, {
      documents: {}, icons: [{ name: 'icon.png', size: LIMITS.iconBytes + 1 }, { name: 'icon.jpg', size: 10 }],
    })
    expect(r.iconFile).toBe('icon.jpg')
    expect(r.warnings).toContain('icon.png is larger than 512 KB and was ignored')
  })
})

describe('readInstanceProfile: the source', () => {
  it('links the upstream tag of the running version, with or without its v', () => {
    expect(readInstanceProfile({ ...BASE, SKYCORD_VERSION: '0.20.0' }, NO_FILES).profile.source)
      .toBe(`${UPSTREAM_REPO}/tree/v0.20.0`)
  })
  it('links the repository itself on a development build', () => {
    expect(readInstanceProfile({ APP_URL: BASE.APP_URL }, NO_FILES).profile.source).toBe(UPSTREAM_REPO)
  })
  it('uses SOURCE_URL when a host has changed the code', () => {
    expect(readInstanceProfile({ ...BASE, SOURCE_URL: 'https://git.example.com/skycord' }, NO_FILES).profile.source)
      .toBe('https://git.example.com/skycord')
  })
  it('ignores a SOURCE_URL that is not http(s), falls back, and says so', () => {
    const r = readInstanceProfile({ ...BASE, SOURCE_URL: 'ftp://example.com/src' }, NO_FILES)
    expect(r.profile.source).toBe(`${UPSTREAM_REPO}/tree/v0.20.0`)
    expect(r.warnings).toContain('SOURCE_URL is not an http(s) link and was ignored')
  })
})

describe('scanInstanceDir', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'skycord-instance-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('reports each known file with its size and modification time', () => {
    writeFileSync(join(dir, 'terms.md'), 'hello')
    utimesSync(join(dir, 'terms.md'), new Date('2026-09-02T10:00:00Z'), new Date('2026-09-02T10:00:00Z'))
    writeFileSync(join(dir, 'icon.webp'), Buffer.alloc(7))
    const files = scanInstanceDir(dir)
    expect(files.documents.terms?.size).toBe(5)
    expect(files.documents.terms?.modified.toISOString()).toBe('2026-09-02T10:00:00.000Z')
    expect(files.icons).toEqual([{ name: 'icon.webp', size: 7 }])
  })

  it('looks only at the fixed names, and never at a directory', () => {
    writeFileSync(join(dir, 'notes.md'), 'x')
    writeFileSync(join(dir, 'icon.svg'), '<svg/>')
    mkdirSync(join(dir, 'privacy.md'))
    expect(scanInstanceDir(dir)).toEqual({ documents: {}, icons: [] })
  })

  it('answers empty for a folder that does not exist', () => {
    expect(scanInstanceDir(join(dir, 'missing'))).toEqual({ documents: {}, icons: [] })
  })
})

describe('instanceDir', () => {
  it('uses INSTANCE_DIR when set, and instance/ beside the server otherwise', () => {
    expect(instanceDir({ INSTANCE_DIR: '/srv/sky' }, '/app')).toBe('/srv/sky')
    expect(instanceDir({ INSTANCE_DIR: '  ' }, '/app')).toBe(join('/app', 'instance'))
    expect(instanceDir({}, '/app')).toBe(join('/app', 'instance'))
  })
})
