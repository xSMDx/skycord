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
import {
  PERMISSIONS, PERMISSION_GROUPS, DEFAULT_EVERYONE, ALL_PERMISSIONS, has, canActOnMember,
} from '../../../server/permissions'
import {
  PERMISSION_META, PERMISSION_UI_GROUPS, DEFAULT_EVERYONE_NAMES,
  PERMISSION_BIT, namesToBits, bitsToNames, canActOnMemberUI,
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

/*
 * v0.17.0 shipped thirty-one permission toggles, fifteen of which nothing on the
 * server ever read. Denying "Speak" on a role looked like it worked and the
 * person kept talking. Nothing caught it because nothing was looking: the copy
 * tests check the WORDS, the parity tests check the BITS, and neither asks
 * whether any code consults the bit.
 *
 * This does. It reads the server tree and asks, per permission, whether anything
 * outside the definition file names it. The check runs in BOTH directions on
 * purpose — an unflagged permission nobody enforces fails, and so does a flagged
 * one that somebody has since enforced. The second half is what stops the flags
 * rotting into their own kind of lie once the features land.
 */
/*
 * Read through Vite's raw glob rather than node:fs. This file is compiled by the
 * CLIENT tsconfig, which deliberately carries only `vite/client` types — adding
 * node's would let real app code import `fs` and have it typecheck, which is a
 * worse trade than the small awkwardness here.
 */
const serverSource: Record<string, string> = import.meta.glob(
  '../../../server/**/*.ts',
  { query: '?raw', import: 'default', eager: true },
)

// permissions.ts DEFINES every name, so including it would mark them all
// enforced; the test files name permissions they assert on, not ones they gate.
const enforcementPaths = Object.keys(serverSource).filter(
  p => !p.endsWith('/permissions.ts') && !p.includes('/__tests__/'),
)

describe('every permission is either enforced or honestly flagged', () => {
  // Administrator is never named at a call site by design — `resolve()` expands
  // it to ALL_PERMISSIONS, so it is enforced through every other check at once.
  const EXEMPT = new Set<PermissionName>(['Administrator'])

  const enforcement = enforcementPaths.map(p => serverSource[p]).join('\n')
  const isChecked = (n: PermissionName) => enforcement.includes(`'${n}'`) || enforcement.includes(`"${n}"`)
  const isFlagged = (n: PermissionName) =>
    !!(PERMISSION_META[n].soon || PERMISSION_META[n].unenforced)

  it('flags every permission the server never checks', () => {
    const lying = serverNames.filter(n => !EXEMPT.has(n) && !isChecked(n) && !isFlagged(n))
    expect(lying).toEqual([])
  })

  it('unflags every permission the server has started checking', () => {
    const stale = serverNames.filter(n => !EXEMPT.has(n) && isChecked(n) && isFlagged(n))
    expect(stale).toEqual([])
  })

  it('never marks one permission both Soon and Not enforced', () => {
    // They are mutually exclusive claims: absent, or present but ungated.
    const both = serverNames.filter(n => PERMISSION_META[n].soon && PERMISSION_META[n].unenforced)
    expect(both).toEqual([])
  })

  it('never marks an unbuilt or ungated permission as merely advisory', () => {
    // `advisory` is the strongest of the three — it says the switch WORKS and
    // is only bypassable by a modified client. Pairing it with either of the
    // others would claim a thing works and does not work at once.
    const confused = serverNames.filter(n => {
      const m = PERMISSION_META[n]
      return m.advisory && (m.soon || m.unenforced)
    })
    expect(confused).toEqual([])
  })

  it('only calls a permission advisory when the server really does read it', () => {
    // Advisory does not mean unenforced-with-a-nicer-word. UseVoiceActivity
    // qualifies because the server resolves it and sends the answer to the
    // client; something the server never looks at is `unenforced`, full stop.
    const hollow = serverNames.filter(n => PERMISSION_META[n].advisory && !isChecked(n))
    expect(hollow).toEqual([])
  })

  it('actually found the server tree', () => {
    // A wrong path would make `isChecked` false everywhere and quietly turn the
    // first assertion into "everything must be flagged" — a test that passes by
    // measuring nothing is the failure mode these checks exist to prevent.
    expect(enforcement).toContain('ManageChannels')
    expect(enforcementPaths.length).toBeGreaterThan(20)
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

/*
 * The UI mirror of canActOnMember, tested against the original rather than
 * against a re-description of it.
 *
 * A duplicated authorisation rule drifts, and the copy that drifts is the one
 * nobody re-reads. This file is the one place both trees are importable, so the
 * two can be run side by side on the same inputs — which turns "we wrote it
 * twice carefully" into "they agree, checked every build".
 */
describe('canActOnMemberUI mirrors the server rule', () => {
  const CASES: { name: string; actor: { isOwner: boolean; bits: bigint; highestPosition: number }; target: { isOwner: boolean; highestPosition: number } }[] = [
    { name: 'owner acting on a member',        actor: { isOwner: true,  bits: 0n, highestPosition: -1 }, target: { isOwner: false, highestPosition: 9 } },
    { name: 'anyone acting on the owner',      actor: { isOwner: false, bits: ALL_PERMISSIONS, highestPosition: 99 }, target: { isOwner: true,  highestPosition: -1 } },
    { name: 'owner acting on the owner',       actor: { isOwner: true,  bits: 0n, highestPosition: -1 }, target: { isOwner: true,  highestPosition: -1 } },
    { name: 'administrator outranking',        actor: { isOwner: false, bits: PERMISSIONS.Administrator, highestPosition: 5 }, target: { isOwner: false, highestPosition: 1 } },
    { name: 'administrator outranked',         actor: { isOwner: false, bits: PERMISSIONS.Administrator, highestPosition: 1 }, target: { isOwner: false, highestPosition: 5 } },
    { name: 'holder outranking',               actor: { isOwner: false, bits: PERMISSIONS.MuteMembers, highestPosition: 5 }, target: { isOwner: false, highestPosition: 1 } },
    { name: 'holder at equal rank',            actor: { isOwner: false, bits: PERMISSIONS.MuteMembers, highestPosition: 5 }, target: { isOwner: false, highestPosition: 5 } },
    { name: 'holder outranked',                actor: { isOwner: false, bits: PERMISSIONS.MuteMembers, highestPosition: 1 }, target: { isOwner: false, highestPosition: 5 } },
    { name: 'wrong permission held',           actor: { isOwner: false, bits: PERMISSIONS.KickMembers, highestPosition: 5 }, target: { isOwner: false, highestPosition: 1 } },
    { name: 'no permission at all',            actor: { isOwner: false, bits: 0n, highestPosition: 5 }, target: { isOwner: false, highestPosition: 1 } },
    { name: 'roleless actor vs roleless target', actor: { isOwner: false, bits: PERMISSIONS.MuteMembers, highestPosition: -1 }, target: { isOwner: false, highestPosition: -1 } },
  ]

  for (const c of CASES) {
    it(`agrees with the server: ${c.name}`, () => {
      const server = canActOnMember(c.actor, c.target, 'MuteMembers')
      const ui = canActOnMemberUI(
        { isOwner: c.actor.isOwner, permissions: String(c.actor.bits), highestPosition: c.actor.highestPosition },
        c.target,
        'MuteMembers',
      )
      expect(`${c.name}:${ui}`).toBe(`${c.name}:${server}`)
    })
  }

  it('treats a missing rank as unranked, not as rank zero', () => {
    // A member row fetched before highestPosition existed. Reading it as 0
    // would put them level with @everyone and let a junior moderator act.
    const actor = { isOwner: false, permissions: String(PERMISSIONS.MuteMembers), highestPosition: 0 }
    expect(canActOnMemberUI(actor, { isOwner: false }, 'MuteMembers')).toBe(true)
    expect(canActOnMemberUI(actor, { isOwner: false, highestPosition: 0 }, 'MuteMembers')).toBe(false)
  })

  it('reads an unfetched access as no powers rather than throwing', () => {
    expect(canActOnMemberUI(null, { isOwner: false, highestPosition: 0 }, 'MuteMembers')).toBe(false)
  })

  it('reads a malformed bitfield as no permissions, never as a grant', () => {
    const actor = { isOwner: false, permissions: 'not-a-number', highestPosition: 9 }
    expect(canActOnMemberUI(actor, { isOwner: false, highestPosition: 1 }, 'MuteMembers')).toBe(false)
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
