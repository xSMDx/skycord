import { describe, it, expect } from 'vitest'
import {
  PERMISSIONS, ALL_PERMISSIONS, DEFAULT_EVERYONE,
  resolveChannel, canInChannel, parseOverwrites, has,
  type Overwrite,
} from '../permissions'

/**
 * Channel permission resolution.
 *
 * Pure functions, no database — deliberately, because this is the code that
 * decides whether a private channel is actually private. Every case below is
 * one where the layers disagree, since that is the only place the algorithm
 * can be wrong in an interesting way.
 */

const EVERYONE = 'role-everyone'
const ME = 'user-me'

const ow = (
  id: string, type: 'role' | 'member', allow: bigint, deny: bigint,
): Overwrite => ({ id, type, allow, deny })

/** A plain member holding @everyone's defaults and nothing else. */
const member = (over: Partial<Parameters<typeof resolveChannel>[0]> = {}) => ({
  isOwner: false,
  userId: ME,
  everyoneRoleId: EVERYONE,
  roleIds: [] as string[],
  roleBits: [DEFAULT_EVERYONE],
  layers: [] as Overwrite[][],
  ...over,
})

describe('the short-circuits', () => {
  it('gives the owner everything, whatever the overwrites say', () => {
    // The owner is above the role system entirely — no overwrite can bite.
    const bits = resolveChannel(member({
      isOwner: true,
      layers: [[ow(EVERYONE, 'role', 0n, ALL_PERMISSIONS)]],
    }))
    expect(bits).toBe(ALL_PERMISSIONS)
  })

  it('lets Administrator bypass overwrites entirely', () => {
    // This is why a channel cannot be hidden from an admin by denying
    // @everyone: the base check happens before any layer is read.
    const bits = resolveChannel(member({
      roleBits: [DEFAULT_EVERYONE, PERMISSIONS.Administrator],
      layers: [[ow(EVERYONE, 'role', 0n, PERMISSIONS.ViewChannels)]],
    }))
    expect(has(bits, 'ViewChannels')).toBe(true)
    expect(bits).toBe(ALL_PERMISSIONS)
  })

  it('does not treat a plain member as an admin', () => {
    const bits = resolveChannel(member({
      layers: [[ow(EVERYONE, 'role', 0n, PERMISSIONS.ViewChannels)]],
    }))
    expect(has(bits, 'ViewChannels')).toBe(false)
  })
})

describe('a single layer', () => {
  it('denies @everyone, which is what makes a channel private', () => {
    const bits = resolveChannel(member({
      layers: [[ow(EVERYONE, 'role', 0n, PERMISSIONS.ViewChannels)]],
    }))
    expect(has(bits, 'ViewChannels')).toBe(false)
    // Everything else @everyone had is untouched.
    expect(has(bits, 'SendMessages')).toBe(true)
  })

  it('lets a role allow beat the @everyone deny in the same layer', () => {
    // Deny runs before allow within a layer, so this is the "private channel
    // plus an access list" case working.
    const bits = resolveChannel(member({
      roleIds: ['staff'],
      layers: [[
        ow(EVERYONE, 'role', 0n, PERMISSIONS.ViewChannels),
        ow('staff', 'role', PERMISSIONS.ViewChannels, 0n),
      ]],
    }))
    expect(has(bits, 'ViewChannels')).toBe(true)
  })

  it('ignores an overwrite for a role the member does not hold', () => {
    const bits = resolveChannel(member({
      roleIds: [],
      layers: [[
        ow(EVERYONE, 'role', 0n, PERMISSIONS.ViewChannels),
        ow('staff', 'role', PERMISSIONS.ViewChannels, 0n),
      ]],
    }))
    expect(has(bits, 'ViewChannels')).toBe(false)
  })

  it('lets a member overwrite beat their roles', () => {
    // Member overwrites run last within a layer — the per-person exception.
    const bits = resolveChannel(member({
      roleIds: ['staff'],
      layers: [[
        ow('staff', 'role', PERMISSIONS.ViewChannels, 0n),
        ow(ME, 'member', 0n, PERMISSIONS.ViewChannels),
      ]],
    }))
    expect(has(bits, 'ViewChannels')).toBe(false)
  })

  it('ignores a member overwrite aimed at somebody else', () => {
    const bits = resolveChannel(member({
      layers: [[ow('someone-else', 'member', 0n, PERMISSIONS.SendMessages)]],
    }))
    expect(has(bits, 'SendMessages')).toBe(true)
  })
})

