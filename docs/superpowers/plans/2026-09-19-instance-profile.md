# Instance Profile and Legal Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Skycord instance publishes a public profile — who runs it, how to reach them, its icon, and its legal documents — shown at sign-up, under the sign-in card, in Settings › About this instance and Settings › Legal, and readable by the future desktop picker.

**Architecture:** A pure server function turns `.env` values and facts about files in `INSTANCE_DIR` into the profile and a list of warnings; a small public router serves it from `/instance` with its own open CORS policy, mounted before the app's single-origin one. The client fetches it once per page load through `useInstance()`, and every surface reads from that. Host documents are Markdown rendered by a lazy-loaded, locked-down `markdown-it`; the app's own licence text and third-party licence list ship with the build.

**Tech Stack:** Express 4 + TypeScript (server), Vue 3 `<script setup>` (client), Vitest (node environment, no DOM), supertest, bash (`deploy/`), `markdown-it` (new), `rollup-plugin-license` (new, dev).

**Spec:** [`docs/superpowers/specs/2026-09-14-instance-profile-design.md`](../specs/2026-09-14-instance-profile-design.md)

## Global Constraints

- **Only tokens** in any CSS rule touched; **AA** (4.5:1) for every text colour, in every theme. The colour guard `src/styles/__tests__/noHardcodedColour.test.ts` fails on any literal colour.
- **Muscle memory is binding:** the new Settings nav rows add; nothing existing moves.
- **Two audiences:** host detail (variable names, file paths, setup hints) lives in the installer, `.env.example` and `docs/self-hosting/`, never in member-facing UI.
- **Bundle weight is a real cost:** the Markdown renderer, the AGPL text and the third-party licence list are each loaded only when opened.
- **Legal text is the host's own.** The app never writes legal text on an instance's behalf; the only legal words it supplies are about the app itself.
- **Every host-supplied string is rendered as text.** Nothing reaches `v-html` except `renderLegalMarkdown`'s output, which never contains raw HTML or images.
- **Only `https:`, `http:` and `mailto:` become links**, in the profile and inside documents.
- **`/instance` routes:** `Access-Control-Allow-Origin: *`, no `Access-Control-Allow-Credentials`, `GET`/`HEAD` only, 120 requests per minute per IP, and every response under `/instance` is ended by that router.
- **No SVG icon.** No path from a request ever reaches the filesystem.
- **Copy:** the six document titles are exactly `Terms of Service`, `Privacy Policy`, `Community Guidelines`, `Cookie Policy`, `Copyright & Takedowns`, `Imprint`. The sign-up sentence keeps the short word `Terms`.

## Before Task 1: the workspace

The worktree is `H:\projects\sykord-wt\instance-profile` on branch `instance-profile`, already merged with `main`. It needs its **own** `node_modules`, not a junction to the main checkout's: Tasks 5 and 9 add packages, and installing through a junction would change the main checkout's tree.

```bash
cd /h/projects/sykord-wt/instance-profile
npm ci
```

Server tests import `server/config/env.ts`, which demands variables a worktree has no `.env` for. Export CI's own non-secret values in the shell that runs them (from `.github/workflows/ci.yml`), with a database of this branch's own, because the suite wipes every collection between tests:

```bash
export MONGO_URI=mongodb://127.0.0.1:27017/sykord_test_instance
export TEST_MONGO_URI=mongodb://127.0.0.1:27017/sykord_test_instance
export JWT_ACCESS_SECRET=ci-access-secret-not-a-real-one
export JWT_REFRESH_SECRET=ci-refresh-secret-not-a-real-one
export LIVEKIT_URL=ws://127.0.0.1:7880
export LIVEKIT_API_KEY=ci-livekit-key
export LIVEKIT_API_SECRET=ci-livekit-secret-not-a-real-one
```

The `mongodb` Docker container must be running (`docker ps`). Drop the database when the branch is done: `docker exec mongodb mongo sykord_test_instance --eval 'db.dropDatabase()'`.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `server/utils/legalKinds.ts` | The six kinds, their order, `.env` names and file names; the upstream repository. No imports, so the client's tests can import it. | 1 |
| `server/utils/instanceProfile.ts` | `readInstanceProfile` (pure), `scanInstanceDir`, `instanceDir`, `classifyContact`, the types | 1 |
| `server/__tests__/instanceProfile.test.ts` | Every rule of the spec's variable and file tables | 1 |
| `server/routes/instance.ts` | `GET /instance`, `/instance/icon`, `/instance/legal/:kind`; own CORS, limiter, 60 s cache | 2 |
| `server/middleware/rateLimit.ts` | `instanceLimit` | 2 |
| `server/app.ts`, `server/utils/serveClient.ts`, `server/index.ts` | Mount before global CORS; API prefix; startup warnings | 2 |
| `server/__tests__/instanceRoutes.test.ts` | Routes, headers, 404s, CORS on both sides | 2 |
| `.env.example`, `deploy/compose.yaml`, `deploy/install.sh`, `deploy/tests/cli.test.sh`, `docs/self-hosting/installing.md`, `docs/self-hosting/networking.md` | Host-facing setup | 3 |
| `src/composables/legalDocs.ts` | Client mirror of the kinds, titles, profile types, `formatUpdated`, row helpers | 4, 8 |
| `src/composables/useInstance.ts` | One request per page load; document fetch | 4 |
| `src/composables/__tests__/legalDocs.test.ts` | Mirror parity, titles, dates, rows | 4, 8 |
| `vite.config.ts` | Dev proxy for `/instance` (4); licence generation (9) | 4, 9 |
| `src/composables/legalMarkdown.ts` + test | Lazy, locked-down Markdown | 5 |
| `src/components/legal/LegalDocumentView.vue` | Load, render, fail and retry one document | 5 |
| `src/components/legal/LegalDocModal.vue` | The document before sign-in | 5 |
| `src/composables/consentSentence.ts` + test | The sign-up sentence as segments | 6 |
| `src/views/AuthPage.vue` | Sentence, footer, modal | 6 |
| `src/composables/aboutInstance.ts` + test | About page rows | 7 |
| `src/components/settings/AboutInstancePage.vue` | Settings › About this instance | 7 |
| `src/components/settings/LegalPage.vue` | Settings › Legal, with the document sub-view | 8, 9 |
| `src/components/settings/OpenSourceLicences.vue` | The third-party list | 9 |
| `src/components/modals/SettingsModal.vue` | Nav section and page branches | 7, 8 |

---

### Task 1: The profile, as a pure function

**Files:**
- Create: `server/utils/legalKinds.ts`
- Create: `server/utils/instanceProfile.ts`
- Test: `server/__tests__/instanceProfile.test.ts`

**Interfaces:**
- Produces: `LEGAL_KINDS`, `LegalKind`, `LEGAL_URL_VARS`, `legalFile(kind)`, `isLegalKind(value)`, `UPSTREAM_REPO` (legalKinds.ts); `readInstanceProfile(env: Env, files: InstanceFiles): InstanceResolution`, `scanInstanceDir(dir: string): InstanceFiles`, `instanceDir(env: Env, cwd: string): string`, `classifyContact(value: string): Contact`, `LIMITS`, `ICON_FILES`, and types `Env`, `InstanceFiles`, `InstanceProfile`, `LegalEntry`, `Contact`, `IconFile`, `InstanceResolution` (instanceProfile.ts).

- [ ] **Step 1: The kinds module** — `server/utils/legalKinds.ts`. It has no imports on purpose: the client's parity test (Task 4) imports it, and the client tsconfig cannot resolve server-only modules.

```ts
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
```

- [ ] **Step 2: Write the failing tests** — `server/__tests__/instanceProfile.test.ts`. No database and no app: this is the pure function and the directory scan only.

```ts
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
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run server/__tests__/instanceProfile.test.ts`
Expected: FAIL — `Failed to resolve import "../utils/instanceProfile"`.

- [ ] **Step 4: Implement** — `server/utils/instanceProfile.ts`:

