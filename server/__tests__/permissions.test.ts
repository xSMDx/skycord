/**
 * The permission model.
 *
 * Pure functions, no database — which is the point. These are the rules that
 * decide who can delete a channel or remove a person, and getting one wrong is
 * a security bug rather than a glitch. They should be provable without standing
 * a server up.
 *
 * The stakes are asymmetric: a false negative annoys someone, a false positive
 * hands over a server. Every ambiguous case below resolves toward refusing.
 */
import { describe, it, expect } from 'vitest'
import {
  PERMISSIONS, ALL_PERMISSIONS, DEFAULT_EVERYONE,
  parseBits, serializeBits, resolve, has, hasAll, toNames, fromNames,
  outranks, canManageRole, canActOnMember,
  type PermissionName,
} from '../permissions'

const member = (bits: bigint, pos = 1) => ({ isOwner: false, highestPosition: pos, bits })
const owner = () => ({ isOwner: true, highestPosition: Infinity, bits: ALL_PERMISSIONS })

describe('the bitfield itself', () => {
  it('gives every permission a distinct bit', () => {
    const values = Object.values(PERMISSIONS)
    expect(new Set(values.map(String)).size).toBe(values.length)
  })

  it('is a power of two per flag — no accidental overlaps', () => {
    // Two flags sharing a bit would silently grant one when the other is set.
    for (const [name, v] of Object.entries(PERMISSIONS)) {
      expect(`${name}:${v & (v - 1n)}`).toBe(`${name}:0`)
    }
  })

  it('uses BigInt past bit 30, where 32-bit maths would go negative', () => {
    // `1 << 31` is -2147483648 with Number bitwise ops. The whole reason the
    // model is BigInt is that the 32nd permission must not corrupt the 31 below
    // it, so prove the top flag is positive and keeps growing.
    expect(PERMISSIONS.Administrator > 0n).toBe(true)
    expect(1n << 31n > 0n).toBe(true)
    expect(1n << 62n > 0n).toBe(true)
  })
})

describe('storage round-trip', () => {
  it('survives a string round-trip exactly', () => {
    const bits = PERMISSIONS.Administrator | PERMISSIONS.KickMembers
    expect(parseBits(serializeBits(bits))).toBe(bits)
  })

  it('round-trips the full set, which is where a Number would lose precision', () => {
    expect(parseBits(serializeBits(ALL_PERMISSIONS))).toBe(ALL_PERMISSIONS)
  })

  it('reads garbage as no permissions rather than throwing', () => {
    // Fail closed. A corrupt row must not become a grant, and must not take the
    // request down either.
    for (const bad of ['', 'abc', null, undefined, {}, '12x']) {
      expect(parseBits(bad as unknown)).toBe(0n)
    }
  })
})

describe('resolve', () => {
  it('unions every role the member holds', () => {
    const bits = resolve({ isOwner: false, roleBits: [PERMISSIONS.SendMessages, PERMISSIONS.KickMembers] })
    expect(has(bits, 'SendMessages')).toBe(true)
    expect(has(bits, 'KickMembers')).toBe(true)
    expect(has(bits, 'BanMembers')).toBe(false)
  })

  it('expands Administrator to everything', () => {
    const bits = resolve({ isOwner: false, roleBits: [PERMISSIONS.Administrator] })
    expect(bits).toBe(ALL_PERMISSIONS)
    expect(has(bits, 'ManageServer')).toBe(true)
  })

  it('gives the owner everything even with no roles at all', () => {
    expect(resolve({ isOwner: true, roleBits: [] })).toBe(ALL_PERMISSIONS)
  })

  it('gives nothing to someone with no roles', () => {
    expect(resolve({ isOwner: false, roleBits: [] })).toBe(0n)
  })
})

describe('the owner outranks Administrator', () => {
  // The explicit requirement: admins do not overpass the owner. An
  // Administrator holds every BIT, so every one of these has to be decided by
  // ownership rather than by permissions, or the answer comes out wrong.
  const admin = member(ALL_PERMISSIONS, 10)

  it('an Administrator cannot kick the owner', () => {
    expect(canActOnMember(admin, { isOwner: true, highestPosition: 0 }, 'KickMembers')).toBe(false)
  })

  it('an Administrator cannot ban the owner', () => {
    expect(canActOnMember(admin, { isOwner: true, highestPosition: 0 }, 'BanMembers')).toBe(false)
  })

  it('not even when the owner holds no roles and sits at the bottom', () => {
    // Position must not rescue this: the owner's rank is not a number.
    expect(canActOnMember(admin, { isOwner: true, highestPosition: -999 }, 'KickMembers')).toBe(false)
  })

  it('but the owner can act on an Administrator', () => {
    expect(canActOnMember(owner(), { isOwner: false, highestPosition: 10 }, 'KickMembers')).toBe(true)
  })

  it('and the owner can manage the highest role there is', () => {
    expect(canManageRole(owner(), Number.MAX_SAFE_INTEGER)).toBe(true)
  })
})