describe('role overwrites accumulate rather than sequence', () => {
  it('ORs every held role together, so listing order cannot matter', () => {
    const a = [
      ow('r1', 'role', PERMISSIONS.SendMessages, 0n),
      ow('r2', 'role', 0n, PERMISSIONS.SendMessages),
    ]
    const forward = resolveChannel(member({ roleIds: ['r1', 'r2'], layers: [a] }))
    const backward = resolveChannel(member({ roleIds: ['r1', 'r2'], layers: [[...a].reverse()] }))
    expect(forward).toBe(backward)
  })

  it('resolves an allow and a deny on the same permission as ALLOW', () => {
    // Denies are gathered, allows are gathered, then deny is applied first and
    // allow second — so holding any role that allows it wins. Sequential
    // application would have made this depend on order.
    const bits = resolveChannel(member({
      roleIds: ['r1', 'r2'],
      layers: [[
        ow('r1', 'role', 0n, PERMISSIONS.SendMessages),
        ow('r2', 'role', PERMISSIONS.SendMessages, 0n),
      ]],
    }))
    expect(has(bits, 'SendMessages')).toBe(true)
  })

  it('is unaffected by which role is "higher" — rank is not in the input', () => {
    // Guards the documented property: position decides who may EDIT a role,
    // and has no bearing on what resolves in a channel.
    const bits = resolveChannel(member({
      roleIds: ['low', 'high'],
      layers: [[
        ow('high', 'role', 0n, PERMISSIONS.Connect),
        ow('low', 'role', PERMISSIONS.Connect, 0n),
      ]],
    }))
    expect(has(bits, 'Connect')).toBe(true)
  })
})

describe('category then channel', () => {
  it('follows the category when the channel has no overwrites', () => {
    // "Synced", expressed as an absence.
    const bits = resolveChannel(member({
      layers: [[ow(EVERYONE, 'role', 0n, PERMISSIONS.ViewChannels)], []],
    }))
    expect(has(bits, 'ViewChannels')).toBe(false)
  })

  it('lets a channel allow beat a category deny', () => {
    // One open channel inside a locked category — the case live inheritance
    // has to express, and the reason later layers win.
    const bits = resolveChannel(member({
      layers: [
        [ow(EVERYONE, 'role', 0n, PERMISSIONS.ViewChannels)],
        [ow(EVERYONE, 'role', PERMISSIONS.ViewChannels, 0n)],
      ],
    }))
    expect(has(bits, 'ViewChannels')).toBe(true)
  })

  it('lets a channel deny beat a category allow', () => {
    const bits = resolveChannel(member({
      roleIds: ['staff'],
      layers: [
        [ow('staff', 'role', PERMISSIONS.ViewChannels, 0n)],
        [ow('staff', 'role', 0n, PERMISSIONS.ViewChannels)],
      ],
    }))
    expect(has(bits, 'ViewChannels')).toBe(false)
  })

  it('carries a category grant through to a channel that says nothing', () => {
    const bits = resolveChannel(member({
      roleIds: ['staff'],
      layers: [[ow('staff', 'role', PERMISSIONS.ManageMessages, 0n)], []],
    }))
    expect(has(bits, 'ManageMessages')).toBe(true)
  })
})

describe('the locked-voice-channel case, end to end', () => {
  // What the whole slice exists for: a voice channel only one role may join.
  const layers = [[
    ow(EVERYONE, 'role', 0n, PERMISSIONS.ViewChannels | PERMISSIONS.Connect),
    ow('staff', 'role', PERMISSIONS.ViewChannels | PERMISSIONS.Connect, 0n),
  ]]

  it('shuts an ordinary member out of both seeing and joining', () => {
    const bits = resolveChannel(member({ layers }))
    expect(has(bits, 'ViewChannels')).toBe(false)
    expect(has(bits, 'Connect')).toBe(false)
  })

  it('lets the role in', () => {
    const bits = resolveChannel(member({ roleIds: ['staff'], layers }))
    expect(has(bits, 'ViewChannels')).toBe(true)
    expect(has(bits, 'Connect')).toBe(true)
  })

  it('denies Connect as well as View — invisible but joinable is a real hole', () => {
    // Denying only ViewChannels would leave the channel reachable by anyone
    // who knows it exists. The reference says so in its own copy.
    const viewOnly = [[ow(EVERYONE, 'role', 0n, PERMISSIONS.ViewChannels)]]
    expect(has(resolveChannel(member({ layers: viewOnly })), 'Connect')).toBe(true)
    expect(has(resolveChannel(member({ layers })), 'Connect')).toBe(false)
  })
})

describe('parseOverwrites', () => {
  it('turns stored strings into bits', () => {
    const [o] = parseOverwrites([
      { id: 'r1', type: 'role', allow: PERMISSIONS.Connect.toString(), deny: '0' },
    ])
    expect(o.allow).toBe(PERMISSIONS.Connect)
    expect(o.deny).toBe(0n)
  })

  it('reads garbage as zero rather than throwing or granting', () => {
    const [o] = parseOverwrites([
      { id: 'r1', type: 'role', allow: 'nonsense', deny: '' } as never,
    ])
    expect(o.allow).toBe(0n)
    expect(o.deny).toBe(0n)
  })

  it('survives a full-width round trip', () => {
    const [o] = parseOverwrites([
      { id: 'r1', type: 'role', allow: ALL_PERMISSIONS.toString(), deny: '0' },
    ])
    expect(o.allow).toBe(ALL_PERMISSIONS)
  })

  it('treats a missing list as no overwrites', () => {
    expect(parseOverwrites(null)).toEqual([])
    expect(parseOverwrites(undefined)).toEqual([])
  })
})

describe('canInChannel', () => {
  it('answers the question the callers actually ask', () => {
    const input = member({ layers: [[ow(EVERYONE, 'role', 0n, PERMISSIONS.SendMessages)]] })
    expect(canInChannel(input, 'SendMessages')).toBe(false)
    expect(canInChannel(input, 'ViewChannels')).toBe(true)
  })
})
