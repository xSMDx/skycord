/**
 * The UI copy and the permission contract must describe the same set.
 *
 * server/permissions.ts owns which permissions exist; src/composables/
 * permissionMeta.ts owns their wording. They cannot import each other —
 * tsconfig.server.json pins rootDir to server/ — so nothing but this test stops
 * them drifting. Add a permission on the server and forget the copy, and the
 * Roles page renders a toggle with a blank label; remove one and the page
 * offers a permission the server will never grant.
 *
 * vitest is the only place both trees are reachable, which is why this lives
 * here rather than in either module.
 */
import { describe, it, expect } from 'vitest'
import { PERMISSIONS, PERMISSION_GROUPS, DEFAULT_EVERYONE, ALL_PERMISSIONS, has } from '../../../server/permissions'
import {
  PERMISSION_META, PERMISSION_UI_GROUPS, DEFAULT_EVERYONE_NAMES,
  PERMISSION_BIT, namesToBits, bitsToNames,
  type PermissionName,
} from '../permissionMeta'

const serverNames = Object.keys(PERMISSIONS) as PermissionName[]

describe('UI copy covers the contract', () => {
  it('has an entry for every permission the server defines', () => {
    const missing = serverNames.filter(n => !PERMISSION_META[n])
    expect(missing).toEqual([])
  })

  it('does not describe permissions the server has never heard of', () => {
    const extra = Object.keys(PERMISSION_META).filter(n => !serverNames.includes(n as PermissionName))
    expect(extra).toEqual([])
  })

  it('gives every permission a non-empty label and description', () => {
    const blank = serverNames.filter(n => {
      const m = PERMISSION_META[n]
      return !m?.label?.trim() || !m?.desc?.trim()
    })
    expect(blank).toEqual([])
  })

  /*
   * The checks below exist because the first pass at this copy shipped lines
   * like 'Create, edit and delete webhooks.' — grammatical, present, and
   * useless: it defines the permission with its own label and tells a reader
   * nothing they could not guess. 'Half written', as the report put it.
   */
  it('writes a real sentence, not the label said twice', () => {
    // A description that is mostly its own label restated has no content.
    const circular = serverNames.filter(n => {
      const { label, desc } = PERMISSION_META[n]
      const words = label.toLowerCase().replace(/[^a-z ]/g, '').split(/ +/).filter(w => w.length > 3)
      const body = desc.toLowerCase().replace(/[^a-z ]/g, '')
      const echoed = words.filter(w => body.includes(w)).length
      // Echoing every meaningful word of the label AND being short is the tell.
      return words.length > 0 && echoed === words.length && desc.length < 70
    })
    expect(circular).toEqual([])
  })

  it('says enough to be worth reading', () => {
    const thin = serverNames.filter(n => PERMISSION_META[n].desc.length < 45)
    expect(thin).toEqual([])
  })

  it('ends every description with a full stop', () => {
    const unpunctuated = serverNames.filter(n => !PERMISSION_META[n].desc.trim().endsWith('.'))
    expect(unpunctuated).toEqual([])
  })
})

describe('UI grouping matches the contract grouping', () => {
  it('lists every permission exactly once across its groups', () => {
    const flat = PERMISSION_UI_GROUPS.flatMap(g => g.perms)
    expect([...flat].sort()).toEqual([...serverNames].sort())
    expect(new Set(flat).size).toBe(flat.length)   // no duplicates
  })

  it('puts each permission in the same group the server does', () => {
    // Titles differ by design — the server's are Title Case, the UI's are
    // sentence case — so compare membership, not labels.
    const uiGroupOf = new Map<string, number>()
    PERMISSION_UI_GROUPS.forEach((g, i) => g.perms.forEach(p => uiGroupOf.set(p, i)))
    const srvGroupOf = new Map<string, number>()
    PERMISSION_GROUPS.forEach((g, i) => g.perms.forEach(p => srvGroupOf.set(p, i)))
    for (const n of serverNames) {
      expect(`${n}:${uiGroupOf.get(n)}`).toBe(`${n}:${srvGroupOf.get(n)}`)
    }
  })

  it('keeps Administrator alone, and marked dangerous', () => {
    // It is the one flag that expands to everything, so it must never be
    // buried in a list of ordinary toggles.
    const advanced = PERMISSION_UI_GROUPS[PERMISSION_UI_GROUPS.length - 1]
    expect(advanced.perms).toEqual(['Administrator'])
    expect(PERMISSION_META.Administrator.danger).toBe(true)
  })

  it('says in the Administrator copy that the owner still outranks it', () => {
    // The explicit product rule. If this wording is ever lost, the UI stops
    // telling people the one thing about Administrator that surprises them.
    expect(PERMISSION_META.Administrator.desc.toLowerCase()).toContain('owner')
  })
})

describe('the default @everyone set', () => {
  it('matches DEFAULT_EVERYONE bit for bit', () => {
    const fromNames = DEFAULT_EVERYONE_NAMES.reduce((acc, n) => acc | PERMISSIONS[n], 0n)
    expect(fromNames).toBe(DEFAULT_EVERYONE)
  })

  it('names only permissions DEFAULT_EVERYONE actually carries', () => {
    const wrong = DEFAULT_EVERYONE_NAMES.filter(n => !has(DEFAULT_EVERYONE, n))
    expect(wrong).toEqual([])
  })
})

describe('the client bit map matches the server', () => {
  it('assigns every permission the same bit the server does', () => {
    // One bit out and the client sends a role powers nobody chose.
    const wrong = serverNames.filter(n => PERMISSION_BIT[n] !== PERMISSIONS[n])
    expect(wrong).toEqual([])
  })

  it('round-trips names through the wire format', () => {
    const names: PermissionName[] = ['SendMessages', 'Connect', 'ManageRoles']
    expect(bitsToNames(namesToBits(names)).sort()).toEqual([...names].sort())
  })

  it('round-trips the full set, where a Number would lose precision', () => {
    const all = Object.keys(PERMISSION_BIT) as PermissionName[]
    expect(bitsToNames(namesToBits(all))).toHaveLength(all.length)
    expect(BigInt(namesToBits(all))).toBe(ALL_PERMISSIONS)
  })

  it('reads garbage as no permissions rather than throwing', () => {
    for (const bad of ['', 'abc', null, undefined, '12x']) {
      expect(bitsToNames(bad as unknown as string)).toEqual([])
    }
  })
})
