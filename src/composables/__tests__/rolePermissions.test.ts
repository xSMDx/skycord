/**
 * canManageRoleUI, held to the server's canManageRole on the same inputs.
 *
 * Same method as the canActOnMemberUI parity suite in permissionMeta.test.ts,
 * and for the same reason: a duplicated authorisation rule drifts, and the copy
 * that drifts is the one nobody re-reads. This file is one of the few places
 * both trees are importable, so the two are run side by side rather than each
 * being checked against a re-description of the rule.
 *
 * It decides only what the Roles page DRAWS — whether "Add members" and the
 * remove buttons appear. setMemberRoles runs the real check on every request.
 */
import { describe, it, expect } from 'vitest'
import { PERMISSIONS, ALL_PERMISSIONS, canManageRole } from '../../../server/permissions'
import { canManageRoleUI } from '../permissionMeta'

describe('canManageRoleUI mirrors the server rule', () => {
  const CASES: {
    name: string
    actor: { isOwner: boolean; bits: bigint; highestPosition: number }
    role: number
  }[] = [
    { name: 'owner, any role',                   actor: { isOwner: true,  bits: 0n,                       highestPosition: -1 }, role: 99 },
    { name: 'holder, role below',                actor: { isOwner: false, bits: PERMISSIONS.ManageRoles,  highestPosition: 5 },  role: 3 },
    { name: 'holder, role at equal position',    actor: { isOwner: false, bits: PERMISSIONS.ManageRoles,  highestPosition: 5 },  role: 5 },
    { name: 'holder, role above',                actor: { isOwner: false, bits: PERMISSIONS.ManageRoles,  highestPosition: 5 },  role: 7 },
    { name: 'no permission, role below',         actor: { isOwner: false, bits: 0n,                       highestPosition: 5 },  role: 1 },
    { name: 'wrong permission, role below',      actor: { isOwner: false, bits: PERMISSIONS.KickMembers,  highestPosition: 5 },  role: 1 },
    // resolve() expands Administrator to every bit before either side sees it,
    // which is why neither special-cases it — see the note on canActOnMemberUI.
    { name: 'administrator (expanded), below',   actor: { isOwner: false, bits: ALL_PERMISSIONS,          highestPosition: 5 },  role: 1 },
    { name: 'administrator (expanded), above',   actor: { isOwner: false, bits: ALL_PERMISSIONS,          highestPosition: 5 },  role: 8 },
    { name: 'roleless holder, @everyone',        actor: { isOwner: false, bits: PERMISSIONS.ManageRoles,  highestPosition: -1 }, role: 0 },
  ]

  for (const c of CASES) {
    it(`agrees with the server: ${c.name}`, () => {
      const server = canManageRole(c.actor, c.role)
      const ui = canManageRoleUI(
        { isOwner: c.actor.isOwner, permissions: String(c.actor.bits), highestPosition: c.actor.highestPosition },
        c.role,
      )
      expect(`${c.name}:${ui}`).toBe(`${c.name}:${server}`)
    })
  }

  it('reads an unfetched access as no powers rather than throwing', () => {
    expect(canManageRoleUI(null, 0)).toBe(false)
  })

  it('reads a malformed bitfield as no permissions, never as a grant', () => {
    expect(canManageRoleUI({ isOwner: false, permissions: 'nonsense', highestPosition: 9 }, 1)).toBe(false)
  })
})