describe('role hierarchy', () => {
  it('lets a higher role manage a lower one', () => {
    expect(canManageRole(member(PERMISSIONS.ManageRoles, 5), 3)).toBe(true)
  })

  it('refuses a role at the same position', () => {
    // Equal must NOT pass, or two admins can remove each other and a tie is
    // settled by whoever clicks first.
    expect(canManageRole(member(PERMISSIONS.ManageRoles, 5), 5)).toBe(false)
  })

  it('refuses a role above', () => {
    expect(canManageRole(member(PERMISSIONS.ManageRoles, 2), 7)).toBe(false)
  })

  it('refuses without ManageRoles however high the position', () => {
    // Position alone is not authority — otherwise the top role could rewrite
    // permissions it was never granted.
    expect(canManageRole(member(PERMISSIONS.SendMessages, 99), 1)).toBe(false)
  })

  it('an Administrator still cannot manage a role above their own', () => {
    // Administrator grants every bit, including ManageRoles, so only the
    // position check stops this.
    expect(canManageRole(member(ALL_PERMISSIONS, 3), 8)).toBe(false)
  })

  it('outranks is strict, and the owner is exempt', () => {
    expect(outranks(member(0n, 5), 4)).toBe(true)
    expect(outranks(member(0n, 5), 5)).toBe(false)
    expect(outranks(owner(), Number.MAX_SAFE_INTEGER)).toBe(true)
  })
})

describe('acting on members', () => {
  it('needs the permission AND a higher position', () => {
    const mod = member(PERMISSIONS.KickMembers, 5)
    expect(canActOnMember(mod, { isOwner: false, highestPosition: 2 }, 'KickMembers')).toBe(true)
    expect(canActOnMember(mod, { isOwner: false, highestPosition: 9 }, 'KickMembers')).toBe(false)
  })

  it('refuses an equal-ranked member', () => {
    const mod = member(PERMISSIONS.KickMembers, 5)
    expect(canActOnMember(mod, { isOwner: false, highestPosition: 5 }, 'KickMembers')).toBe(false)
  })

  it('refuses when the permission is missing, however high the rank', () => {
    expect(canActOnMember(member(PERMISSIONS.SendMessages, 50), { isOwner: false, highestPosition: 1 }, 'BanMembers')).toBe(false)
  })
})

describe('names', () => {
  it('round-trips through names', () => {
    const names: PermissionName[] = ['SendMessages', 'Connect', 'ManageRoles']
    expect(toNames(fromNames(names)).sort()).toEqual([...names].sort())
  })

  it('ignores an unknown name rather than throwing', () => {
    // Names arrive from a client. An unrecognised one is a no-op, not a 500 —
    // and importantly not a grant.
    expect(fromNames(['SendMessages', 'NotAThing' as PermissionName])).toBe(PERMISSIONS.SendMessages)
  })

  it('hasAll needs every one', () => {
    const bits = PERMISSIONS.SendMessages | PERMISSIONS.EmbedLinks
    expect(hasAll(bits, ['SendMessages', 'EmbedLinks'])).toBe(true)
    expect(hasAll(bits, ['SendMessages', 'AttachFiles'])).toBe(false)
  })
})

describe('the default @everyone', () => {
  it('can talk, read back and join a call', () => {
    // A default of nothing looks like a broken server to everyone but the
    // owner, with no error to explain it.
    for (const p of ['ViewChannels', 'SendMessages', 'ReadMessageHistory', 'Connect', 'Speak'] as PermissionName[]) {
      expect(has(DEFAULT_EVERYONE, p)).toBe(true)
    }
  })

  it('carries nothing that moderates or reconfigures', () => {
    for (const p of ['Administrator', 'ManageServer', 'ManageRoles', 'ManageChannels',
                     'KickMembers', 'BanMembers', 'ManageMessages', 'MentionEveryone'] as PermissionName[]) {
      expect(has(DEFAULT_EVERYONE, p)).toBe(false)
    }
  })
})