```ts
/**
 * The instance profile: who runs this server, how to reach them, and the legal
 * documents they publish — read before anyone signs in, by sign-up, Settings
 * and (later) the desktop app's instance picker.
 *
 * readInstanceProfile is pure: environment values and facts about files go in,
 * the public profile and a list of warnings come out. Every rule in the spec's
 * tables lives here, so each is testable without a server.
 * Spec: docs/superpowers/specs/2026-09-14-instance-profile-design.md
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { LEGAL_KINDS, LEGAL_URL_VARS, UPSTREAM_REPO, legalFile, type LegalKind } from './legalKinds'

export type Env = Record<string, string | undefined>

/** No SVG: an SVG opened directly runs script in the instance's origin. */
export const ICON_FILES = ['icon.png', 'icon.webp', 'icon.jpg'] as const
export type IconFile = typeof ICON_FILES[number]

export const LIMITS = {
  name: 64,
  description: 300,
  operator: 100,
  contact: 200,
  documentBytes: 256 * 1024,
  iconBytes: 512 * 1024,
} as const

/** What the server knows about INSTANCE_DIR's fixed files — see scanInstanceDir. */
export interface InstanceFiles {
  documents: Partial<Record<LegalKind, { size: number; modified: Date }>>
  icons: { name: IconFile; size: number }[]
}

export interface Contact { kind: 'email' | 'url' | 'text'; value: string }

export type LegalEntry =
  | { kind: LegalKind; source: 'url'; href: string }
  | { kind: LegalKind; source: 'document'; href: string; updated: string }

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

export interface InstanceResolution {
  profile: InstanceProfile
  /** The file /instance/icon serves, or null. Not part of the public profile. */
  iconFile: IconFile | null
  warnings: string[]
}

const clean = (value: string | undefined): string | null => {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/** Only http(s): a javascript: or data: link must never reach a member. */
const httpUrl = (value: string): string | null => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null
  } catch {
    return null
  }
}

/** Shortened by code point, not by UTF-16 unit, so an emoji is never cut in half. */
const limit = (key: string, value: string | null, max: number, warnings: string[]): string | null => {
  if (value === null) return null
  const chars = Array.from(value)
  if (chars.length <= max) return value
  warnings.push(`${key} is longer than ${max} characters and was shortened`)
  return chars.slice(0, max).join('')
}

export const classifyContact = (value: string): Contact => {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { kind: 'email', value }
  if (httpUrl(value)) return { kind: 'url', value }
  return { kind: 'text', value }
}

const hostOf = (address: string): string => {
  try { return new URL(address).hostname || address } catch { return address }
}

const sourceFor = (env: Env, version: string, warnings: string[]): string => {
  const configured = clean(env.SOURCE_URL)
  if (configured) {
    if (httpUrl(configured)) return configured
    warnings.push('SOURCE_URL is not an http(s) link and was ignored')
  }
  if (version === 'dev') return UPSTREAM_REPO
  return `${UPSTREAM_REPO}/tree/${version.startsWith('v') ? version : `v${version}`}`
}

export const readInstanceProfile = (env: Env, files: InstanceFiles): InstanceResolution => {
  const warnings: string[] = []
  const version = clean(env.SKYCORD_VERSION) ?? 'dev'
  // The same fallback config.email.appUrl uses, so the two never disagree.
  const address = clean(env.APP_URL) ?? clean(env.CLIENT_ORIGIN) ?? 'http://localhost:5173'
  const name = limit('INSTANCE_NAME', clean(env.INSTANCE_NAME), LIMITS.name, warnings)
  const contact = limit('INSTANCE_CONTACT', clean(env.INSTANCE_CONTACT), LIMITS.contact, warnings)

  const legal: LegalEntry[] = []
  for (const kind of LEGAL_KINDS) {
    const variable = LEGAL_URL_VARS[kind]
    const file = legalFile(kind)
    const configured = clean(env[variable])
    const url = configured ? httpUrl(configured) : null
    if (configured && !url) warnings.push(`${variable} is not an http(s) link and was ignored`)

    const found = files.documents[kind]
    const usable = found && found.size <= LIMITS.documentBytes ? found : null
    if (found && !usable) warnings.push(`${file} is larger than 256 KB and was ignored`)

    if (url) {
      // A host who set both is most likely mid-migration; the link is the explicit choice.
      if (usable) warnings.push(`${variable} and ${file} are both set; the link is used`)
      legal.push({ kind, source: 'url', href: url })
    } else if (usable) {
      legal.push({
        kind, source: 'document', href: `/instance/legal/${kind}`,
        updated: usable.modified.toISOString().slice(0, 10),
      })
    }
  }

  let iconFile: IconFile | null = null
  for (const candidate of ICON_FILES) {
    const icon = files.icons.find(i => i.name === candidate)
    if (!icon) continue
    if (icon.size > LIMITS.iconBytes) {
      warnings.push(`${candidate} is larger than 512 KB and was ignored`)
      continue
    }
    iconFile = candidate
    break
  }

  const profile: InstanceProfile = {
    software: 'skycord',
    version,
    address,
    name: name ?? hostOf(address),
    nameIsAddress: name === null,
    description: limit('INSTANCE_DESCRIPTION', clean(env.INSTANCE_DESCRIPTION), LIMITS.description, warnings),
    operator: limit('INSTANCE_OPERATOR', clean(env.INSTANCE_OPERATOR), LIMITS.operator, warnings),
    contact: contact === null ? null : classifyContact(contact),
    icon: iconFile ? '/instance/icon' : null,
    legal,
    source: sourceFor(env, version, warnings),
  }
  return { profile, iconFile, warnings }
}

/** Facts about INSTANCE_DIR's fixed files. No other name is ever looked at. */
export const scanInstanceDir = (dir: string): InstanceFiles => {
  const fileStat = (name: string) => {
    try {
      const stat = statSync(join(dir, name))
      return stat.isFile() ? stat : null
    } catch {
      return null
    }
  }
  const documents: InstanceFiles['documents'] = {}
  for (const kind of LEGAL_KINDS) {
    const stat = fileStat(legalFile(kind))
    if (stat) documents[kind] = { size: stat.size, modified: stat.mtime }
  }
  const icons = ICON_FILES.flatMap(name => {
    const stat = fileStat(name)
    return stat ? [{ name, size: stat.size }] : []
  })
  return { documents, icons }
}

/** INSTANCE_DIR, or `instance` beside the server: /app/instance in the image. */
export const instanceDir = (env: Env, cwd: string): string =>
  clean(env.INSTANCE_DIR) ?? join(cwd, 'instance')
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run server/__tests__/instanceProfile.test.ts`
Expected: PASS, every test.

- [ ] **Step 6: Typecheck** — `npm run typecheck`. Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/utils/legalKinds.ts server/utils/instanceProfile.ts server/__tests__/instanceProfile.test.ts
git commit -m "feat(instance): the profile as a pure function of .env and the instance folder"
```

---

### Task 2: The public routes

**Files:**
- Create: `server/routes/instance.ts`
- Modify: `server/middleware/rateLimit.ts` (append `instanceLimit`)
- Modify: `server/app.ts` (mount before `app.use(cors(...))`)
- Modify: `server/utils/serveClient.ts:25-29` (`API_PREFIXES`)
- Modify: `server/index.ts` (warnings after the voice-servers block)
- Test: `server/__tests__/instanceRoutes.test.ts`

**Interfaces:**
- Consumes: `readInstanceProfile`, `scanInstanceDir`, `instanceDir`, `Env`, `IconFile`, `InstanceResolution` (Task 1); `isLegalKind`, `legalFile` (Task 1).
- Produces: `instanceRouter(options: { dir: string; env?: Env; now?: () => number }): Router`; `instanceLimit`; the HTTP contract `GET /instance` → `InstanceProfile` JSON, `GET /instance/icon` → image, `GET /instance/legal/:kind` → `text/markdown`.

- [ ] **Step 1: Write the failing tests** — `server/__tests__/instanceRoutes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../app'
import { config } from '../config/env'

// createApp builds the /instance router from process.env and INSTANCE_DIR, so
// each test sets them first and builds its own app. No database is needed.
const KEYS = ['INSTANCE_DIR', 'INSTANCE_NAME', 'TERMS_URL', 'PRIVACY_URL', 'GUIDELINES_URL'] as const
let dir: string
let saved: Partial<Record<(typeof KEYS)[number], string>>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skycord-instance-'))
  saved = {}
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key] }
  process.env.INSTANCE_DIR = dir
})
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  rmSync(dir, { recursive: true, force: true })
})

const api = () => request(createApp())

