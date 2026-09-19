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