describe('GET /instance', () => {
  it('answers with the profile when nothing is configured', async () => {
    const res = await api().get('/instance')
    expect(res.status).toBe(200)
    expect(res.body.software).toBe('skycord')
    expect(res.body.legal).toEqual([])
    expect(typeof res.body.source).toBe('string')
    expect(res.headers['cache-control']).toBe('public, max-age=300')
  })

  it('is readable from any origin, and allows no credentials', async () => {
    const res = await api().get('/instance').set('Origin', 'https://elsewhere.example')
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('answers a preflight from any origin', async () => {
    const res = await api().options('/instance')
      .set('Origin', 'https://elsewhere.example')
      .set('Access-Control-Request-Method', 'GET')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('leaves the rest of the API on its single-origin policy with credentials', async () => {
    const res = await api().get('/health').set('Origin', config.cors.clientOrigin)
    expect(res.headers['access-control-allow-origin']).toBe(config.cors.clientOrigin)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('answers HEAD', async () => {
    expect((await api().head('/instance')).status).toBe(200)
  })

  it('lists published documents in the fixed order', async () => {
    writeFileSync(join(dir, 'imprint.md'), '# Imprint')
    writeFileSync(join(dir, 'terms.md'), '# Terms')
    process.env.PRIVACY_URL = 'https://example.com/privacy'
    const res = await api().get('/instance')
    expect(res.body.legal.map((e: { kind: string }) => e.kind)).toEqual(['terms', 'privacy', 'imprint'])
    expect(res.body.legal[0].href).toBe('/instance/legal/terms')
    expect(res.body.legal[1]).toEqual({ kind: 'privacy', source: 'url', href: 'https://example.com/privacy' })
  })
})

describe('GET /instance/legal/:kind', () => {
  it('serves a published document as Markdown', async () => {
    writeFileSync(join(dir, 'terms.md'), '# Terms\n\nBe kind.')
    const res = await api().get('/instance/legal/terms')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.text).toBe('# Terms\n\nBe kind.')
  })

  it('answers 404 for a document published as a link, and for one not published', async () => {
    process.env.PRIVACY_URL = 'https://example.com/privacy'
    expect((await api().get('/instance/legal/privacy')).status).toBe(404)
    expect((await api().get('/instance/legal/cookies')).status).toBe(404)
  })

  it('answers 404 for an unknown kind and never lets a path through', async () => {
    writeFileSync(join(dir, 'terms.md'), '# Terms')
    for (const path of ['/instance/legal/unknown', '/instance/legal/..%2fterms', '/instance/legal/terms.md', '/instance/legal/%2e%2e']) {
      const res = await api().get(path)
      expect(res.status, path).toBe(404)
      expect(res.headers['access-control-allow-origin'], path).toBe('*')
    }
  })
})

describe('GET /instance/icon', () => {
  it('serves the icon with its own type, nosniff and an hour of caching', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    writeFileSync(join(dir, 'icon.png'), png)
    const res = await api().get('/instance/icon')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
    expect(Buffer.compare(res.body as Buffer, png)).toBe(0)
  })

  it('answers 404 when there is none, and when the only one is over 512 KB', async () => {
    expect((await api().get('/instance/icon')).status).toBe(404)
    writeFileSync(join(dir, 'icon.jpg'), Buffer.alloc(512 * 1024 + 1))
    expect((await api().get('/instance/icon')).status).toBe(404)
  })
})

describe('the rate limit', () => {
  // Every limiter in this project skips itself under Vitest (rateLimit.ts,
  // `skip: () => !!process.env.VITEST`), so the limit cannot be exercised
  // here. What can be held is that the router applies it and what it is.
  it('is 120 a minute and applied to every /instance route', () => {
    const limits = readFileSync(join(__dirname, '..', 'middleware', 'rateLimit.ts'), 'utf8')
    const router = readFileSync(join(__dirname, '..', 'routes', 'instance.ts'), 'utf8')
    expect(limits).toMatch(/export const instanceLimit = make\(60_000, 120,/)
    expect(router).toMatch(/router\.use\(instanceLimit\)/)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run server/__tests__/instanceRoutes.test.ts server/__tests__/serveClient.test.ts`
Expected: FAIL — `/instance` answers 404 (the global not-found) and the rate-limit test cannot read `routes/instance.ts`.

- [ ] **Step 3: The limiter** — append to `server/middleware/rateLimit.ts`:

```ts
/** The public instance profile and its files, read before sign-in by the web
 *  client once per page load and by the desktop picker. Keyed by IP, since
 *  nobody here is signed in. */
export const instanceLimit = make(60_000, 120, 'Too many requests — wait a moment')
```

- [ ] **Step 4: The router** — `server/routes/instance.ts`:

```ts
/**
 * GET /instance, /instance/icon, /instance/legal/:kind — public, before sign-in.
 *
 * Readable from any origin, which is why app.ts mounts this router BEFORE the
 * global CORS policy (one origin, with credentials): the desktop app's
 * instance picker reads /instance from an address it has only just been given.
 * The policy here sends no cookies and allows no credentials, so an open
 * origin exposes nothing that is not public already.
 *
 * Every request under /instance is answered here, 404s included, so none falls
 * through to the single-origin headers mounted after this.
 */
import { Router } from 'express'
import cors from 'cors'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { instanceLimit } from '../middleware/rateLimit'
import { isLegalKind, legalFile } from '../utils/legalKinds'
import {
  readInstanceProfile, scanInstanceDir,
  type Env, type IconFile, type InstanceResolution,
} from '../utils/instanceProfile'

/** Replacing terms.md takes effect within a minute, without a restart. */
const CACHE_MS = 60_000

const ICON_TYPES: Record<IconFile, string> = {
  'icon.png':  'image/png',
  'icon.webp': 'image/webp',
  'icon.jpg':  'image/jpeg',
}

export interface InstanceRouterOptions {
  dir: string
  env?: Env
  now?: () => number
}

export const instanceRouter = ({ dir, env = process.env, now = Date.now }: InstanceRouterOptions): Router => {
  let resolved: { at: number; value: InstanceResolution } | null = null
  const current = (): InstanceResolution => {
    if (!resolved || now() - resolved.at >= CACHE_MS) {
      resolved = { at: now(), value: readInstanceProfile(env, scanInstanceDir(dir)) }
    }
    return resolved.value
  }

  // Only names this module chose are ever passed in — an icon from ICON_FILES
  // or legalFile() of a checked kind — so nothing from a request reaches a path.
  const bodies = new Map<string, { at: number; body: Buffer }>()
  const readCached = (name: string): Buffer | null => {
    const hit = bodies.get(name)
    if (hit && now() - hit.at < CACHE_MS) return hit.body
    try {
      const body = readFileSync(join(dir, name))
      bodies.set(name, { at: now(), body })
      return body
    } catch {
      bodies.delete(name)
      return null
    }
  }

  const router = Router()
  router.use(cors({ origin: '*', methods: ['GET', 'HEAD'] }))
  router.use(instanceLimit)

  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300').json(current().profile)
  })

  router.get('/icon', (_req, res) => {
    const { iconFile } = current()
    const body = iconFile ? readCached(iconFile) : null
    if (!iconFile || !body) { res.status(404).json({ message: 'This instance has no icon' }); return }
    res.set({
      'Content-Type': ICON_TYPES[iconFile],
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=3600',
    }).send(body)
  })

  router.get('/legal/:kind', (req, res) => {
    const { kind } = req.params
    const entry = isLegalKind(kind) ? current().profile.legal.find(e => e.kind === kind) : undefined
    const body = entry?.source === 'document' ? readCached(legalFile(entry.kind)) : null
    if (!body) { res.status(404).json({ message: 'This instance does not publish that document here' }); return }
    res.set({
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=300',
    }).send(body)
  })

  router.use((_req, res) => { res.status(404).json({ message: 'Not found' }) })
  return router
}
```

- [ ] **Step 5: Mount it** — in `server/app.ts`, add the imports beside the other route imports:

```ts
import { instanceRouter } from './routes/instance'
import { instanceDir } from './utils/instanceProfile'
```

and insert this **between** the `Permissions-Policy` middleware and `app.use(cors({`:

```ts
  // Public and readable from any origin, so mounted BEFORE the single-origin
  // CORS policy below. The router answers everything under /instance itself.
  app.use('/instance', instanceRouter({ dir: instanceDir(process.env, process.cwd()) }))
```

- [ ] **Step 6: The prefix list** — in `server/utils/serveClient.ts`, add `'/instance'` to `API_PREFIXES`:

```ts
export const API_PREFIXES = [
  '/auth', '/users', '/messages', '/stickers', '/conversations',
  '/themes', '/voice', '/gifs', '/servers', '/invites', '/instance',
  '/health', '/socket.io',
]
```

- [ ] **Step 7: Warnings once, at boot** — in `server/index.ts`, add the imports:

```ts
import { readInstanceProfile, scanInstanceDir, instanceDir } from './utils/instanceProfile'
```

and directly after the voice-servers `try { … } catch { … }` block (the one ending in `process.exit(1)` after `'❌ Voice servers:'`), add:

```ts
  // Once, at boot: the route stays quiet, so a bad value is not repeated in the
  // log on every request. Nothing here stops the process — every problem has a
  // safe fallback, which is the whole point of reporting it instead.
  const instance = readInstanceProfile(process.env, scanInstanceDir(instanceDir(process.env, process.cwd())))
  for (const warning of instance.warnings) console.warn('⚠ Instance profile: ' + warning)
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `npx vitest run server/__tests__/instanceRoutes.test.ts server/__tests__/serveClient.test.ts server/__tests__/securityHeaders.test.ts`
Expected: PASS. `serveClient.test.ts` includes the parity check that every `app.use('/x'` prefix is in `API_PREFIXES`.

- [ ] **Step 9: The whole server suite and the typecheck** — `npx vitest run server/` then `npm run typecheck`. Expected: all pass, no errors.

- [ ] **Step 10: Commit**

```bash
git add server/routes/instance.ts server/middleware/rateLimit.ts server/app.ts server/utils/serveClient.ts server/index.ts server/__tests__/instanceRoutes.test.ts
git commit -m "feat(instance): /instance, its icon and its legal documents, readable from any origin"
```

---

### Task 3: What a host sets

**Files:**
- Modify: `.env.example` (append a section)
- Modify: `deploy/compose.yaml` (environment entries, `INSTANCE_DIR`, a read-only volume)
- Modify: `deploy/install.sh` (`env_quote`, five questions, the folder, the `.env` lines)
- Modify: `deploy/tests/cli.test.sh` (append tests)
- Modify: `docs/self-hosting/installing.md` (a section)
- Modify: `docs/self-hosting/networking.md:147` (the nginx location regex)

**Interfaces:**
- Consumes: the variable names from Task 1's `LEGAL_URL_VARS` and the spec's table.
- Produces: nothing code depends on.

- [ ] **Step 1: Write the failing shell tests** — append to `deploy/tests/cli.test.sh`, before its final summary lines (the block that reports `FAILED`):

```bash
echo "instance profile"
# The installer is not sourced whole — it would try to install things. Its
# quoting helper is lifted out and run on its own.
eval "$(sed -n '/^env_quote()/,/^}/p' "$ROOT/deploy/install.sh")"
is "a plain value stays plain"        "$(env_quote 'https://example.com/terms')" "https://example.com/terms"
is "an empty value stays empty"       "$(env_quote '')"                          ""
is "a space is single-quoted"         "$(env_quote 'Sky Den')"                   "'Sky Den'"
is "a # is quoted, not a comment"     "$(env_quote 'Den #1')"                    "'Den #1'"
is "a \$ is kept literal"             "$(env_quote 'a$b')"                       "'a\$b'"
is "an apostrophe double-quotes"      "$(env_quote "Sam's Place")"               "\"Sam's Place\""
is "and escapes \$, \" and \\ inside" "$(env_quote "it's \$5 \"now\" \\o/")"     "\"it's \$\$5 \\\"now\\\" \\\\o/\""

for var in INSTANCE_NAME INSTANCE_DESCRIPTION INSTANCE_OPERATOR INSTANCE_CONTACT \
           TERMS_URL PRIVACY_URL GUIDELINES_URL COOKIES_URL COPYRIGHT_URL IMPRINT_URL SOURCE_URL; do
  has "compose forwards $var" "$ROOT/deploy/compose.yaml" "$var: \${$var:-}"
  has ".env.example documents $var" "$ROOT/.env.example" "^$var="
done
has "compose points the app at the folder" "$ROOT/deploy/compose.yaml" 'INSTANCE_DIR: /app/instance'
has "compose mounts it read-only"          "$ROOT/deploy/compose.yaml" './instance:/app/instance:ro'
has "the installer creates it"             "$ROOT/deploy/install.sh"   'SKYCORD_DIR/instance'
has "nginx proxies /instance"              "$ROOT/docs/self-hosting/networking.md" 'invites|instance|'

# The five questions sit inside the block --yes skips.
guarded="$(awk '/^if \[ -z "\$ASSUME_YES" \]; then$/{g=1} g{print} /^fi$/{g=0}' "$ROOT/deploy/install.sh")"
for q in 'Name for this instance' 'Who runs it' 'How people can reach you' \
         'Link to your terms of service' 'Link to your privacy policy'; do
  if grep -q "$q" <<<"$guarded"; then ok "--yes skips: $q"; else bad "--yes skips: $q" "not inside an ASSUME_YES block"; fi
done
```

- [ ] **Step 2: Run them to see them fail**

Run: `bash deploy/tests/cli.test.sh`
Expected: FAIL lines under "instance profile" (`env_quote: command not found`, and every `has` missing).

- [ ] **Step 3: `.env.example`** — append:

```bash

# ── This instance's profile and legal pages ───────────────────────────────────
# Shown to people who join: on the sign-up page, in Settings → About this
# instance and Settings → Legal, and to the desktop app before anyone signs in.
# All optional. Change them later with: sudo skycord config
INSTANCE_NAME=
INSTANCE_DESCRIPTION=
INSTANCE_OPERATOR=
# An email address, a web link, or any short text ("@sky on Matrix").
INSTANCE_CONTACT=
#
# Your legal documents, as links. Each can instead be a Markdown file in the
# instance folder — terms.md, privacy.md, guidelines.md, cookies.md,
# copyright.md, imprint.md (256 KB each) — and a link wins when both are set.
# An icon goes there too: icon.png, icon.webp or icon.jpg (512 KB).
TERMS_URL=
PRIVACY_URL=
GUIDELINES_URL=
COOKIES_URL=
COPYRIGHT_URL=
IMPRINT_URL=
#
# Only if you have changed Skycord's code. Skycord is AGPL v3, so everyone who
# uses your instance is owed the source of the version you run. Unset, the app
# links to the upstream release you are running, which is right for everyone
# who has not changed it.
SOURCE_URL=
#
# Where the instance folder is. Default: instance/ beside the server.
INSTANCE_DIR=
```

- [ ] **Step 4: `deploy/compose.yaml`** — in the `skycord` service's `environment:` list, after `GEOIP: ${GEOIP:-}`, add:

```yaml
      INSTANCE_NAME: ${INSTANCE_NAME:-}
      INSTANCE_DESCRIPTION: ${INSTANCE_DESCRIPTION:-}
      INSTANCE_OPERATOR: ${INSTANCE_OPERATOR:-}
      INSTANCE_CONTACT: ${INSTANCE_CONTACT:-}
      TERMS_URL: ${TERMS_URL:-}
      PRIVACY_URL: ${PRIVACY_URL:-}
      GUIDELINES_URL: ${GUIDELINES_URL:-}
      COOKIES_URL: ${COOKIES_URL:-}
      COPYRIGHT_URL: ${COPYRIGHT_URL:-}
      IMPRINT_URL: ${IMPRINT_URL:-}
      SOURCE_URL: ${SOURCE_URL:-}
      INSTANCE_DIR: /app/instance
```

and between the `environment:` list and `healthcheck:`, add:

```yaml
    # The host's legal documents and icon. Read-only: the app serves these
    # files and never writes them.
    volumes:
      - ./instance:/app/instance:ro
```

- [ ] **Step 5: `deploy/install.sh`, the helper** — directly after the `ask()` function definition near the top, add:

```bash
# A value written into .env so docker compose reads it back exactly: plain when
# it is only safe characters; single-quoted (compose takes those literally)
# unless it holds a single quote itself; otherwise double-quoted with compose's
# escapes — backslash and double quote escaped, and $ doubled so it is not read
# as a variable.
env_quote() {
  local v="$1"
  if [[ "$v" =~ ^[A-Za-z0-9._:/@+=,-]*$ ]]; then printf '%s' "$v"; return; fi
  if [[ "$v" != *\'* ]]; then printf "'%s'" "$v"; return; fi
  v="${v//\\/\\\\}"
  v="${v//\"/\\\"}"
  v="${v//\$/\$\$}"
  printf '"%s"' "$v"
}
```

- [ ] **Step 6: `deploy/install.sh`, the questions** — directly after the existing optional-questions block (the `if [ -z "$ASSUME_YES" ]; then` block that asks for the KLIPY and Resend keys, ending in `fi`), add:

```bash
INSTANCE_NAME=""
INSTANCE_OPERATOR=""
INSTANCE_CONTACT=""
TERMS_URL=""
PRIVACY_URL=""
if [ -z "$ASSUME_YES" ]; then
  say ""
  say "About this instance, shown to people who join. All optional; change later with: sudo skycord config"
  INSTANCE_NAME="$(ask 'Name for this instance, shown to people who join (enter to use the address): ')"
  INSTANCE_OPERATOR="$(ask 'Who runs it — a name people will recognise (enter to skip): ')"
  INSTANCE_CONTACT="$(ask 'How people can reach you — an email or a link (enter to skip): ')"
  TERMS_URL="$(ask 'Link to your terms of service (enter to skip): ')"
  PRIVACY_URL="$(ask 'Link to your privacy policy (enter to skip): ')"
fi
```

The prompts use the file's existing lowercase "enter to skip", which is the style the spec asks them to match.

- [ ] **Step 7: `deploy/install.sh`, the folder and `.env`** — change the directory line to create the instance folder, world-readable because the container reads it as its own user:

```bash
mkdir -p "$SKYCORD_DIR/backups" "$SKYCORD_DIR/tls" "$SKYCORD_DIR/templates"
install -d -m 0755 "$SKYCORD_DIR/instance"
```

and in the `.env` heredoc, after `EMAIL_FROM=$EMAIL_FROM`, add:

```bash

INSTANCE_NAME=$(env_quote "$INSTANCE_NAME")
INSTANCE_OPERATOR=$(env_quote "$INSTANCE_OPERATOR")
INSTANCE_CONTACT=$(env_quote "$INSTANCE_CONTACT")
TERMS_URL=$(env_quote "$TERMS_URL")
PRIVACY_URL=$(env_quote "$PRIVACY_URL")
```

The heredoc's delimiter is unquoted (`<<ENVEOF`), so `$( … )` runs as it is written.

- [ ] **Step 8: `docs/self-hosting/networking.md`** — in the nginx `location ~ ^/(auth|users|…|health)` line, add `instance` after `invites`:

```
    location ~ ^/(auth|users|messages|conversations|servers|invites|instance|gifs|stickers|themes|voice|health) {
```

- [ ] **Step 9: `docs/self-hosting/installing.md`** — add a section after the part describing `sudo skycord config`:

```markdown
## Your instance's profile and legal pages

People who join see who runs your instance and how to reach you — on the
sign-up page, and in **Settings › About this instance** and **Settings ›
Legal**. The installer asks for the name, who runs it, a contact, and links to
your terms and privacy policy; everything else is set in `.env` with
`sudo skycord config`:

| Variable | What it is |
|---|---|
| `INSTANCE_NAME` | The name people see (64 characters) |
| `INSTANCE_DESCRIPTION` | A sentence or two about it (300) |
| `INSTANCE_OPERATOR` | Who runs it (100) |
| `INSTANCE_CONTACT` | An email address, a link, or any short text (200) |
| `TERMS_URL`, `PRIVACY_URL`, `GUIDELINES_URL`, `COOKIES_URL`, `COPYRIGHT_URL`, `IMPRINT_URL` | Your legal documents, as links |
| `SOURCE_URL` | Only if you have changed Skycord's code: where your version's source is |

**Documents as files.** Any legal document can instead be a Markdown file in
`/opt/skycord/instance/`: `terms.md`, `privacy.md`, `guidelines.md`,
`cookies.md`, `copyright.md`, `imprint.md`, up to 256 KB each. Skycord shows
them inside the app. A link wins if you set both. Replacing a file takes effect
within a minute; no restart needed.

**An icon.** `icon.png`, `icon.webp` or `icon.jpg` in the same folder, up to
512 KB. SVG is not accepted.

**The source code.** Skycord is licensed under the GNU AGPL v3, which means
everyone using your instance is entitled to the source of the version you run.
Settings › Legal links to it for you. If you run Skycord unchanged, the link to
the upstream release is correct and there is nothing to do. If you change the
code, publish your version and set `SOURCE_URL` to it.

Problems with any of these are reported once when the server starts
(`sudo skycord logs`), and never stop it: a bad link is ignored, an over-long
name is shortened, an oversized file is skipped.
```

- [ ] **Step 10: Run the shell tests to see them pass**

Run: `bash deploy/tests/cli.test.sh`
Expected: every line `ok`, exit code 0. If an `env_quote` assertion fails, print the actual value by hand (`env_quote "…"`) and check it against compose's `.env` rules before changing either side.

- [ ] **Step 11: ShellCheck** — CI runs ShellCheck over `deploy/`. If it is installed locally: `shellcheck deploy/install.sh deploy/skycord deploy/tests/cli.test.sh`. Expected: no findings.

- [ ] **Step 12: Commit**

```bash
git add .env.example deploy/compose.yaml deploy/install.sh deploy/tests/cli.test.sh docs/self-hosting/installing.md docs/self-hosting/networking.md
git commit -m "feat(deploy): hosts set their instance profile and legal pages in the installer and .env"
```

---

### Task 4: The client's view of the profile

**Files:**
- Create: `src/composables/legalDocs.ts`
- Create: `src/composables/useInstance.ts`
- Test: `src/composables/__tests__/legalDocs.test.ts`
- Modify: `vite.config.ts` (dev proxy)

**Interfaces:**
- Consumes: the `/instance` JSON contract (Task 2); `LEGAL_KINDS`, `UPSTREAM_REPO` from `server/utils/legalKinds.ts` (test only).
- Produces: `LEGAL_KINDS`, `LegalKind`, `LEGAL_TITLES`, `UPSTREAM_REPO`, types `InstanceProfile`, `LegalEntry`, `DocumentEntry`, `Contact`, and `formatUpdated(iso: string): string` (legalDocs.ts); `useInstance(): { profile: ComputedRef<InstanceProfile | null>; state: ComputedRef<'idle' | 'loading' | 'ready' | 'failed'>; retry(): void }` and `fetchLegalDocument(href: string): Promise<string>` (useInstance.ts).

- [ ] **Step 1: Write the failing test** — `src/composables/__tests__/legalDocs.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/composables/__tests__/legalDocs.test.ts`
Expected: FAIL — `Failed to resolve import "../legalDocs"`.

- [ ] **Step 3: The mirror** — `src/composables/legalDocs.ts`:

```ts
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
```

- [ ] **Step 4: The request** — `src/composables/useInstance.ts`:

```ts
/**
 * The instance profile, requested once per page load and shared by every
 * surface that shows it: sign-up, the line under the sign-in card, Settings ›
 * About this instance and Settings › Legal. Public: no sign-in needed.
 *
 * Through authFetch, the helper the auth page already uses for
 * /auth/reset-available: same origin, so the credentials it carries are
 * harmless, and one helper means one place requests are made from.
 */
import { computed, ref } from 'vue'
import { useAuth } from './useAuth'
import type { InstanceProfile } from './legalDocs'

type LoadState = 'idle' | 'loading' | 'ready' | 'failed'

const profile = ref<InstanceProfile | null>(null)
const state = ref<LoadState>('idle')
let inflight: Promise<void> | null = null

const load = (): Promise<void> => {
  if (inflight) return inflight
  const { authFetch } = useAuth()
  state.value = 'loading'
  inflight = (async () => {
    try {
      const res = await authFetch('/instance')
      if (!res.ok) throw new Error(`the instance profile answered ${res.status}`)
      profile.value = await res.json() as InstanceProfile
      state.value = 'ready'
    } catch {
      state.value = 'failed'
      inflight = null // so Retry starts a fresh request
    }
  })()
  return inflight
}

export const useInstance = () => {
  if (state.value === 'idle') void load()
  return {
    profile: computed(() => profile.value),
    state: computed(() => state.value),
    retry: (): void => { if (state.value === 'failed') void load() },
  }
}

/** A published document's Markdown. Throws on anything but a 200. */
export const fetchLegalDocument = async (href: string): Promise<string> => {
  const { authFetch } = useAuth()
  const res = await authFetch(href)
  if (!res.ok) throw new Error(`the document answered ${res.status}`)
  return res.text()
}
```

- [ ] **Step 5: The dev proxy** — in `vite.config.ts`, add to `server.proxy`, after `'/invites'`:

```ts
        '/instance':      { target: api, changeOrigin: true },
```

- [ ] **Step 6: Run the test to see it pass**

Run: `npx vitest run src/composables/__tests__/legalDocs.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck** — `npm run typecheck`. Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/composables/legalDocs.ts src/composables/useInstance.ts src/composables/__tests__/legalDocs.test.ts vite.config.ts
git commit -m "feat(instance): the client reads the profile once per page load"
```

---

### Task 5: Reading a document

**Files:**
- Modify: `package.json`, `package-lock.json` (add `markdown-it`, `@types/markdown-it`)
- Create: `src/composables/legalMarkdown.ts`
- Test: `src/composables/__tests__/legalMarkdown.test.ts`
- Create: `src/components/legal/LegalDocumentView.vue`
- Create: `src/components/legal/LegalDocModal.vue`

**Interfaces:**
- Consumes: `LEGAL_TITLES`, `DocumentEntry`, `formatUpdated` (Task 4); `fetchLegalDocument` (Task 4); `ModalBase.vue` (existing: `width` prop, default slot, emits `close`).
- Produces: `renderLegalMarkdown(source: string): Promise<string>`; `<LegalDocumentView :load="() => Promise<string>" :format="'markdown' | 'plain'" />`; `<LegalDocModal :entry="DocumentEntry" :instance-name="string" @close />`.

- [ ] **Step 1: Add the renderer**

```bash
npm install markdown-it
npm install -D @types/markdown-it
```

- [ ] **Step 2: Write the failing test** — `src/composables/__tests__/legalMarkdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderLegalMarkdown } from '../legalMarkdown'

describe('renderLegalMarkdown', () => {
  it('renders what a legal document needs: headings, paragraphs, lists, emphasis, code', async () => {
    const html = await renderLegalMarkdown('# Terms\n\nBe **kind**.\n\n- one\n- two\n\n`code`')
    expect(html).toContain('<h1>Terms</h1>')
    expect(html).toContain('<strong>kind</strong>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<code>code</code>')
  })

  it('shows raw HTML as text and never renders it', async () => {
    const html = await renderLegalMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('never renders an image', async () => {
    expect(await renderLegalMarkdown('![tracker](https://example.com/pixel.png)')).not.toContain('<img')
  })

  it('opens an http(s) link in a new tab, without an opener', async () => {
    const html = await renderLegalMarkdown('[our site](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('allows mailto links', async () => {
    expect(await renderLegalMarkdown('[mail](mailto:sam@example.com)')).toContain('href="mailto:sam@example.com"')
  })

  it('refuses every other kind of link', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', '/relative', 'vbscript:x']) {
      const html = await renderLegalMarkdown(`[x](${url})`)
      expect(html, url).not.toContain('<a')
    }
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/composables/__tests__/legalMarkdown.test.ts`
Expected: FAIL — `Failed to resolve import "../legalMarkdown"`.

- [ ] **Step 4: Implement** — `src/composables/legalMarkdown.ts`:

```ts
/**
 * Markdown for a host's legal documents, and for nothing else.
 *
 * Locked down, because the text comes from whoever runs the instance: raw HTML
 * is escaped and shown as text (markdown-it's html: false), images are never
 * rendered (a legal page is the last place for a tracking pixel), and only
 * https:, http: and mailto: become links — each opening in a new tab without
 * an opener. Anything else in link position stays plain text.
 *
 * markdown-it is imported on first use, so it costs nothing until a document
 * is opened.
 */
import type MarkdownIt from 'markdown-it'

const SAFE_LINK = /^(https?:|mailto:)/i

let renderer: MarkdownIt | null = null

const build = async (): Promise<MarkdownIt> => {
  const { default: Markdown } = await import('markdown-it')
  const md = new Markdown({ html: false, linkify: false, typographer: false })
  md.disable('image')
  md.validateLink = (url: string) => SAFE_LINK.test(url.trim())
  const openLink = md.renderer.rules.link_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')
    return openLink(tokens, idx, options, env, self)
  }
  return md
}

export const renderLegalMarkdown = async (source: string): Promise<string> => {
  renderer ??= await build()
  return renderer.render(source)
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run src/composables/__tests__/legalMarkdown.test.ts`
Expected: PASS. If the image test fails because `disable('image')` leaves `![x](url)` as `!` plus a link, that is acceptable only if the output contains no `<img` — the assertion is exactly that.

- [ ] **Step 6: The view** — `src/components/legal/LegalDocumentView.vue`:

```vue
<script setup lang="ts">
/**
 * One legal text, loaded when shown. A host's document is Markdown and goes
 * through renderLegalMarkdown, which lets no raw HTML, image or unsafe link
 * through; the AGPL is plain text and is shown exactly as written.
 */
import { onMounted, ref, watch } from 'vue'
import { LoaderCircle } from 'lucide-vue-next'
import { renderLegalMarkdown } from '@/composables/legalMarkdown'

const props = defineProps<{
  load: () => Promise<string>
  format: 'markdown' | 'plain'
}>()

const html = ref('')
const text = ref('')
const state = ref<'loading' | 'ready' | 'failed'>('loading')

const run = async () => {
  state.value = 'loading'
  try {
    const source = await props.load()
    if (props.format === 'markdown') html.value = await renderLegalMarkdown(source)
    else text.value = source
    state.value = 'ready'
  } catch {
    state.value = 'failed'
  }
}

onMounted(run)
watch(() => props.load, run)
</script>

<template>
  <div class="ld" :aria-busy="state === 'loading' ? 'true' : undefined">
    <p v-if="state === 'loading'" class="ld-status">
      <LoaderCircle class="ld-spin" :size="16" :stroke-width="2.25" aria-hidden="true" />
      Loading…
    </p>
    <p v-else-if="state === 'failed'" class="ld-status" role="alert">
      Couldn't load this document.
      <button type="button" class="ld-retry" @click="run">Try again</button>
    </p>
    <!-- The one v-html here: renderLegalMarkdown escapes raw HTML, renders no
         images and drops every link that is not https:, http: or mailto:. -->
    <div v-else-if="format === 'markdown'" class="ld-body" v-html="html" />
    <pre v-else class="ld-plain">{{ text }}</pre>
  </div>
</template>

<style scoped>
.ld { color: var(--text-1); font-size: 14px; line-height: 1.6; }
.ld-status { display: flex; align-items: center; gap: 8px; color: var(--text-3); margin: 8px 0; }
.ld-retry {
  background: none; border: none; padding: 0; font: inherit; font-weight: 600;
  color: var(--text-link); cursor: pointer;
}
.ld-retry:hover { text-decoration: underline; }
.ld-spin { animation: ld-rot 1s linear infinite; }
@keyframes ld-rot { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ld-spin { animation: none; } }

.ld-body { max-width: 72ch; overflow-wrap: anywhere; }
.ld-body :deep(h1) { font-size: 20px; font-weight: 700; color: var(--text-strong); margin: 4px 0 12px; }
.ld-body :deep(h2) { font-size: 16px; font-weight: 700; color: var(--text-strong); margin: 22px 0 8px; }
.ld-body :deep(h3) { font-size: 14px; font-weight: 700; color: var(--text-1); margin: 18px 0 6px; }
.ld-body :deep(p) { margin: 0 0 10px; }
.ld-body :deep(ul), .ld-body :deep(ol) { margin: 0 0 10px; padding-left: 22px; }
.ld-body :deep(li) { margin: 2px 0; }
.ld-body :deep(a) { color: var(--text-link); text-decoration: underline; }
.ld-body :deep(code) {
  font-family: var(--font-mono); font-size: 13px;
  background: var(--bg-input); border-radius: 4px; padding: 1px 4px;
}
.ld-body :deep(pre) { background: var(--bg-input); border-radius: 6px; padding: 10px 12px; overflow-x: auto; }
.ld-body :deep(pre code) { background: none; padding: 0; }
.ld-body :deep(blockquote) { margin: 0 0 10px; padding-left: 10px; border-left: 3px solid var(--border); color: var(--text-2); }
.ld-plain {
  margin: 0; white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: var(--font-mono); font-size: 12.5px; line-height: 1.55; color: var(--text-2);
}
</style>
```

- [ ] **Step 7: The modal for before sign-in** — `src/components/legal/LegalDocModal.vue`:

```vue
<script setup lang="ts">
/**
 * A host's legal document, opened from the sign-up sentence or the line under
 * the sign-in card. Settings reads documents inside its own pane instead
 * (LegalPage.vue): a modal over the Settings modal breaks both.
 */
import { X } from 'lucide-vue-next'
import ModalBase from '@/components/modals/ModalBase.vue'
import LegalDocumentView from './LegalDocumentView.vue'
import { LEGAL_TITLES, formatUpdated, type DocumentEntry } from '@/composables/legalDocs'
import { fetchLegalDocument } from '@/composables/useInstance'

const props = defineProps<{ entry: DocumentEntry; instanceName: string }>()
const emit = defineEmits<{ close: [] }>()

const load = () => fetchLegalDocument(props.entry.href)
</script>

<template>
  <ModalBase width="720px" @close="emit('close')">
    <div class="ldm">
      <header class="ldm-head">
        <div class="ldm-titles">
          <h2 class="ldm-title">{{ LEGAL_TITLES[entry.kind] }}</h2>
          <p class="ldm-meta">{{ instanceName }} · Last updated {{ formatUpdated(entry.updated) }}</p>
        </div>
        <button type="button" class="ldm-close" aria-label="Close" @click="emit('close')">
          <X :size="18" :stroke-width="2" />
        </button>
      </header>
      <div class="ldm-body">
        <LegalDocumentView :load="load" format="markdown" />
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
.ldm { display: flex; flex-direction: column; max-height: min(80vh, 760px); }
.ldm-head {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 18px 20px 12px; border-bottom: 1px solid var(--divider);
}
.ldm-titles { flex: 1; min-width: 0; }
.ldm-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-strong); }
.ldm-meta { margin: 4px 0 0; font-size: 12.5px; color: var(--text-3); }
.ldm-close {
  flex: none; width: 32px; height: 32px; border-radius: 6px; border: none; background: none;
  display: flex; align-items: center; justify-content: center; color: var(--icon); cursor: pointer;
}
.ldm-close:hover { background: var(--hover); color: var(--text-strong); }
.ldm-body { padding: 14px 20px 20px; overflow-y: auto; }
</style>
```

`--icon` is the resting icon colour from the colour sweep, which is on main and merged into this branch.

- [ ] **Step 8: Tests and typecheck** — `npx vitest run src/` then `npm run typecheck`. Expected: all pass, including the colour guard.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/composables/legalMarkdown.ts src/composables/__tests__/legalMarkdown.test.ts src/components/legal/
git commit -m "feat(legal): a host's documents render as locked-down Markdown, loaded on demand"
```

---

### Task 6: Sign-up and the sign-in footer

**Files:**
- Create: `src/composables/consentSentence.ts`
- Test: `src/composables/__tests__/consentSentence.test.ts`
- Modify: `src/views/AuthPage.vue`

**Interfaces:**
- Consumes: `InstanceProfile`, `LegalEntry`, `DocumentEntry`, `LEGAL_TITLES` (Task 4); `useInstance` (Task 4); `LegalDocModal` (Task 5).
- Produces: `consentSentence(profile: InstanceProfile | null): Segment[]` where `type Segment = { text: string; link?: LegalEntry }`.

- [ ] **Step 1: Write the failing test** — `src/composables/__tests__/consentSentence.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/composables/__tests__/consentSentence.test.ts`
Expected: FAIL — `Failed to resolve import "../consentSentence"`.

- [ ] **Step 3: Implement** — `src/composables/consentSentence.ts`:

```ts
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
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/composables/__tests__/consentSentence.test.ts`
Expected: PASS.

- [ ] **Step 5: AuthPage, the script** — in `src/views/AuthPage.vue`'s `<script setup>`, add to the imports:

```ts
import LegalDocModal from '@/components/legal/LegalDocModal.vue'
import { useInstance } from '@/composables/useInstance'
import { consentSentence } from '@/composables/consentSentence'
import { LEGAL_TITLES, type DocumentEntry, type LegalEntry } from '@/composables/legalDocs'
```

and, after the existing `useAuth()` destructuring:

```ts
// Who runs this instance and what they publish. One request, shared with
// Settings; nothing is shown until it answers.
const { profile: instance } = useInstance()
const consent = computed(() => consentSentence(instance.value))
const legalLinks = computed(() => instance.value?.legal ?? [])
const openDoc = ref<DocumentEntry | null>(null)

/** A link opens in a new tab; a document opens in the reader. */
const legalAttrs = (entry: LegalEntry) =>
  entry.source === 'url'
    ? { href: entry.href, target: '_blank', rel: 'noopener noreferrer' }
    : { href: entry.href }
const openLegal = (event: MouseEvent, entry: LegalEntry) => {
  if (entry.source !== 'document') return
  event.preventDefault()
  openDoc.value = entry
}
```

(`computed` and `ref` are already imported from `vue` in this file; if either is missing, add it to that import.)

- [ ] **Step 6: AuthPage, the sentence** — replace

```vue
          <p class="terms">By registering you agree to our <a href="#">Terms</a> &amp; <a href="#">Privacy Policy</a></p>
```

with

```vue
          <p v-if="consent.length" class="terms">
            <template v-for="(segment, i) in consent" :key="i">
              <a v-if="segment.link" v-bind="legalAttrs(segment.link)" @click="openLegal($event, segment.link)">{{ segment.text }}</a>
              <template v-else>{{ segment.text }}</template>
            </template>
          </p>
```

- [ ] **Step 7: AuthPage, the footer and the reader** — the page is `<div class="shell">` holding the blobs and `<div class="card">`. Directly after the card's closing `</div>` and before the shell's, add:

```vue
    <!-- Every document the instance publishes, reachable before sign-in: an
         imprint, where one is required, must be reachable from every page. -->
    <nav v-if="legalLinks.length" class="legal-foot" aria-label="Legal">
      <template v-for="(entry, i) in legalLinks" :key="entry.kind">
        <span v-if="i > 0" class="legal-dot" aria-hidden="true">·</span>
        <a v-bind="legalAttrs(entry)" @click="openLegal($event, entry)">{{ LEGAL_TITLES[entry.kind] }}</a>
      </template>
    </nav>

    <LegalDocModal
      v-if="openDoc"
      :entry="openDoc"
      :instance-name="instance?.name ?? ''"
      @close="openDoc = null"
    />
```

- [ ] **Step 8: AuthPage, the styles** — `.shell` is `display:flex; align-items:center; justify-content:center` in a row, so a second child would sit beside the card. Stack them: add `flex-direction:column;` to the existing `.shell` rule, then add:

```css
.legal-foot {
  position: relative; z-index: 1;
  display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 6px;
  max-width: 488px; margin-top: 14px; padding: 0 12px;
  font-size: 12px; color: var(--text-faint);
}
.legal-foot a { color: inherit; text-decoration: none; }
.legal-foot a:hover { color: var(--text-2); text-decoration: underline; }
.legal-dot { color: var(--text-faint); }
```

Check the card still centres vertically at desktop and phone width after the `flex-direction` change; if the blobs are positioned relative to `.shell`, they are unaffected.

- [ ] **Step 9: Tests and typecheck** — `npx vitest run src/` then `npm run typecheck`. Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/composables/consentSentence.ts src/composables/__tests__/consentSentence.test.ts src/views/AuthPage.vue
git commit -m "feat(legal): sign-up names the instance and its documents, and every document is reachable before sign-in"
```

---

### Task 7: Settings › About this instance

**Files:**
- Create: `src/composables/aboutInstance.ts`
- Test: `src/composables/__tests__/aboutInstance.test.ts`
- Create: `src/components/settings/AboutInstancePage.vue`
- Modify: `src/components/modals/SettingsModal.vue` (nav section, `v-for` key, page branch)

**Interfaces:**
- Consumes: `InstanceProfile`, `Contact` (Task 4); `useInstance` (Task 4); `SkycordIcon.vue` (existing, `size` prop).
- Produces: `aboutRows(profile: InstanceProfile): AboutRow[]` with `interface AboutRow { label: string; value: string; href?: string; external?: boolean }`; the Settings page id `'about'`.

- [ ] **Step 1: Write the failing test** — `src/composables/__tests__/aboutInstance.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/composables/__tests__/aboutInstance.test.ts`
Expected: FAIL — `Failed to resolve import "../aboutInstance"`.

- [ ] **Step 3: Implement** — `src/composables/aboutInstance.ts`:

```ts
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
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/composables/__tests__/aboutInstance.test.ts`
Expected: PASS.

- [ ] **Step 5: The page** — `src/components/settings/AboutInstancePage.vue`:

```vue
<script setup lang="ts">
/**
 * Settings › About this instance: who runs this server, how to reach them,
 * and what it is running. No host-facing detail — no variable names, paths
 * or setup hints; a member never needs them.
 */
import { computed, ref } from 'vue'
import SkycordIcon from '@/components/SkycordIcon.vue'
import { useInstance } from '@/composables/useInstance'
import { aboutRows } from '@/composables/aboutInstance'
import '@/styles/settingsShared.css'

const { profile, state, retry } = useInstance()
const rows = computed(() => (profile.value ? aboutRows(profile.value) : []))

// A broken icon falls back to the Skycord mark rather than a broken image.
const iconFailed = ref(false)
</script>

<template>
  <div v-if="state === 'failed'" class="ai-failed" role="alert">
    <p class="st-hint">Couldn't reach the server.</p>
    <button type="button" class="st-btn" @click="retry">Retry</button>
  </div>

  <template v-else-if="profile">
    <div class="ai-head">
      <img
        v-if="profile.icon && !iconFailed"
        class="ai-icon" :src="profile.icon" alt="" @error="iconFailed = true"
      >
      <div v-else class="ai-icon ai-mark"><SkycordIcon :size="28" /></div>
      <div class="ai-names">
        <h2 class="ai-name">{{ profile.name }}</h2>
        <p v-if="profile.description" class="ai-desc">{{ profile.description }}</p>
      </div>
    </div>

    <div class="st-card">
      <div v-for="row in rows" :key="row.label" class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">{{ row.label }}</span>
          <span class="st-field-value">
            <a
              v-if="row.href" :href="row.href"
              :target="row.external ? '_blank' : undefined"
              :rel="row.external ? 'noopener noreferrer' : undefined"
              class="ai-link"
            >{{ row.value }}</a>
            <template v-else>{{ row.value }}</template>
          </span>
        </div>
      </div>
    </div>
  </template>

  <!-- Loading: the page's shape, quietly, so nothing jumps when it lands. -->
  <div v-else class="st-card" aria-busy="true">
    <div v-for="n in 2" :key="n" class="st-field"><span class="ai-skel" /></div>
  </div>
</template>

<style scoped>
.ai-head { display: flex; align-items: center; gap: 14px; margin: 4px 0 18px; }
.ai-icon { width: 56px; height: 56px; border-radius: 14px; flex: none; object-fit: cover; }
.ai-mark { display: flex; align-items: center; justify-content: center; background: var(--bg-panel); color: var(--accent); }
.ai-names { min-width: 0; }
.ai-name { margin: 0; font-size: 20px; font-weight: 700; color: var(--text-strong); overflow-wrap: anywhere; }
.ai-desc { margin: 4px 0 0; font-size: 14px; color: var(--text-2); line-height: 1.5; }
.ai-link { color: var(--text-link); text-decoration: none; overflow: hidden; text-overflow: ellipsis; }
.ai-link:hover { text-decoration: underline; }
.ai-skel { display: block; width: 40%; height: 14px; border-radius: 4px; background: var(--hover-strong); }
.ai-failed { display: flex; align-items: center; gap: 12px; }
</style>
```

- [ ] **Step 6: SettingsModal, the nav** — in `src/components/modals/SettingsModal.vue`, add a third section to `navSections`, after App Settings:

```ts
  {
    // No label: this is about the instance, not the app's settings, and it
    // sits apart from both groups above it (owner, 2026-09-14).
    label: '',
    items: [
      { id: 'about', label: 'About this instance' },
    ]
  },
```

Two sections now have the label `''`, and the nav's `v-for` is keyed on it. Key by position instead — change

```vue
          <div v-for="section in navSections" :key="section.label" class="sm-nav-section">
```

to

```vue
          <div v-for="(section, si) in navSections" :key="si" class="sm-nav-section">
```

- [ ] **Step 7: SettingsModal, the page** — add the import beside `DevicesPage`'s:

```ts
import AboutInstancePage from '@/components/settings/AboutInstancePage.vue'
```

and in the page chain, after the `page === 'keybinds'` template, add:

```vue
          <!-- ── About this instance ── -->
          <template v-else-if="page === 'about'">
            <AboutInstancePage />
          </template>
```

- [ ] **Step 8: Tests and typecheck** — `npx vitest run src/` (includes `settingsNav.test.ts`, which checks every nav id has a page branch) and `npm run typecheck`. Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/composables/aboutInstance.ts src/composables/__tests__/aboutInstance.test.ts src/components/settings/AboutInstancePage.vue src/components/modals/SettingsModal.vue
git commit -m "feat(instance): Settings shows who runs this instance and how to reach them"
```

---

### Task 8: Settings › Legal

**Files:**
- Modify: `src/composables/legalDocs.ts` (append `legalRows`, `sourceHref`)
- Modify: `src/composables/__tests__/legalDocs.test.ts` (append tests)
- Create: `src/components/settings/LegalPage.vue`
- Modify: `src/components/modals/SettingsModal.vue` (nav row, page branch)

**Interfaces:**
- Consumes: `useInstance`, `fetchLegalDocument` (Task 4); `LegalDocumentView` (Task 5); `LEGAL_TITLES`, `formatUpdated`, `UPSTREAM_REPO` (Task 4).
- Produces: `legalRows(profile: InstanceProfile | null): LegalRow[]` with `interface LegalRow { entry: LegalEntry; title: string; external: boolean; updated: string | null }`; `sourceHref(profile: InstanceProfile | null): string`; the Settings page id `'legal'`; in `LegalPage.vue`, a `view` state Task 9 extends.

- [ ] **Step 1: Write the failing tests** — append to `src/composables/__tests__/legalDocs.test.ts`, and extend its import from `'../legalDocs'` with `legalRows, sourceHref, type InstanceProfile`:

```ts
const profileWith = (legal: InstanceProfile['legal'], source = 'https://example.com/src'): InstanceProfile => ({
  software: 'skycord', version: 'v0.20.0', address: 'https://chat.example.com', name: 'Sky Den',
  nameIsAddress: false, description: null, operator: null, contact: null, icon: null, legal, source,
})

describe('legalRows', () => {
  it('titles each document, marks links as external, and dates only documents', () => {
    const rows = legalRows(profileWith([
      { kind: 'terms', source: 'url', href: 'https://example.com/terms' },
      { kind: 'privacy', source: 'document', href: '/instance/legal/privacy', updated: '2026-09-02' },
    ]))
    expect(rows.map(r => [r.title, r.external])).toEqual([['Terms of Service', true], ['Privacy Policy', false]])
    expect(rows[0].updated).toBeNull()
    expect(rows[1].updated).toBe(formatUpdated('2026-09-02'))
  })

  it('is empty when nothing is published, and while the profile is unavailable', () => {
    expect(legalRows(profileWith([]))).toEqual([])
    expect(legalRows(null)).toEqual([])
  })
})

describe('sourceHref', () => {
  it('uses the profile\'s source', () => {
    expect(sourceHref(profileWith([], 'https://git.example.com/sky'))).toBe('https://git.example.com/sky')
  })
  it('falls back to upstream when the profile is unavailable: the offer must not depend on the server', () => {
    expect(sourceHref(null)).toBe(UPSTREAM_REPO)
  })
  it('never links a source that is not http(s)', () => {
    expect(sourceHref(profileWith([], 'javascript:alert(1)'))).toBe(UPSTREAM_REPO)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/composables/__tests__/legalDocs.test.ts`
Expected: FAIL — `legalRows is not a function` (or not exported).

- [ ] **Step 3: Implement** — append to `src/composables/legalDocs.ts`:

```ts
export interface LegalRow { entry: LegalEntry; title: string; external: boolean; updated: string | null }

/** The instance's documents as Settings › Legal lists them, in the fixed order. */
export const legalRows = (profile: InstanceProfile | null): LegalRow[] =>
  (profile?.legal ?? []).map(entry => ({
    entry,
    title: LEGAL_TITLES[entry.kind],
    external: entry.source === 'url',
    updated: entry.source === 'document' ? formatUpdated(entry.updated) : null,
  }))

/**
 * Where the source of the running version is. The AGPL's offer must not depend
 * on the server answering, so with no profile — or a source that is not a web
 * address — it falls back to the upstream repository.
 */
export const sourceHref = (profile: InstanceProfile | null): string => {
  const source = profile?.source
  return source && /^https?:\/\//i.test(source) ? source : UPSTREAM_REPO
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/composables/__tests__/legalDocs.test.ts`
Expected: PASS.

- [ ] **Step 5: The page** — `src/components/settings/LegalPage.vue`:

```vue
<script setup lang="ts">
/**
 * Settings › Legal. Two groups: the instance's own documents, and Skycord's —
 * the AGPL notice with the source of the running version, which every instance
 * owes its members whatever its host configured.
 *
 * A document opens here, in the Settings pane, not in a modal over the
 * Settings modal: Settings is already a full-screen surface, and a drill-down
 * on phones.
 */
import { computed, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-vue-next'
import LegalDocumentView from '@/components/legal/LegalDocumentView.vue'
import { useInstance, fetchLegalDocument } from '@/composables/useInstance'
import { legalRows, sourceHref, LEGAL_TITLES, formatUpdated, type DocumentEntry } from '@/composables/legalDocs'
import '@/styles/settingsShared.css'

const { profile, state, retry } = useInstance()
const rows = computed(() => legalRows(profile.value))
const source = computed(() => sourceHref(profile.value))

type View = { kind: 'list' } | { kind: 'doc'; entry: DocumentEntry } | { kind: 'agpl' }
const view = ref<View>({ kind: 'list' })

const openDocument = (entry: DocumentEntry) => { view.value = { kind: 'doc', entry } }
const back = () => { view.value = { kind: 'list' } }

// The AGPL ships with the app as plain text, and loads only when opened.
const loadAgpl = () => import('../../../LICENSE?raw').then(m => m.default)
const loadDoc = computed(() => {
  const current = view.value
  return current.kind === 'doc' ? () => fetchLegalDocument(current.entry.href) : loadAgpl
})

// Opening or leaving a document starts at the top of the pane.
const root = ref<HTMLElement | null>(null)
watch(view, () => { (root.value?.closest('.sm-content') as HTMLElement | null)?.scrollTo({ top: 0 }) })
</script>

<template>
  <div ref="root">
    <template v-if="view.kind === 'list'">
      <h2 class="st-section">{{ profile?.name ?? 'This instance' }}</h2>

      <div v-if="state === 'failed'" class="lg-failed" role="alert">
        <p class="st-hint">Couldn't reach the server.</p>
        <button type="button" class="st-btn" @click="retry">Retry</button>
      </div>
      <div v-else-if="!profile" class="st-card" aria-busy="true">
        <div v-for="n in 2" :key="n" class="st-field"><span class="lg-skel" /></div>
      </div>
      <p v-else-if="rows.length === 0" class="st-hint">{{ profile.name }} hasn't published any legal documents.</p>
      <div v-else class="st-card">
        <template v-for="row in rows" :key="row.entry.kind">
          <a
            v-if="row.entry.source === 'url'"
            class="st-field lg-row" :href="row.entry.href" target="_blank" rel="noopener noreferrer"
          >
            <span class="lg-title">{{ row.title }}</span>
            <ExternalLink class="lg-go" :size="16" :stroke-width="2" aria-hidden="true" />
          </a>
          <button v-else type="button" class="st-field lg-row" @click="openDocument(row.entry)">
            <span class="lg-text">
              <span class="lg-title">{{ row.title }}</span>
              <span v-if="row.updated" class="lg-sub">Updated {{ row.updated }}</span>
            </span>
            <ChevronRight class="lg-go" :size="16" :stroke-width="2.25" aria-hidden="true" />
          </button>
        </template>
      </div>

      <h2 class="st-section lg-sky">Skycord</h2>
      <p class="st-hint">
        Skycord is free software, licensed under the GNU Affero General Public
        License, version 3. You can read the licence and get the source code of
        the version this server runs.
      </p>
      <div class="st-card">
        <button type="button" class="st-field lg-row" @click="view = { kind: 'agpl' }">
          <span class="lg-title">GNU AGPL v3</span>
          <ChevronRight class="lg-go" :size="16" :stroke-width="2.25" aria-hidden="true" />
        </button>
        <a class="st-field lg-row" :href="source" target="_blank" rel="noopener noreferrer">
          <span class="lg-title">Source code</span>
          <ExternalLink class="lg-go" :size="16" :stroke-width="2" aria-hidden="true" />
        </a>
      </div>
    </template>

    <template v-else>
      <button type="button" class="lg-back" @click="back">
        <ChevronLeft :size="16" :stroke-width="2.25" aria-hidden="true" /> Legal
      </button>
      <template v-if="view.kind === 'doc'">
        <h2 class="lg-doctitle">{{ LEGAL_TITLES[view.entry.kind] }}</h2>
        <p class="lg-docmeta">{{ profile?.name }} · Last updated {{ formatUpdated(view.entry.updated) }}</p>
        <LegalDocumentView :load="loadDoc" format="markdown" />
      </template>
      <template v-else>
        <h2 class="lg-doctitle">GNU Affero General Public License</h2>
        <p class="lg-docmeta">Version 3, the licence Skycord is released under</p>
        <LegalDocumentView :load="loadDoc" format="plain" />
      </template>
    </template>
  </div>
</template>

<style scoped>
.lg-row {
  width: 100%; text-align: left; font: inherit; color: inherit;
  background: none; border: none; cursor: pointer; text-decoration: none;
}
.lg-row + .lg-row { border-top: 1px solid var(--divider); }
.lg-row:hover { background: var(--hover); }
.lg-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.lg-title { font-size: 15px; font-weight: 600; color: var(--text-1); }
.lg-sub { font-size: 13px; color: var(--text-3); }
.lg-go { flex: none; color: var(--icon); }
.lg-sky { margin-top: 28px; }
.lg-skel { display: block; width: 40%; height: 14px; border-radius: 4px; background: var(--hover-strong); }
.lg-failed { display: flex; align-items: center; gap: 12px; }
.lg-back {
  display: inline-flex; align-items: center; gap: 4px; margin: 0 0 12px; padding: 4px 8px 4px 4px;
  border: none; border-radius: 6px; background: none; font: inherit; font-size: 14px; font-weight: 600;
  color: var(--text-2); cursor: pointer;
}
.lg-back:hover { background: var(--hover); color: var(--text-strong); }
.lg-doctitle { margin: 0; font-size: 20px; font-weight: 700; color: var(--text-strong); }
.lg-docmeta { margin: 4px 0 16px; font-size: 13px; color: var(--text-3); }
</style>
```

`--icon` is the resting icon colour from the colour sweep, already on this branch.

- [ ] **Step 6: SettingsModal** — add `{ id: 'legal', label: 'Legal' }` after `about` in the bottom nav section; add the import

```ts
import LegalPage from '@/components/settings/LegalPage.vue'
```

and, after the `page === 'about'` template:

```vue
          <!-- ── Legal ── -->
          <template v-else-if="page === 'legal'">
            <LegalPage />
          </template>
```

- [ ] **Step 7: Tests and typecheck** — `npx vitest run src/` and `npm run typecheck`. Expected: all pass; `settingsNav.test.ts` now sees `legal`.

- [ ] **Step 8: Commit**

```bash
git add src/composables/legalDocs.ts src/composables/__tests__/legalDocs.test.ts src/components/settings/LegalPage.vue src/components/modals/SettingsModal.vue
git commit -m "feat(legal): a Legal tab in Settings, with the instance's documents and Skycord's licence and source"
```

---

### Task 9: Open-source licences

**Files:**
- Modify: `package.json`, `package-lock.json` (add `rollup-plugin-license`, dev)
- Modify: `vite.config.ts` (the plugin)
- Create: `src/components/settings/OpenSourceLicences.vue`
- Modify: `src/components/settings/LegalPage.vue` (a row and a view)

**Interfaces:**
- Consumes: `LegalPage.vue`'s `View` union and list (Task 8).
- Produces: the build artifact `dist/licenses.json`, an array of `{ name: string; version: string; license: string; text: string }`, served at `/licenses.json`.

- [ ] **Step 1: Add the plugin**

```bash
npm install -D rollup-plugin-license
```

- [ ] **Step 2: Generate the list at build** — in `vite.config.ts`, add the import:

```ts
import license from 'rollup-plugin-license'
```

and add to `plugins`, after `hmrFollowsPort()`:

```ts
      // Every third-party package the bundler actually included, with its
      // licence text, written beside the app for Settings › Legal to read.
      // Build only; the build fails if a bundled package has a licence it
      // cannot read, rather than shipping a list with a hole in it.
      {
        ...license({
          thirdParty: {
            includePrivate: false,
            allow: { test: dep => Boolean(dep.license), failOnUnlicensed: true, failOnViolation: true },
            output: {
              file: resolve(__dirname, 'dist', 'licenses.json'),
              template: deps => JSON.stringify(
                deps
                  .map(d => ({ name: d.name ?? '', version: d.version ?? '', license: d.license ?? '', text: d.licenseText ?? '' }))
                  .sort((a, b) => a.name.localeCompare(b.name)),
              ),
            },
          },
        }),
        apply: 'build' as const,
      },
```

(`resolve` is already imported from `path` in this file.)

- [ ] **Step 3: Build and check the list**

Run: `npm run build`, then
`node -e "const l=require('./dist/licenses.json'); console.log(l.length, JSON.stringify(l.find(p=>p.name==='vue')).slice(0,120))"`
Expected: a count above 10, and `vue` listed with `"license":"MIT"` and non-empty `text`. If the build fails naming a package with no readable licence, that is the check working: report the package rather than weakening `allow`.

- [ ] **Step 4: The view** — `src/components/settings/OpenSourceLicences.vue`:

```vue
<script setup lang="ts">
/**
 * The third-party packages bundled into this app, with their licences —
 * generated when the app is built (vite.config.ts), and loaded only when this
 * view opens.
 */
import { onMounted, ref } from 'vue'

interface Package { name: string; version: string; license: string; text: string }

const packages = ref<Package[]>([])
const state = ref<'loading' | 'ready' | 'missing'>('loading')

onMounted(async () => {
  try {
    const res = await fetch('/licenses.json', { credentials: 'omit' })
    if (!res.ok) throw new Error(String(res.status))
    packages.value = await res.json() as Package[]
    state.value = 'ready'
  } catch {
    state.value = 'missing'
  }
})
</script>

<template>
  <p v-if="state === 'loading'" class="st-hint">Loading…</p>
  <p v-else-if="state === 'missing'" class="st-hint">
    This list is written when the app is built, so a development server doesn't have one.
  </p>
  <div v-else class="st-card">
    <details v-for="pkg in packages" :key="pkg.name" class="os-item">
      <summary class="os-sum">
        <span class="os-name">{{ pkg.name }}</span>
        <span class="os-meta">{{ pkg.version }} · {{ pkg.license }}</span>
      </summary>
      <pre v-if="pkg.text" class="os-text">{{ pkg.text }}</pre>
    </details>
  </div>
</template>

<style scoped>
.os-item + .os-item { border-top: 1px solid var(--divider); }
.os-sum {
  display: flex; align-items: baseline; gap: 10px; padding: 12px 20px;
  cursor: pointer; list-style: none;
}
.os-sum::-webkit-details-marker { display: none; }
.os-sum:hover { background: var(--hover); }
.os-name { font-size: 14px; font-weight: 600; color: var(--text-1); overflow-wrap: anywhere; }
.os-meta { font-size: 12.5px; color: var(--text-3); white-space: nowrap; }
.os-text {
  margin: 0; padding: 0 20px 14px; white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: var(--font-mono); font-size: 12px; line-height: 1.5; color: var(--text-2);
}
</style>
```

- [ ] **Step 5: LegalPage** — in `src/components/settings/LegalPage.vue`:
  - import it: `import OpenSourceLicences from './OpenSourceLicences.vue'`;
  - extend the view union: `type View = { kind: 'list' } | { kind: 'doc'; entry: DocumentEntry } | { kind: 'agpl' } | { kind: 'oss' }`;
  - add a third row to the Skycord card, after Source code:

```vue
        <button type="button" class="st-field lg-row" @click="view = { kind: 'oss' }">
          <span class="lg-title">Open-source licences</span>
          <ChevronRight class="lg-go" :size="16" :stroke-width="2.25" aria-hidden="true" />
        </button>
```

  - and change the non-list branch's final `<template v-else>` (the AGPL) to `<template v-else-if="view.kind === 'agpl'">`, followed by:

```vue
      <template v-else>
        <h2 class="lg-doctitle">Open-source licences</h2>
        <p class="lg-docmeta">The packages Skycord is built with, and their licences</p>
        <OpenSourceLicences />
      </template>
```

- [ ] **Step 6: Tests and typecheck** — `npx vitest run src/` and `npm run typecheck`. Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/components/settings/OpenSourceLicences.vue src/components/settings/LegalPage.vue
git commit -m "feat(legal): the open-source licences of what the app bundles, generated at build"
```

---

### Task 10: See it

Needs a running app and a signed-in session; the owner signs in.

- [ ] **Step 1: Configure a test instance.** In the main checkout's `.env` (not committed), set `INSTANCE_NAME=Sky Den`, `INSTANCE_OPERATOR=Sam Doe`, `INSTANCE_CONTACT=sam@example.com`, `TERMS_URL=https://example.com/terms`. Create `instance/privacy.md` and `instance/imprint.md`; in `privacy.md` include `<script>alert(1)</script>`, `![x](https://example.com/x.png)` and `[bad](javascript:alert(1))`. Restart the API.
- [ ] **Step 2: Signed out.** The register view's sentence reads "By registering you agree to Sky Den's Terms and Privacy Policy." Terms opens a new tab; Privacy Policy opens the reader, where the script and image are shown as text and the bad link is not a link. The line under the card reads "Terms of Service · Privacy Policy · Imprint" on both views.
- [ ] **Step 3: Settings › About this instance** — name, Run by, Contact (a mail link), Version, Address; no Terms or Privacy rows. Then unset everything and restart: the address as the name, Version and Address only, nothing that reads broken.
- [ ] **Step 4: Settings › Legal** — the three documents in order; Terms external, Privacy and Imprint open in the pane with "Updated …" and come back with the back control; GNU AGPL v3 opens the licence text; Source code opens the upstream tag; Open-source licences lists packages (built app only). With nothing published: "Sky Den hasn't published any legal documents." With the API stopped: the retry, and the Skycord group still offering the source.
- [ ] **Step 5: Everywhere above**, in `default`, `light` and `light-dim`, at desktop width and at phone width (Settings becomes a drill-down; the in-page back control returns to the Legal list).
- [ ] **Step 6: `curl -si http://127.0.0.1:3001/instance -H 'Origin: https://elsewhere.example'`** shows `Access-Control-Allow-Origin: *` and no `Access-Control-Allow-Credentials`.
- [ ] **Step 7:** Record what was seen, with screenshots, in the pull request or merge message.

---

## Self-review

**Spec coverage.** §1 variables and files → Tasks 1 and 3 (installer, compose, `.env.example`, docs). Contact classification → Task 1. §2 `/instance` and its fields, `legal` in fixed order with `updated` only on documents, `source` and its fallback → Task 1; routes, CORS before the global policy, 404s, cache, rate limit, `API_PREFIXES`, startup warnings → Task 2. §3 `useInstance` → Task 4; titles → Task 4; sign-up sentence → Task 6; the line under the sign-in card → Task 6; the reader before sign-in, the lazy renderer and its rules → Task 5; the Settings bottom section → Tasks 7 and 8; About's rows and omissions → Task 7; Legal's groups, empty line, in-pane reading, the AGPL and the source offer that survives a failed profile → Task 8; open-source licences → Task 9. §4 safety → Tasks 1, 2, 5 (tests for each). §5 constraints → Global Constraints. §6 testing → the tests in Tasks 1–9 and the browser pass in Task 10. The desktop picker is out of scope, as the spec says.

**Deviations from the spec, deliberate.**
- The spec's "one shared constant the server and the client both import" became a mirror held by a test, because `tsconfig.server.json` pins `rootDir` to `server/`. The spec's text was updated to match (2026-09-19).
- The spec asked for the rate limit to be tested; every limiter in this project skips itself under Vitest, so the test holds the limiter's definition and that the router applies it.
- The installer's prompts use the file's existing lowercase "enter to skip", which is the style the spec asks them to match.

**Placeholders.** None: every step has its code or its exact command.

**Type consistency.** `InstanceProfile`, `LegalEntry`, `Contact` have the same shape on the server (Task 1) and the client (Task 4). `DocumentEntry` is the `document` arm of `LegalEntry`. `useInstance()` returns `{ profile, state, retry }` everywhere it is used (Tasks 6, 7, 8). `legalRows` and `sourceHref` are defined in Task 8 and used only there. `LegalPage.vue`'s `View` union gains `oss` in Task 9 exactly as Task 8 defines the others.

**Order and conflicts.** Slices 3, 4 and 8 are on main and merged into this branch (2026-09-19), so `--icon` and the other colour tokens exist, and four guards apply to every task here: no literal colour (named ones included), no raw duration outside the named exceptions (a spinner's `infinite` loop is fine), no transition on a layout property, and no regex lookbehind. The plan's own CSS already keeps to all four.
